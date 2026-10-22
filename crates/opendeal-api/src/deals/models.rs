use chrono::{DateTime, Utc};
use opendeal_core::{DealStatus, SettlementModel};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Deal {
    pub id: String,
    pub status: String,
    pub title: String,
    pub amount_sats: i64,
    pub currency: String,
    pub seller_pubkey: String,
    pub buyer_pubkey: String,
    pub mediator_pubkey: String,
    pub settlement_model: String,
    pub network: String,
    pub escrow_address: Option<String>,
    pub funding_txid: Option<String>,
    pub funding_vout: Option<i32>,
    pub funding_amount_sats: Option<i64>,
    pub settlement_txid: Option<String>,
    pub current_psbt: Option<String>,
    #[serde(skip_serializing)]
    pub agreement_json: serde_json::Value,
    pub settlement_purpose: Option<String>,
    pub settlement_proposal: Option<String>,
    pub settlement_phase: String,
    pub settlement_confirmations: i32,
    pub settlement_block_hash: Option<String>,
    #[serde(skip_serializing)]
    pub settlement_raw_tx: Option<String>,
    pub settlement_from_status: Option<String>,
    pub broadcast_attempted_at: Option<DateTime<Utc>>,
    pub delivery_deadline: DateTime<Utc>,
    pub acceptance_window_hours: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Deal {
    pub fn status_enum(&self) -> Result<DealStatus, String> {
        return match self.status.as_str() {
            "draft" => Ok(DealStatus::Draft),
            "agreed" => Ok(DealStatus::Agreed),
            "awaiting_payment" => Ok(DealStatus::AwaitingPayment),
            "funded" => Ok(DealStatus::Funded),
            "shipped" => Ok(DealStatus::Shipped),
            "accepted" => Ok(DealStatus::Accepted),
            "settled" => Ok(DealStatus::Settled),
            "cancelled" => Ok(DealStatus::Cancelled),
            "disputed" => Ok(DealStatus::Disputed),
            "refunded" => Ok(DealStatus::Refunded),
            "expired" => Ok(DealStatus::Expired),
            other => Err(format!("unknown status {}", other)),
        };
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateDealRequest {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub seller_payout_address: Option<String>,
    #[serde(default)]
    pub buyer_refund_address: Option<String>,
    #[serde(default)]
    pub seller_pubkey: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub settlement_model: Option<String>,
    pub amount_sats: u64,
    pub buyer_pubkey: String,
    pub mediator_pubkey: String,
    pub delivery_deadline: DateTime<Utc>,
    pub acceptance_window_hours: u32,
    #[serde(default)]
    pub currency: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignAgreementRequest {
    pub signature: opendeal_core::Signature,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionDealRequest {
    pub to: DealStatus,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposeSettlementRequest {
    pub destination_address: String,
    pub fee_sats: u64,
    pub purpose: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachPsbtSignatureRequest {
    pub signed_psbt: String,
}

pub fn parse_settlement_model(s: &str) -> SettlementModel {
    return match s {
        "lightning_provider" => SettlementModel::LightningProvider,
        "fiat_provider" => SettlementModel::FiatProvider,
        "simulated" => SettlementModel::Simulated,
        _ => SettlementModel::BitcoinMultisig2of3,
    };
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmSettlementRequest {
    pub block_hash: Option<String>,
}
