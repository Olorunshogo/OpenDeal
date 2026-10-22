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

#[derive(Debug, Deserialize)]
pub struct CreateDealRequest {
    pub title: String,
    pub amount_sats: u64,
    pub buyer_pubkey: String,
    pub mediator_pubkey: String,
    pub delivery_deadline: DateTime<Utc>,
    pub acceptance_window_hours: u32,
    #[serde(default)]
    pub currency: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SignAgreementRequest {
    pub signature: opendeal_core::Signature,
}

#[derive(Debug, Deserialize)]
pub struct TransitionDealRequest {
    pub to: DealStatus,
}

#[derive(Debug, Deserialize)]
pub struct ProposeSettlementRequest {
    pub destination_address: String,
    pub fee_sats: u64,
    pub purpose: String,
}

#[derive(Debug, Deserialize)]
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
