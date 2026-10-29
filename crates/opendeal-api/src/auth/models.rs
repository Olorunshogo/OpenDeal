use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub pubkey: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize)]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum Custody {
    SelfCustody,
}

#[allow(dead_code)]
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub pubkey: String,
    pub custody: Custody,
    pub email: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NostrChallengeRequest {
    pub pubkey: String,
}

#[derive(Debug, Serialize)]
pub struct NostrChallengeResponse {
    pub nonce: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NostrLoginRequest {
    pub event: serde_json::Value,
}
