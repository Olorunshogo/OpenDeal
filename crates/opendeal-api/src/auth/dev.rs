use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;

use crate::auth::models::{Custody, LoginResponse, User};
use crate::config::AppEnv;
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DevSessionRequest {
    pub pubkey: String,
}

pub fn router() -> Router<AppState> {
    return Router::new().route("/session", post(dev_session));
}

async fn dev_session(
    State(state): State<AppState>,
    Json(request): Json<DevSessionRequest>,
) -> Result<Json<ApiEnvelope<LoginResponse>>, ApiError> {
    // Issues a session without proof of key possession, so it is opt-in for local tooling only.
    if state.config.app_env == AppEnv::Production || !state.config.dev_session_enabled {
        return Err(ApiError::forbidden(
            "dev session mint is disabled; sign in with a Nostr challenge (set OPENDEAL_DEV_SESSION_ENABLED=true only for local test tooling)",
        ));
    }
    let pubkey = opendeal_core::verification::normalize_identity(&request.pubkey)
        .map_err(|_| ApiError::bad_request("invalid secp256k1 public key"))?;

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (pubkey, custody)
        VALUES ($1, $2)
        ON CONFLICT (pubkey) DO UPDATE SET pubkey = EXCLUDED.pubkey
        RETURNING pubkey, custody, email, created_at
        "#,
    )
    .bind(&pubkey)
    .bind(Custody::SelfCustody)
    .fetch_one(&state.pool)
    .await?;

    let token = state.jwt.issue(&user.pubkey)?;
    return Ok(Json(ApiEnvelope::ok(
        "dev session issued (regtest / local only)",
        LoginResponse {
            token,
            pubkey: user.pubkey,
        },
    )));
}
