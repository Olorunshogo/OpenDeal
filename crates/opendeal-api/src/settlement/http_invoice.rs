use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{ProviderCheckout, SettlementError};

/// Operator-supplied invoice API. OpenDeal does not custody funds; the provider does.
pub struct HttpInvoiceClient {
    base_url: String,
    api_key: String,
    label: String,
    client: Client,
}

#[derive(Debug, Serialize)]
struct CreateInvoiceBody {
    reference: String,
    amount_sats: u64,
}

#[derive(Debug, Deserialize)]
struct CreateInvoiceResponse {
    checkout_reference: String,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct InvoiceStatusResponse {
    funded: bool,
    #[serde(default)]
    amount_sats: Option<u64>,
    #[serde(default)]
    txid: Option<String>,
}

impl HttpInvoiceClient {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        label: impl Into<String>,
    ) -> Self {
        return HttpInvoiceClient {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            label: label.into(),
            client: Client::new(),
        };
    }

    pub async fn create_invoice(
        &self,
        reference: &str,
        amount_sats: u64,
    ) -> Result<ProviderCheckout, SettlementError> {
        let url = format!("{}/invoices", self.base_url);
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&CreateInvoiceBody {
                reference: reference.to_string(),
                amount_sats,
            })
            .send()
            .await
            .map_err(|e| SettlementError(format!("provider create invoice: {e}")))?;
        if !response.status().is_success() {
            return Err(SettlementError(format!(
                "provider create invoice http {}",
                response.status()
            )));
        }
        let body: CreateInvoiceResponse = response
            .json()
            .await
            .map_err(|e| SettlementError(format!("provider create invoice body: {e}")))?;
        return Ok(ProviderCheckout {
            reference: reference.to_string(),
            checkout_reference: body.checkout_reference,
            label: body.label.unwrap_or_else(|| self.label.clone()),
        });
    }

    pub(crate) async fn invoice_status(
        &self,
        reference: &str,
    ) -> Result<InvoiceStatusResponse, SettlementError> {
        let url = format!("{}/invoices/{}", self.base_url, reference);
        let response = self
            .client
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| SettlementError(format!("provider invoice status: {e}")))?;
        if !response.status().is_success() {
            return Err(SettlementError(format!(
                "provider invoice status http {}",
                response.status()
            )));
        }
        return response
            .json()
            .await
            .map_err(|e| SettlementError(format!("provider invoice status body: {e}")));
    }

    pub async fn post_action(&self, reference: &str, action: &str) -> Result<(), SettlementError> {
        let url = format!("{}/invoices/{}/{}", self.base_url, reference, action);
        let response = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| SettlementError(format!("provider {action}: {e}")))?;
        if !response.status().is_success() {
            return Err(SettlementError(format!(
                "provider {action} http {}",
                response.status()
            )));
        }
        return Ok(());
    }
}

pub(crate) fn status_funded(
    status: &InvoiceStatusResponse,
    expected: u64,
) -> (bool, Option<String>, Option<u64>) {
    let amount_ok = status.amount_sats.unwrap_or(expected) == expected;
    let funded = status.funded && amount_ok;
    return (
        funded,
        status.txid.clone(),
        funded.then_some(status.amount_sats.unwrap_or(expected)),
    );
}
