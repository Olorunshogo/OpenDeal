//! OpenDeal protocol primitives.
//!
//! Conventions for this crate: explicit `return` on every function; positional `format!` args;
//! protocol types are serde-friendly and independently verifiable without trusting an API.

#![allow(clippy::needless_return, clippy::uninlined_format_args)]

pub mod agreement;
pub mod error;
pub mod event;
pub mod receipt;
pub mod settlement;
pub mod state;
pub mod verification;

pub use agreement::{Agreement, AgreementId, PartyRole};
pub use error::ProtocolError;
pub use event::{DealEvent, EventKind, EventPayload};
pub use receipt::DealReceipt;
pub use settlement::SettlementModel;
pub use state::DealStatus;
pub use verification::{Signature, sign_bytes, verify_agreement_signature, verify_event_chain};
