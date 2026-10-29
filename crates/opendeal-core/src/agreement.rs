use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::ProtocolError;
use crate::settlement::SettlementModel;

/// Hex-encoded SHA-256 of the canonical agreement bytes. Also used as the stable deal id.
pub type AgreementId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartyRole {
    Buyer,
    Seller,
    Mediator,
}

/**
 * Machine-readable deal terms. Canonicalization uses compact JSON serialization in this
 * struct's fixed field order, not lexicographic key sorting. Both parties sign identical bytes.
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agreement {
    pub version: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seller_payout_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buyer_refund_address: Option<String>,
    pub amount_sats: u64,
    pub currency: String,
    pub seller_pubkey: String,
    pub buyer_pubkey: String,
    pub mediator_pubkey: String,
    pub delivery_deadline: DateTime<Utc>,
    pub acceptance_window_hours: u32,
    pub settlement_model: SettlementModel,
    pub network: String,
    pub created_at: DateTime<Utc>,
}

impl Agreement {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.version != Self::CURRENT_VERSION {
            return Err(ProtocolError::InvalidAgreement(format!(
                "unsupported agreement version {}",
                self.version
            )));
        }
        if self.title.trim().is_empty() {
            return Err(ProtocolError::InvalidAgreement(
                "title must not be empty".into(),
            ));
        }
        if self.amount_sats == 0 {
            return Err(ProtocolError::InvalidAgreement(
                "amount_sats must be > 0".into(),
            ));
        }
        let seller = crate::verification::normalize_identity(&self.seller_pubkey)?;
        let buyer = crate::verification::normalize_identity(&self.buyer_pubkey)?;
        let mediator = crate::verification::normalize_identity(&self.mediator_pubkey)?;
        if seller == buyer || seller == mediator || buyer == mediator {
            return Err(ProtocolError::InvalidAgreement(
                "buyer, seller and mediator must be distinct keys".into(),
            ));
        }
        if self.network.trim().is_empty() {
            return Err(ProtocolError::InvalidAgreement(
                "network must not be empty".into(),
            ));
        }
        return Ok(());
    }

    /// Deterministic JSON bytes used for hashing and signing.
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        return serde_json::to_vec(self)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()));
    }

    pub fn agreement_id(&self) -> Result<AgreementId, ProtocolError> {
        let bytes = self.canonical_bytes()?;
        let digest = Sha256::digest(&bytes);
        return Ok(hex::encode(digest));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_key(value: u8) -> String {
        let secp = secp256k1::Secp256k1::new();
        let secret = secp256k1::SecretKey::from_slice(&[value; 32]).unwrap();
        secp256k1::PublicKey::from_secret_key(&secp, &secret).to_string()
    }

    fn sample() -> Agreement {
        return Agreement {
            version: 1,
            description: None,
            seller_payout_address: None,
            buyer_refund_address: None,
            title: "Used laptop".into(),
            amount_sats: 50_000,
            currency: "BTC".into(),
            seller_pubkey: sample_key(1),
            buyer_pubkey: sample_key(2),
            mediator_pubkey: sample_key(3),
            delivery_deadline: Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap(),
            acceptance_window_hours: 48,
            settlement_model: SettlementModel::BitcoinMultisig2of3,
            network: "regtest".into(),
            created_at: Utc.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap(),
        };
    }

    #[test]
    fn id_is_stable() {
        let a = sample();
        let b = sample();
        assert_eq!(a.agreement_id().unwrap(), b.agreement_id().unwrap());
        assert_eq!(a.agreement_id().unwrap().len(), 64);
    }

    #[test]
    fn rejects_zero_amount() {
        let mut a = sample();
        a.amount_sats = 0;
        assert!(a.validate().is_err());
    }
}
