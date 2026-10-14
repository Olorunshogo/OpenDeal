use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use opendeal_bitcoin::{
    EscrowDescriptor, EscrowKeys, FundingInfo, FundingStatus, SettlementPsbt, SettlementPurpose,
};
use opendeal_core::SettlementModel;

use super::{ProviderCheckout, SettlementAdapter, SettlementError};

/// NGN/fiat rail seam (Paystack/Flutterwave-shaped). Clearly custodial relative to OpenDeal.
pub struct FiatSettlementAdapter {
    intents: Mutex<HashMap<String, u64>>,
}

impl FiatSettlementAdapter {
    pub fn new() -> Self {
        return FiatSettlementAdapter {
            intents: Mutex::new(HashMap::new()),
        };
    }
}

impl Default for FiatSettlementAdapter {
    fn default() -> Self {
        return Self::new();
    }
}

#[async_trait]
impl SettlementAdapter for FiatSettlementAdapter {
    fn settlement_model(&self) -> SettlementModel {
        return SettlementModel::FiatProvider;
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
                settlement_model: SettlementModel::FiatProvider,
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
        let map = self.intents.lock().expect("fiat intent mutex");
        let confirmed = map.get(reference).copied() == Some(funding.expected_amount_sats);
        return Ok(FundingStatus {
            funded: confirmed,
            txid: confirmed.then(|| format!("fiat:{}", reference)),
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
            "Fiat settlement uses provider_release/refund, not PSBT".into(),
        ));
    }

    async fn attach_signature(
        &self,
        _base_psbt: &str,
        _signed_psbt: &str,
    ) -> Result<String, SettlementError> {
        return Err(SettlementError("PSBT not used for FiatProvider".into()));
    }

    async fn finalize_and_broadcast(&self, _psbt_base64: &str) -> Result<String, SettlementError> {
        return Err(SettlementError("PSBT not used for FiatProvider".into()));
    }

    async fn request_provider_payment(
        &self,
        reference: &str,
        amount_sats: u64,
    ) -> Result<ProviderCheckout, SettlementError> {
        self.intents
            .lock()
            .expect("fiat intent mutex")
            .insert(reference.to_string(), amount_sats);
        return Ok(ProviderCheckout {
            reference: reference.to_string(),
            checkout_reference: format!("fiat_stub_{}", reference),
            label: "fiat_provider".into(),
        });
    }

    async fn provider_release(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }

    async fn provider_refund(&self, _reference: &str) -> Result<(), SettlementError> {
        return Ok(());
    }
}
