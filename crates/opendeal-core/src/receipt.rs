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
        for sig in &self.agreement_signatures {
            crate::verification::verify_agreement_signature(&self.agreement, sig)?;
        }
        verify_event_chain(&self.events)?;
        return Ok(());
    }

    pub fn to_pretty_json(&self) -> Result<String, ProtocolError> {
        return serde_json::to_string_pretty(self)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()));
    }
}
