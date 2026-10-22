use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use nostr::event::{Event, Kind};
use nostr::key::PublicKey;
use uuid::Uuid;

use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;

use super::models::{
    Custody, LoginResponse, NostrChallengeRequest, NostrChallengeResponse, NostrLoginRequest, User,
};

const LOGIN_EVENT_KIND: u16 = 22242;
const CHALLENGE_TTL: Duration = Duration::from_secs(5 * 60);

pub struct NonceStore {
    nonces: Mutex<HashMap<String, (String, Instant)>>,
}

impl Default for NonceStore {
    fn default() -> Self {
        return NonceStore {
            nonces: Mutex::new(HashMap::new()),
        };
    }
}

impl NonceStore {
    fn issue(&self, pubkey: &str) -> String {
        let nonce = Uuid::new_v4().to_string();
        let mut nonces = self.nonces.lock().expect("nonce store mutex poisoned");
        nonces.insert(
            pubkey.to_string(),
            (nonce.clone(), Instant::now() + CHALLENGE_TTL),
        );
        return nonce;
    }

    fn take(&self, pubkey: &str) -> Option<String> {
        let mut nonces = self.nonces.lock().expect("nonce store mutex poisoned");
        let (nonce, expires_at) = nonces.remove(pubkey)?;
        if Instant::now() > expires_at {
            return None;
        }
        return Some(nonce);
    }
}

pub fn router() -> Router<AppState> {
    return Router::new()
        .route("/challenge", post(challenge))
        .route("/login", post(login));
}

async fn challenge(
    State(state): State<AppState>,
    Json(request): Json<NostrChallengeRequest>,
) -> Result<Json<ApiEnvelope<NostrChallengeResponse>>, ApiError> {
    PublicKey::from_hex(&request.pubkey)
        .map_err(|_| ApiError::bad_request("pubkey must be a valid hex Nostr public key"))?;
    let nonce = state.nonces.issue(&request.pubkey);
    let expires_at = Utc::now() + CHALLENGE_TTL;
    return Ok(Json(ApiEnvelope::ok(
        "challenge issued",
        NostrChallengeResponse { nonce, expires_at },
    )));
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<NostrLoginRequest>,
) -> Result<Json<ApiEnvelope<LoginResponse>>, ApiError> {
    let event = Event::from_json(request.event.to_string())
        .map_err(|_| ApiError::bad_request("event is not a valid Nostr event"))?;
    event
        .verify()
        .map_err(|_| ApiError::unauthorized("event id or signature is invalid"))?;
    if event.kind != Kind::from(LOGIN_EVENT_KIND) {
        return Err(ApiError::bad_request(format!(
            "event kind must be {}",
            LOGIN_EVENT_KIND
        )));
    }
    let pubkey = event.pubkey.to_hex();
    let expected_nonce = state.nonces.take(&pubkey).ok_or_else(|| {
        ApiError::unauthorized("no challenge outstanding for this pubkey, or it expired")
    })?;
    if event.content != expected_nonce {
        return Err(ApiError::unauthorized(
            "signed event does not match the issued challenge",
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
        "logged in",
        LoginResponse {
            token,
            pubkey: user.pubkey,
        },
    )));
}
