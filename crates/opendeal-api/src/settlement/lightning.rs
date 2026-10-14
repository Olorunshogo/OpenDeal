use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use opendeal_bitcoin::{
    EscrowDescriptor, EscrowKeys, FundingInfo, FundingStatus, SettlementPsbt, SettlementPurpose,
};
use opendeal_core::SettlementModel;

use super::{ProviderCheckout, SettlementAdapter, SettlementError};

/**
 * Lightning / NWC-shaped adapter seam. Phase 3: swap the in-memory map for Bitnob/MavaPay/NWC.
 * Custody is provider-dependent. Never labeled as BitcoinMultisig2of3.
 */
pub struct LightningSettlementAdapter {
    invoices: Mutex<HashMap<String, u64>>,
}

impl LightningSettlementAdapter {
    pub fn new() -> Self {
        return LightningSettlementAdapter {
            invoices: Mutex::new(HashMap::new()),
        };
    }
}

impl Default for LightningSettlementAdapter {
    fn default() -> Self {
        return Self::new();
    }
}

#[async_trait]
impl SettlementAdapter for LightningSettlementAdapter {
    fn settlement_model(&self) -> SettlementModel {
        return SettlementModel::LightningProvider;
    }

    async fn prepare_funding(
        &self,
        _keys: &EscrowKeys,
        network: &str,
        amount_sats: u64,
    ) -> Result<(Option<EscrowDescriptor>, FundingInfo), SettlementError> {
        return Ok((
            None,
            FundingInfo {
                address: String::new(),
                script_pubkey_hex: String::new(),
                witness_script_hex: String::new(),
                expected_amount_sats: amount_sats,
                required_confirmations: 0,
                network: network.to_string(),
                settlement_model: SettlementModel::LightningProvider,
            },
        ));
    }

    async fn verify_funding(
        &self,
        _escrow: Option<&EscrowDescriptor>,
        funding: &FundingInfo,
        reference: Option<&str>,
    ) -> Result<FundingStatus, SettlementError> {
        let reference =
            reference.ok_or_else(|| SettlementError("payment reference required".into()))?;
        let map = self.invoices.lock().expect("lightning invoice mutex");
        let confirmed = map.get(reference).copied() == Some(funding.expected_amount_sats);
        return Ok(FundingStatus {
            funded: confirmed,
            txid: confirmed.then(|| format!("ln:{}", reference)),
            vout: confirmed.then_some(0),
            amount_sats: confirmed.then_some(funding.expected_amount_sats),
            confirmations: if confirmed { 1 } else { 0 },
            script_matches: confirmed,
        });
    }

    async fn propose_settlement(
        &self,
        _escrow: &EscrowDescriptor,
        _funding_txid: &str,
        _funding_vout: u32,
        _funding_amount_sats: u64,
        _destination: &str,
        _fee_sats: u64,
        _purpose: SettlementPurpose,
    ) -> Result<SettlementPsbt, SettlementError> {
        return Err(SettlementError(
            "Lightning settlement uses provider_release/refund, not PSBT".into(),
        ));
    }

    async fn attach_signature(
        &self,
        _base_psbt: &str,
        _signed_psbt: &str,
    ) -> Result<String, SettlementError> {
        return Err(SettlementError(
            "PSBT not used for LightningProvider".into(),
        ));
    }

    async fn finalize_and_broadcast(&self, _psbt_base64: &str) -> Result<String, SettlementError> {
        return Err(SettlementError(
            "PSBT not used for LightningProvider".into(),
        ));
    }

    async fn request_provider_payment(
        &self,
        reference: &str,
        amount_sats: u64,
    ) -> Result<ProviderCheckout, SettlementError> {
        self.invoices
            .lock()
            .expect("lightning invoice mutex")
            .insert(reference.to_string(), amount_sats);
        return Ok(ProviderCheckout {
            reference: reference.to_string(),
            checkout_reference: format!("lnbc_stub_{}", reference),
            label: "lightning_provider".into(),
        });
    }

    async fn provider_release(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }

    async fn provider_refund(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }
}
