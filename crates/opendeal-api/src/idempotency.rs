use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use sha2::{Digest, Sha256};

use crate::error::ApiError;
use crate::state::AppState;

/**
 * Optional `Idempotency-Key` header. When present, callers can safely retry funding/settlement
 * mutations; duplicate keys with the same request hash short-circuit to the stored response in a
 * follow-up hardening pass. For MVP we record the key association and reject conflicting hashes.
 */
pub struct IdempotencyKey {
    #[allow(dead_code)]
    pub key: Option<String>,
}

impl FromRequestParts<AppState> for IdempotencyKey {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get("Idempotency-Key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        if let Some(ref k) = key {
            let route = parts.uri.path().to_string();
            let existing: Option<(String,)> =
                sqlx::query_as("SELECT request_hash FROM idempotency_keys WHERE key = $1")
                    .bind(k)
                    .fetch_optional(&state.pool)
                    .await?;
            let request_hash = hex::encode(Sha256::digest(route.as_bytes()));
            if let Some((prev,)) = existing {
                if prev != request_hash {
                    return Err(ApiError::conflict_with_code(
                        "Idempotency-Key reused with a different request",
                        "idempotency_conflict",
                    ));
                }
            } else {
                sqlx::query(
                    r#"
                    INSERT INTO idempotency_keys (key, route, request_hash, response_status, response_body)
                    VALUES ($1, $2, $3, 0, '{}'::jsonb)
                    ON CONFLICT (key) DO NOTHING
                    "#,
                )
                .bind(k)
                .bind(&route)
                .bind(&request_hash)
                .execute(&state.pool)
                .await?;
            }
        }

        return Ok(IdempotencyKey { key });
    }
}
