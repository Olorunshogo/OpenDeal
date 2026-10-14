use std::sync::Arc;

use opendeal_core::SettlementModel;
use serde::{Deserialize, Serialize};

use crate::error::BitcoinError;
use crate::escrow::{EscrowDescriptor, EscrowKeys, parse_network};
use crate::psbt::{
    SettlementPsbt, SettlementPurpose, build_settlement_psbt, combine_psbts, extract_tx_hex,
};
use crate::rpc::BitcoinRpc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundingInfo {
    pub address: String,
    pub script_pubkey_hex: String,
    pub witness_script_hex: String,
    pub expected_amount_sats: u64,
    pub required_confirmations: u32,
    pub network: String,
    pub settlement_model: SettlementModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundingStatus {
    pub funded: bool,
    pub txid: Option<String>,
    pub vout: Option<u32>,
    pub amount_sats: Option<u64>,
    pub confirmations: u32,
    pub script_matches: bool,
}

/// Coordinates 2-of-3 escrow without ever holding private keys.
pub struct BitcoinMultisigAdapter {
    rpc: Arc<dyn BitcoinRpc>,
    required_confirmations: u32,
}

impl BitcoinMultisigAdapter {
    pub fn new(rpc: Arc<dyn BitcoinRpc>, required_confirmations: u32) -> Self {
        return BitcoinMultisigAdapter {
            rpc,
            required_confirmations: required_confirmations.max(1),
        };
    }

    pub fn settlement_model(&self) -> SettlementModel {
        return SettlementModel::BitcoinMultisig2of3;
    }

    pub fn prepare_funding(
        &self,
        keys: &EscrowKeys,
        network_name: &str,
        expected_amount_sats: u64,
    ) -> Result<(EscrowDescriptor, FundingInfo), BitcoinError> {
        let network = parse_network(network_name)?;
        let escrow = keys.build_escrow(network)?;
        let info = FundingInfo {
            address: escrow.address.clone(),
            script_pubkey_hex: escrow.script_pubkey_hex.clone(),
            witness_script_hex: escrow.witness_script_hex.clone(),
            expected_amount_sats,
            required_confirmations: self.required_confirmations,
            network: escrow.network.clone(),
            settlement_model: SettlementModel::BitcoinMultisig2of3,
        };
        return Ok((escrow, info));
    }

    pub async fn verify_funding(
        &self,
        escrow: &EscrowDescriptor,
        expected_amount_sats: u64,
    ) -> Result<FundingStatus, BitcoinError> {
        let utxos = self.rpc.scan_address_utxos(&escrow.address).await?;
        for utxo in utxos {
            let script_matches = utxo
                .script_pubkey_hex
                .eq_ignore_ascii_case(&escrow.script_pubkey_hex);
            let amount_ok = utxo.amount_sats >= expected_amount_sats;
            let conf_ok = utxo.confirmations >= self.required_confirmations;
            if script_matches && amount_ok {
                return Ok(FundingStatus {
                    funded: conf_ok,
                    txid: Some(utxo.txid),
                    vout: Some(utxo.vout),
                    amount_sats: Some(utxo.amount_sats),
                    confirmations: utxo.confirmations,
                    script_matches,
                });
            }
        }
        return Ok(FundingStatus {
            funded: false,
            txid: None,
            vout: None,
            amount_sats: None,
            confirmations: 0,
            script_matches: false,
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn propose_settlement(
        &self,
        escrow: &EscrowDescriptor,
        funding_txid: &str,
        funding_vout: u32,
        funding_amount_sats: u64,
        destination_address: &str,
        fee_sats: u64,
        purpose: SettlementPurpose,
    ) -> Result<SettlementPsbt, BitcoinError> {
        return build_settlement_psbt(
            escrow,
            funding_txid,
            funding_vout,
            funding_amount_sats,
            destination_address,
            fee_sats,
            purpose,
        );
    }

    pub fn attach_signature(
        &self,
        base_psbt: &str,
        signed_psbt: &str,
    ) -> Result<String, BitcoinError> {
        return combine_psbts(base_psbt, signed_psbt);
    }

    pub async fn finalize_and_broadcast(&self, psbt_base64: &str) -> Result<String, BitcoinError> {
        let tx_hex = extract_tx_hex(psbt_base64)?;
        return self.rpc.broadcast_hex(&tx_hex).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::{MockBitcoinRpc, UtxoInfo};
    use bitcoin::secp256k1::{Secp256k1, SecretKey};

    fn sample_keys() -> EscrowKeys {
        let secp = Secp256k1::new();
        let sk1 = SecretKey::from_slice(&[11u8; 32]).unwrap();
        let sk2 = SecretKey::from_slice(&[22u8; 32]).unwrap();
        let sk3 = SecretKey::from_slice(&[33u8; 32]).unwrap();
        return EscrowKeys {
            buyer_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk1).serialize(),
            ),
            seller_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk2).serialize(),
            ),
            mediator_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk3).serialize(),
            ),
        };
    }

    #[tokio::test]
    async fn verify_funding_requires_confirmations_and_script() {
        let mock = Arc::new(MockBitcoinRpc::new());
        let adapter = BitcoinMultisigAdapter::new(mock.clone(), 1);
        let (escrow, _) = adapter
            .prepare_funding(&sample_keys(), "regtest", 50_000)
            .unwrap();

        mock.insert_utxo(UtxoInfo {
            txid: "ab".repeat(32),
            vout: 0,
            amount_sats: 50_000,
            confirmations: 1,
            script_pubkey_hex: escrow.script_pubkey_hex.clone(),
        });

        let status = adapter.verify_funding(&escrow, 50_000).await.unwrap();
        assert!(status.funded);
        assert_eq!(status.amount_sats, Some(50_000));
    }
}
