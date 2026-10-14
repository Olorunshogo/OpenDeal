use thiserror::Error;

#[derive(Debug, Error)]
pub enum BitcoinError {
    #[error("invalid key material: {0}")]
    InvalidKey(String),

    #[error("script/address error: {0}")]
    Script(String),

    #[error("psbt error: {0}")]
    Psbt(String),

    #[error("rpc error: {0}")]
    Rpc(String),

    #[error("funding not found or insufficient: {0}")]
    Funding(String),

    #[error("network mismatch: expected {expected}, got {got}")]
    NetworkMismatch { expected: String, got: String },
}
