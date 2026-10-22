use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::ProtocolError;
use crate::state::DealStatus;
use crate::verification::Signature;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    DealCreated,
    AgreementSigned,
    StatusTransitioned,
    FundingDetected,
    FundingConfirmed,
    EvidenceSubmitted,
    DisputeOpened,
    DisputeResolved,
    SettlementProposed,
    SettlementBroadcast,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventPayload {
    DealCreated {
        agreement_id: String,
    },
    AgreementSigned {
        role: String,
        pubkey: String,
    },
    StatusTransitioned {
        from: DealStatus,
        to: DealStatus,
    },
    FundingDetected {
        txid: String,
        vout: u32,
        amount_sats: u64,
    },
    FundingConfirmed {
        txid: String,
        vout: u32,
        confirmations: u32,
    },
    EvidenceSubmitted {
        evidence_id: String,
        kind: String,
    },
    DisputeOpened {
        dispute_id: String,
        reason: String,
    },
    DisputeResolved {
        dispute_id: String,
        decision: String,
        rationale: String,
    },
    SettlementProposed {
        psbt_base64: String,
        purpose: String,
    },
    SettlementBroadcast {
        txid: String,
    },
}

/**
 * Hash-chained deal event. `prev_event_hash` is empty hex for the genesis event; every later
 * event binds the prior digest so the receipt chain is independently auditable.
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DealEvent {
    pub agreement_id: String,
    pub sequence: u64,
    pub kind: EventKind,
    pub payload: EventPayload,
    pub actor_pubkey: String,
    pub prev_event_hash: String,
    pub created_at: DateTime<Utc>,
    pub signature: Option<Signature>,
}

impl DealEvent {
    pub fn unsigned(
        agreement_id: String,
        sequence: u64,
        kind: EventKind,
        payload: EventPayload,
        actor_pubkey: String,
        prev_event_hash: String,
        created_at: DateTime<Utc>,
    ) -> Self {
        return DealEvent {
            agreement_id,
            sequence,
            kind,
            payload,
            actor_pubkey,
            prev_event_hash,
            created_at,
            signature: None,
        };
    }

    /// Bytes that are hashed and signed (signature field excluded).
    pub fn signing_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        #[derive(Serialize)]
        struct Signable<'a> {
            agreement_id: &'a str,
            sequence: u64,
            kind: &'a EventKind,
            payload: &'a EventPayload,
            actor_pubkey: &'a str,
            prev_event_hash: &'a str,
            created_at: &'a DateTime<Utc>,
        }
        let body = Signable {
            agreement_id: &self.agreement_id,
            sequence: self.sequence,
            kind: &self.kind,
            payload: &self.payload,
            actor_pubkey: &self.actor_pubkey,
            prev_event_hash: &self.prev_event_hash,
            created_at: &self.created_at,
        };
        return serde_json::to_vec(&body)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()));
    }

    pub fn event_hash(&self) -> Result<String, ProtocolError> {
        let bytes = self.signing_bytes()?;
        return Ok(hex::encode(Sha256::digest(&bytes)));
    }
}
