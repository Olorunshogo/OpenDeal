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
    if state.config.app_env == AppEnv::Production {
        return Err(ApiError::forbidden(
            "dev session mint is disabled in production",
        ));
    }
    let pubkey = request.pubkey.trim().to_ascii_lowercase();
    let ok_len = pubkey.len() == 64 || pubkey.len() == 66;
    if !ok_len || !pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request(
            "pubkey must be 64-hex x-only or 66-hex compressed secp256k1",
        ));
    }
    if pubkey.len() == 66 && !(pubkey.starts_with("02") || pubkey.starts_with("03")) {
        return Err(ApiError::bad_request(
            "compressed pubkey must start with 02 or 03",
        ));
    }

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
