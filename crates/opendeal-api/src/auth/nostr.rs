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
    fn issue(&self, pubkey: &str) -> Result<String, ApiError> {
        let nonce = Uuid::new_v4().to_string();
        let mut nonces = self.nonces.lock().expect("nonce store mutex poisoned");
        nonces.retain(|_, (_, expires)| *expires > Instant::now());
        if nonces.len() >= 10_000 {
            return Err(ApiError::conflict_with_code(
                "login challenge capacity reached; retry later",
                "auth_capacity",
            ));
        }
        nonces.insert(
            pubkey.to_string(),
            (nonce.clone(), Instant::now() + CHALLENGE_TTL),
        );
        return Ok(nonce);
    }

    fn take(&self, pubkey: &str, content: &str) -> Option<String> {
        let mut nonces = self.nonces.lock().expect("nonce store mutex poisoned");
        let (nonce, expires_at) = nonces.get(pubkey)?;
        if Instant::now() > *expires_at || nonce != content {
            return None;
        }
        return nonces.remove(pubkey).map(|(nonce, _)| nonce);
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
    let public = PublicKey::from_hex(&request.pubkey)
        .map_err(|_| ApiError::bad_request("pubkey must be a valid hex Nostr public key"))?;
    let nonce = state.nonces.issue(&public.to_hex())?;
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
    let fields = request
        .event
        .as_object()
        .ok_or_else(|| ApiError::bad_request("event must be an object"))?;
    if fields.keys().any(|key| {
        ![
            "id",
            "pubkey",
            "created_at",
            "kind",
            "tags",
            "content",
            "sig",
        ]
        .contains(&key.as_str())
    }) {
        return Err(ApiError::bad_request("unknown Nostr event field"));
    }
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
    let now = Utc::now().timestamp().max(0) as u64;
    if event.created_at.as_secs().abs_diff(now) > CHALLENGE_TTL.as_secs() {
        return Err(ApiError::unauthorized(
            "login event timestamp is outside the challenge window",
        ));
    }
    let pubkey = event.pubkey.to_hex();
    let expected_nonce = state.nonces.take(&pubkey, &event.content).ok_or_else(|| {
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nonce_is_single_use_and_wrong_content_does_not_consume_it() {
        let store = NonceStore::default();
        let nonce = store.issue("identity").unwrap();
        assert!(store.take("identity", "wrong").is_none());
        assert_eq!(store.take("identity", &nonce), Some(nonce.clone()));
        assert!(store.take("identity", &nonce).is_none());
    }
    #[test]
    fn expired_nonce_cannot_authenticate() {
        let store = NonceStore::default();
        store.nonces.lock().unwrap().insert(
            "identity".into(),
            ("nonce".into(), Instant::now() - Duration::from_secs(1)),
        );
        assert!(store.take("identity", "nonce").is_none());
    }
}
