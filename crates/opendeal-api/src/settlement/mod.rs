//! Settlement capability trait. B-ready seam, A-honest for multisig.
//!
//! Multisig never exposes unilateral `release`/`refund`. Lightning/fiat adapters do, and must
//! label their custody model via `settlement_model()`.

mod fiat;
mod http_invoice;
mod lightning;
mod simulated;

pub use http_invoice::HttpInvoiceClient;

use async_trait::async_trait;
use opendeal_bitcoin::{
    EscrowDescriptor, EscrowKeys, FundingInfo, FundingStatus, SettlementPsbt, SettlementPurpose,
};
use opendeal_core::SettlementModel;
use serde::{Deserialize, Serialize};

pub use fiat::FiatSettlementAdapter;
pub use lightning::LightningSettlementAdapter;
pub use simulated::SimulatedSettlementAdapter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCheckout {
    pub reference: String,
    pub checkout_reference: String,
    pub label: String,
}

#[derive(Debug)]
pub struct SettlementError(pub String);

impl std::fmt::Display for SettlementError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "settlement error: {}", self.0);
    }
}

impl std::error::Error for SettlementError {}

/**
 * Capability-oriented settlement. Implementations declare what they support; callers must not
 * assume every adapter can unilaterally move funds.
 */
#[async_trait]
pub trait SettlementAdapter: Send + Sync {
    fn settlement_model(&self) -> SettlementModel;

    async fn prepare_funding(
        &self,
        keys: &EscrowKeys,
        network: &str,
        amount_sats: u64,
    ) -> Result<(Option<EscrowDescriptor>, FundingInfo), SettlementError>;

    async fn verify_funding(
        &self,
        escrow: Option<&EscrowDescriptor>,
        funding: &FundingInfo,
        reference: Option<&str>,
    ) -> Result<FundingStatus, SettlementError>;

    #[allow(clippy::too_many_arguments)]
    async fn propose_settlement(
        &self,
        escrow: &EscrowDescriptor,
        funding_txid: &str,
        funding_vout: u32,
        funding_amount_sats: u64,
        destination: &str,
        fee_sats: u64,
        purpose: SettlementPurpose,
    ) -> Result<SettlementPsbt, SettlementError>;

    async fn attach_signature(
        &self,
        base_psbt: &str,
        signed_psbt: &str,
    ) -> Result<String, SettlementError>;

    async fn finalize_and_broadcast(&self, psbt_base64: &str) -> Result<String, SettlementError>;

    /// Provider-style checkout (Lightning/fiat). Multisig returns an error; use prepare_funding.
    async fn request_provider_payment(
        &self,
        _reference: &str,
        _amount_sats: u64,
    ) -> Result<ProviderCheckout, SettlementError> {
        return Err(SettlementError(
            "this settlement model does not support provider checkout".into(),
        ));
    }

    /// Unilateral provider release for custodial rails only. Multisig must not implement this as spend.
    async fn provider_release(&self, _reference: &str) -> Result<(), SettlementError> {
        return Err(SettlementError(
            "unilateral release is not available for this settlement model".into(),
        ));
    }

    async fn provider_refund(&self, _reference: &str) -> Result<(), SettlementError> {
        return Err(SettlementError(
            "unilateral refund is not available for this settlement model".into(),
        ));
    }
}

/// Thin wrapper around `BitcoinMultisigAdapter`.
pub struct MultisigSettlementAdapter {
    inner: opendeal_bitcoin::BitcoinMultisigAdapter,
}

impl MultisigSettlementAdapter {
    pub fn new(inner: opendeal_bitcoin::BitcoinMultisigAdapter) -> Self {
        return MultisigSettlementAdapter { inner };
    }
}

#[async_trait]
impl SettlementAdapter for MultisigSettlementAdapter {
    fn settlement_model(&self) -> SettlementModel {
        return SettlementModel::BitcoinMultisig2of3;
    }

    async fn prepare_funding(
        &self,
        keys: &EscrowKeys,
        network: &str,
        amount_sats: u64,
    ) -> Result<(Option<EscrowDescriptor>, FundingInfo), SettlementError> {
        let (escrow, info) = self
            .inner
            .prepare_funding(keys, network, amount_sats)
            .map_err(|e| SettlementError(e.to_string()))?;
        return Ok((Some(escrow), info));
    }

    async fn verify_funding(
        &self,
        escrow: Option<&EscrowDescriptor>,
        funding: &FundingInfo,
        _reference: Option<&str>,
    ) -> Result<FundingStatus, SettlementError> {
        let escrow = escrow.ok_or_else(|| SettlementError("escrow descriptor required".into()))?;
        return self
            .inner
            .verify_funding(escrow, funding.expected_amount_sats)
            .await
            .map_err(|e| SettlementError(e.to_string()));
    }

    async fn propose_settlement(
        &self,
        escrow: &EscrowDescriptor,
        funding_txid: &str,
        funding_vout: u32,
        funding_amount_sats: u64,
        destination: &str,
        fee_sats: u64,
        purpose: SettlementPurpose,
    ) -> Result<SettlementPsbt, SettlementError> {
        return self
            .inner
            .propose_settlement(
                escrow,
                funding_txid,
                funding_vout,
                funding_amount_sats,
                destination,
                fee_sats,
                purpose,
            )
            .map_err(|e| SettlementError(e.to_string()));
    }

    async fn attach_signature(
        &self,
        base_psbt: &str,
        signed_psbt: &str,
    ) -> Result<String, SettlementError> {
        return self
            .inner
            .attach_signature(base_psbt, signed_psbt)
            .map_err(|e| SettlementError(e.to_string()));
    }

    async fn finalize_and_broadcast(&self, psbt_base64: &str) -> Result<String, SettlementError> {
        return self
            .inner
            .finalize_and_broadcast(psbt_base64)
            .await
            .map_err(|e| SettlementError(e.to_string()));
    }
}
