use async_trait::async_trait;
use opendeal_bitcoin::{
    EscrowDescriptor, EscrowKeys, FundingInfo, FundingStatus, SettlementPsbt, SettlementPurpose,
};
use opendeal_core::SettlementModel;

use super::{ProviderCheckout, SettlementAdapter, SettlementError};

/// Dev/demo adapter. Never implies real funds. Production must refuse to start with this.
pub struct SimulatedSettlementAdapter;

#[async_trait]
impl SettlementAdapter for SimulatedSettlementAdapter {
    fn settlement_model(&self) -> SettlementModel {
        return SettlementModel::Simulated;
    }

    async fn prepare_funding(
        &self,
        keys: &EscrowKeys,
        network: &str,
        amount_sats: u64,
    ) -> Result<(Option<EscrowDescriptor>, FundingInfo), SettlementError> {
        let net = opendeal_bitcoin::escrow::parse_network(network)
            .map_err(|e| SettlementError(e.to_string()))?;
        let escrow = keys
            .build_escrow(net)
            .map_err(|e| SettlementError(e.to_string()))?;
        let info = FundingInfo {
            address: format!("simulated:{}", escrow.address),
            script_pubkey_hex: escrow.script_pubkey_hex.clone(),
            witness_script_hex: escrow.witness_script_hex.clone(),
            expected_amount_sats: amount_sats,
            required_confirmations: 0,
            network: network.to_string(),
            settlement_model: SettlementModel::Simulated,
        };
        return Ok((Some(escrow), info));
    }

    async fn verify_funding(
        &self,
        _escrow: Option<&EscrowDescriptor>,
        funding: &FundingInfo,
        _reference: Option<&str>,
    ) -> Result<FundingStatus, SettlementError> {
        return Ok(FundingStatus {
            funded: true,
            txid: Some(format!("sim{}", "ab".repeat(30))),
            vout: Some(0),
            amount_sats: Some(funding.expected_amount_sats),
            confirmations: 1,
            script_matches: true,
        });
    }

    async fn propose_settlement(
        &self,
        _escrow: &EscrowDescriptor,
        _funding_txid: &str,
        _funding_vout: u32,
        funding_amount_sats: u64,
        destination: &str,
        fee_sats: u64,
        purpose: SettlementPurpose,
    ) -> Result<SettlementPsbt, SettlementError> {
        return Ok(SettlementPsbt {
            purpose,
            psbt_base64: "cHNidP8BAH0CAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAA".into(),
            unsigned_txid: "00".repeat(32),
            output_address: destination.to_string(),
            output_amount_sats: funding_amount_sats.saturating_sub(fee_sats),
            fee_sats,
        });
    }

    async fn attach_signature(
        &self,
        base_psbt: &str,
        _signed_psbt: &str,
    ) -> Result<String, SettlementError> {
        return Ok(base_psbt.to_string());
    }

    async fn finalize_and_broadcast(&self, _psbt_base64: &str) -> Result<String, SettlementError> {
        return Ok(format!("simtx{}", "cd".repeat(29)));
    }

    async fn request_provider_payment(
        &self,
        reference: &str,
        _amount_sats: u64,
    ) -> Result<ProviderCheckout, SettlementError> {
        return Ok(ProviderCheckout {
            reference: reference.to_string(),
            checkout_reference: format!("simulated:{}", reference),
            label: "simulated".into(),
        });
    }

    async fn provider_release(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }

    async fn provider_refund(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }
}
