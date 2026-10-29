use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("illegal status transition from {from} to {to}")]
    IllegalTransition { from: String, to: String },

    #[error("canonicalization failed: {0}")]
    Canonicalization(String),

    #[error("invalid signature: {0}")]
    InvalidSignature(String),

    #[error("event chain broken: {0}")]
    BrokenChain(String),

    #[error("unauthorized actor for this action: {0}")]
    Unauthorized(String),

    #[error("invalid agreement: {0}")]
    InvalidAgreement(String),
}
