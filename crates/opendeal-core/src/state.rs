use serde::{Deserialize, Serialize};

use crate::error::ProtocolError;

/**
 * Transaction lifecycle. `allowed_next` is the single source of truth for legal transitions.
 * Clients must never be able to settle a deal by sending an arbitrary status.
 */
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DealStatus {
    Draft,
    Agreed,
    AwaitingPayment,
    Funded,
    Shipped,
    Accepted,
    Settled,
    Cancelled,
    Disputed,
    Refunded,
    Expired,
}

impl DealStatus {
    pub fn as_str(self) -> &'static str {
        return match self {
            DealStatus::Draft => "draft",
            DealStatus::Agreed => "agreed",
            DealStatus::AwaitingPayment => "awaiting_payment",
            DealStatus::Funded => "funded",
            DealStatus::Shipped => "shipped",
            DealStatus::Accepted => "accepted",
            DealStatus::Settled => "settled",
            DealStatus::Cancelled => "cancelled",
            DealStatus::Disputed => "disputed",
            DealStatus::Refunded => "refunded",
            DealStatus::Expired => "expired",
        };
    }

    pub fn allowed_next(self) -> &'static [DealStatus] {
        use DealStatus::*;
        return match self {
            Draft => &[Agreed, Cancelled],
            Agreed => &[AwaitingPayment, Cancelled],
            AwaitingPayment => &[Funded, Expired, Cancelled],
            Funded => &[Shipped, Disputed, Cancelled],
            Shipped => &[Accepted, Disputed],
            Accepted => &[Settled, Disputed],
            Disputed => &[Settled, Refunded],
            Settled | Cancelled | Refunded | Expired => &[],
        };
    }

    pub fn can_transition_to(self, next: DealStatus) -> bool {
        return self.allowed_next().contains(&next);
    }

    pub fn transition_to(self, next: DealStatus) -> Result<DealStatus, ProtocolError> {
        if !self.can_transition_to(next) {
            return Err(ProtocolError::IllegalTransition {
                from: self.as_str().to_string(),
                to: next.as_str().to_string(),
            });
        }
        return Ok(next);
    }
}

impl std::fmt::Display for DealStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "{}", self.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_transitions() {
        let path = [
            DealStatus::Draft,
            DealStatus::Agreed,
            DealStatus::AwaitingPayment,
            DealStatus::Funded,
            DealStatus::Shipped,
            DealStatus::Accepted,
            DealStatus::Settled,
        ];
        for window in path.windows(2) {
            assert!(window[0].can_transition_to(window[1]));
        }
    }

    #[test]
    fn rejects_settling_from_draft() {
        let err = DealStatus::Draft
            .transition_to(DealStatus::Settled)
            .unwrap_err();
        assert!(matches!(err, ProtocolError::IllegalTransition { .. }));
    }

    #[test]
    fn dispute_exits_to_settled_or_refunded() {
        assert!(DealStatus::Disputed.can_transition_to(DealStatus::Settled));
        assert!(DealStatus::Disputed.can_transition_to(DealStatus::Refunded));
        assert!(!DealStatus::Disputed.can_transition_to(DealStatus::Funded));
    }
}
