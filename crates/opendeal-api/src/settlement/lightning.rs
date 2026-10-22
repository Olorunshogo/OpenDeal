use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use opendeal_bitcoin::{
    EscrowDescriptor, EscrowKeys, FundingInfo, FundingStatus, SettlementPsbt, SettlementPurpose,
};
use opendeal_core::SettlementModel;

use super::http_invoice::{HttpInvoiceClient, status_funded};
use super::{ProviderCheckout, SettlementAdapter, SettlementError};

/**
 * Lightning adapter. With API credentials this calls the operator invoice HTTP API.
 * Without credentials it keeps an in-memory stub for local development only.
 * Custody stays with the provider. Never labeled as BitcoinMultisig2of3.
 */
pub struct LightningSettlementAdapter {
    http: Option<HttpInvoiceClient>,
    invoices: Mutex<HashMap<String, u64>>,
}

impl LightningSettlementAdapter {
    pub fn new() -> Self {
        return LightningSettlementAdapter {
            http: None,
            invoices: Mutex::new(HashMap::new()),
        };
    }

    pub fn with_http(client: HttpInvoiceClient) -> Self {
        return LightningSettlementAdapter {
            http: Some(client),
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
        if let Some(http) = &self.http {
            let status = http.invoice_status(reference).await?;
            let (confirmed, txid, amount) = status_funded(&status, funding.expected_amount_sats);
            return Ok(FundingStatus {
                funded: confirmed,
                txid: confirmed.then(|| txid.unwrap_or_else(|| format!("ln:{reference}"))),
                vout: confirmed.then_some(0),
                amount_sats: amount,
                confirmations: if confirmed { 1 } else { 0 },
                script_matches: confirmed,
            });
        }
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
        if let Some(http) = &self.http {
            return http.create_invoice(reference, amount_sats).await;
        }
        self.invoices
            .lock()
            .expect("lightning invoice mutex")
            .insert(reference.to_string(), amount_sats);
        return Ok(ProviderCheckout {
            reference: reference.to_string(),
            checkout_reference: format!("lnbc_stub_{}", reference),
            label: "lightning_provider_stub".into(),
        });
    }

    async fn provider_release(&self, reference: &str) -> Result<(), SettlementError> {
        if let Some(http) = &self.http {
            return http.post_action(reference, "release").await;
        }
        return Ok(());
    }

    async fn provider_refund(&self, reference: &str) -> Result<(), SettlementError> {
        if let Some(http) = &self.http {
            return http.post_action(reference, "refund").await;
        }
        return Ok(());
    }
}
