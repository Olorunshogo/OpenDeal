use serde::{Deserialize, Serialize};

use crate::agreement::Agreement;
use crate::error::ProtocolError;
use crate::event::DealEvent;
use crate::settlement::SettlementModel;
use crate::state::DealStatus;
use crate::verification::{Signature, verify_event_chain};

/// Portable, independently verifiable deal receipt for export / offline checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DealReceipt {
    pub agreement: Agreement,
    pub agreement_id: String,
    pub status: DealStatus,
    pub settlement_model: SettlementModel,
    pub network: String,
    pub agreement_signatures: Vec<Signature>,
    pub events: Vec<DealEvent>,
    pub funding_txid: Option<String>,
    pub settlement_txid: Option<String>,
}

impl DealReceipt {
    pub fn verify(&self) -> Result<(), ProtocolError> {
        let expected_id = self.agreement.agreement_id()?;
        if expected_id != self.agreement_id {
            return Err(ProtocolError::InvalidAgreement(
                "receipt agreement_id does not match canonical hash".into(),
            ));
        }
        if self.settlement_model != self.agreement.settlement_model {
            return Err(ProtocolError::InvalidAgreement(
                "receipt settlement_model does not match agreement".into(),
            ));
        }
        if self.network != self.agreement.network {
            return Err(ProtocolError::InvalidAgreement(
                "receipt network mismatch".into(),
            ));
        }
        for sig in &self.agreement_signatures {
            crate::verification::verify_agreement_signature(&self.agreement, sig)?;
        }
        verify_event_chain(&self.events)?;
        use crate::event::EventPayload;
        let mut status = DealStatus::Draft;
        let mut funding = None;
        let mut settlement = None;
        let mut confirmed = None;
        let mut reorg = false;
        for event in &self.events {
            if event.agreement_id != self.agreement_id {
                return Err(ProtocolError::BrokenChain(
                    "event belongs to another agreement".into(),
                ));
            }
            match &event.payload {
                EventPayload::StatusTransitioned { from, to } => {
                    if *from != status
                        || (!from.can_transition_to(*to)
                            && !(reorg
                                && matches!(from, DealStatus::Settled | DealStatus::Refunded)
                                && matches!(to, DealStatus::Accepted | DealStatus::Disputed)))
                    {
                        return Err(ProtocolError::BrokenChain(
                            "inconsistent status history".into(),
                        ));
                    }
                    status = *to;
                    reorg = false;
                }
                EventPayload::FundingDetected { txid, .. } => funding = Some(txid.clone()),
                EventPayload::SettlementBroadcastRequested { txid }
                | EventPayload::SettlementBroadcast { txid } => settlement = Some(txid.clone()),
                EventPayload::SettlementConfirmed {
                    txid,
                    confirmations,
                    ..
                } if *confirmations > 0 => {
                    if settlement.as_ref() != Some(txid) {
                        return Err(ProtocolError::BrokenChain(
                            "confirmation transaction mismatch".into(),
                        ));
                    }
                    confirmed = Some(txid.clone());
                }
                EventPayload::SettlementReorged { txid } => {
                    if settlement.as_ref() != Some(txid) {
                        return Err(ProtocolError::BrokenChain(
                            "reorg transaction mismatch".into(),
                        ));
                    }
                    confirmed = None;
                    reorg = true;
                }
                _ => {}
            }
        }
        if status != self.status
            || funding != self.funding_txid
            || settlement != self.settlement_txid
        {
            return Err(ProtocolError::BrokenChain(
                "receipt status or transaction metadata disagrees with events".into(),
            ));
        }
        if matches!(self.status, DealStatus::Settled | DealStatus::Refunded)
            && (confirmed.is_none() || confirmed != self.settlement_txid)
        {
            return Err(ProtocolError::BrokenChain(
                "terminal settlement requires confirmation evidence".into(),
            ));
        }
        if !matches!(self.status, DealStatus::Draft | DealStatus::Cancelled) {
            for party in [&self.agreement.buyer_pubkey, &self.agreement.seller_pubkey] {
                let identity = crate::verification::normalize_identity(party)?;
                if !self.agreement_signatures.iter().any(|sig| {
                    crate::verification::normalize_identity(&sig.pubkey)
                        .ok()
                        .as_ref()
                        == Some(&identity)
                }) {
                    return Err(ProtocolError::InvalidSignature(
                        "missing buyer or seller agreement signature".into(),
                    ));
                }
            }
        }
        return Ok(());
    }

    pub fn to_pretty_json(&self) -> Result<String, ProtocolError> {
        return serde_json::to_string_pretty(self)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()));
    }
}
