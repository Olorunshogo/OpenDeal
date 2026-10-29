use crate::{
    AppState, auth::extractor::AuthenticatedUser, config::AppEnv, error::ApiError,
    response::ApiEnvelope,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use opendeal_core::{Signature, verification::normalize_identity};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Mediator {
    pub id: Uuid,
    pub pubkey: String,
    pub display_name: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub reviewed_by: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mediators", get(discover).post(register))
        .route("/mediators/me", get(me))
        .route("/mediators/review", get(review_queue))
        .route("/mediators/{pubkey}/status", post(review))
        .route("/demo/mediators/{pubkey}/approve", post(demo_approve))
        .route("/demo/wallet", get(wallet))
        .route("/demo/addresses", post(address))
}

fn missing_registry(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|e| e.code().as_deref() == Some("42P01"))
}

pub async fn approved(state: &AppState, key: &str) -> Result<bool, ApiError> {
    let key = normalize_identity(key).map_err(ApiError::from)?;
    let row: Result<Option<(String,)>, _> =
        sqlx::query_as("SELECT status FROM mediators WHERE pubkey=$1")
            .bind(&key)
            .fetch_optional(&state.pool)
            .await;
    match row {
        Ok(Some((status,))) => Ok(status == "approved"),
        Ok(None) => Ok(state.mediator_pubkeys.contains(&key)),
        Err(e) if missing_registry(&e) => Ok(state.mediator_pubkeys.contains(&key)),
        Err(e) => Err(e.into()),
    }
}

async fn discover(
    State(state): State<AppState>,
) -> Result<Json<ApiEnvelope<Vec<serde_json::Value>>>, ApiError> {
    let rows: Result<Vec<Mediator>, _> =
        sqlx::query_as("SELECT * FROM mediators ORDER BY display_name,pubkey")
            .fetch_all(&state.pool)
            .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) if missing_registry(&e) => vec![],
        Err(e) => return Err(e.into()),
    };
    let registered: std::collections::HashSet<_> = rows.iter().map(|r| r.pubkey.clone()).collect();
    let mut public: Vec<_> = rows.into_iter().filter(|r|r.status=="approved").map(|r|serde_json::json!({"pubkey":r.pubkey,"display_name":r.display_name,"status":r.status,"source":"registry"})).collect();
    for key in state
        .mediator_pubkeys
        .iter()
        .filter(|key| !registered.contains(*key))
    {
        public.push(serde_json::json!({"pubkey":key,"display_name":"Configured mediator","status":"approved","source":"configuration"}));
    }
    Ok(Json(ApiEnvelope::ok("approved mediators", public)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Register {
    display_name: String,
    signature: Option<Signature>,
    event: Option<serde_json::Value>,
}
pub fn registration_bytes(pubkey: &str, name: &str) -> Vec<u8> {
    format!("OpenDeal mediator registration v1\n{pubkey}\n{name}").into_bytes()
}
async fn register(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(req): Json<Register>,
) -> Result<Json<ApiEnvelope<Mediator>>, ApiError> {
    let name = req.display_name.trim();
    if name.is_empty() || name.len() > 80 || name.contains(['\n', '\r']) {
        return Err(ApiError::bad_request(
            "Display name must be 1–80 bytes without line breaks",
        ));
    }
    match (req.signature, req.event) {
        (Some(signature), None) => {
            if normalize_identity(&signature.pubkey).map_err(ApiError::from)? != user.pubkey {
                return Err(ApiError::forbidden(
                    "registration signer must match the authenticated identity",
                ));
            }
            opendeal_core::verification::verify_signature(
                &registration_bytes(&user.pubkey, name),
                &signature,
            )
            .map_err(ApiError::from)?;
        }
        (None, Some(value)) => {
            let event = nostr::event::Event::from_json(value.to_string())
                .map_err(|_| ApiError::bad_request("Invalid Nostr registration event"))?;
            event
                .verify()
                .map_err(|_| ApiError::unauthorized("Invalid Nostr registration signature"))?;
            let age = (event.created_at.as_secs() as i128 - Utc::now().timestamp() as i128).abs();
            if event.pubkey.to_hex() != user.pubkey
                || event.kind != nostr::event::Kind::Custom(22242)
                || event.content.as_bytes() != registration_bytes(&user.pubkey, name)
                || age > 300
            {
                return Err(ApiError::bad_request(
                    "Nostr proof must bind this identity and application name, use kind 22242, and be within five minutes",
                ));
            }
        }
        _ => {
            return Err(ApiError::bad_request(
                "Supply exactly one signature or Nostr event proof",
            ));
        }
    }
    // Replay is idempotent: registration can never update status or rename an existing row.
    let configured = state.mediator_pubkeys.contains(&user.pubkey);
    let row=sqlx::query_as("INSERT INTO mediators (id,pubkey,display_name,status,reviewed_at,reviewed_by) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,CASE WHEN $5 THEN 'configured-allowlist' ELSE NULL END) ON CONFLICT (pubkey) DO UPDATE SET pubkey=EXCLUDED.pubkey RETURNING *")
        .bind(Uuid::new_v4()).bind(&user.pubkey).bind(name).bind(if configured {"approved"} else {"pending"}).bind(configured).fetch_one(&state.pool).await?;
    Ok(Json(ApiEnvelope::ok("mediator registered", row)))
}
fn administrator(state: &AppState, key: &str) -> bool {
    state
        .config
        .admin_pubkeys
        .iter()
        .any(|k| normalize_identity(k).ok().as_deref() == Some(key))
}
async fn me(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<ApiEnvelope<Option<Mediator>>>, ApiError> {
    let row = sqlx::query_as("SELECT * FROM mediators WHERE pubkey=$1")
        .bind(&user.pubkey)
        .fetch_optional(&state.pool)
        .await?;
    Ok(Json(ApiEnvelope::ok("my mediator registration", row)))
}
async fn review_queue(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<ApiEnvelope<Vec<Mediator>>>, ApiError> {
    if !administrator(&state, &user.pubkey) {
        return Err(ApiError::forbidden("administrator public key required"));
    }
    let rows = sqlx::query_as("SELECT * FROM mediators ORDER BY created_at")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(ApiEnvelope::ok("mediator review queue", rows)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Review {
    status: String,
}
async fn set_status(
    state: &AppState,
    key: &str,
    status: &str,
    reviewer: &str,
) -> Result<Mediator, ApiError> {
    if !["approved", "suspended"].contains(&status) {
        return Err(ApiError::bad_request(
            "Status must be approved or suspended",
        ));
    }
    sqlx::query_as("UPDATE mediators SET status=$1,reviewed_at=now(),reviewed_by=$2 WHERE pubkey=$3 RETURNING *")
        .bind(status).bind(reviewer).bind(normalize_identity(key).map_err(ApiError::from)?).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::not_found("Register the mediator before review"))
}
async fn review(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(key): Path<String>,
    Json(req): Json<Review>,
) -> Result<Json<ApiEnvelope<Mediator>>, ApiError> {
    if !administrator(&state, &user.pubkey) {
        return Err(ApiError::forbidden("administrator public key required"));
    }
    Ok(Json(ApiEnvelope::ok(
        "mediator status updated",
        set_status(&state, &key, &req.status, &user.pubkey).await?,
    )))
}

pub fn loopback_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "http"
            && u.username().is_empty()
            && u.password().is_none()
            && u.host_str().is_some_and(|h| {
                h == "localhost"
                    || h.parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            })
    })
}
pub fn demo_gate(state: &AppState, peer: SocketAddr, headers: &HeaderMap) -> Result<(), ApiError> {
    if !state.config.demo_enabled
        || state.config.app_env == AppEnv::Production
        || state.config.bitcoin_network != "regtest"
        || !peer.ip().is_loopback()
    {
        return Err(ApiError::forbidden(
            "Demo controls require enabled loopback-only regtest development",
        ));
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !loopback_url(&format!("http://{host}"))
        || headers.contains_key("forwarded")
        || headers.contains_key("x-forwarded-for")
        || headers.contains_key("x-forwarded-host")
    {
        return Err(ApiError::forbidden(
            "Direct loopback demo connection required",
        ));
    }
    if let Some(origin) = headers.get("origin") {
        if !origin.to_str().is_ok_and(loopback_url) {
            return Err(ApiError::forbidden("Loopback browser origin required"));
        }
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Confirm {
    confirmation: String,
}
async fn demo_approve(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(req): Json<Confirm>,
) -> Result<Json<ApiEnvelope<Mediator>>, ApiError> {
    demo_gate(&state, peer, &headers)?;
    if key != user.pubkey || req.confirmation != "APPROVE LOCAL REGTEST MEDIATOR" {
        return Err(ApiError::forbidden(
            "Explicit approval by the registered test identity required",
        ));
    }
    Ok(Json(ApiEnvelope::ok(
        "local regtest mediator approved",
        set_status(
            &state,
            &key,
            "approved",
            &format!("local-regtest:{}", user.pubkey),
        )
        .await?,
    )))
}
async fn core(
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let url = state
        .config
        .bitcoin_rpc_url
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Configure a local regtest Bitcoin RPC wallet"))?;
    if !loopback_url(url) {
        return Err(ApiError::forbidden("Loopback Bitcoin RPC required"));
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| ApiError::bad_request("RPC client unavailable"))?;
    let invoke = async |method: &str,
                        params: serde_json::Value|
           -> Result<serde_json::Value, ApiError> {
        let response=client.post(url).basic_auth(state.config.bitcoin_rpc_user.as_deref().unwrap_or(""),state.config.bitcoin_rpc_password.as_deref()).json(&serde_json::json!({"jsonrpc":"1.0","id":"opendeal-local-demo","method":method,"params":params})).send().await.map_err(|_|ApiError::bad_request("Local regtest wallet unreachable"))?;
        let status = response.status();
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|_| ApiError::bad_request("Invalid local RPC response"))?;
        if !status.is_success() || !value["error"].is_null() {
            return Err(ApiError::bad_request(
                "Local wallet RPC failed; check wallet loading and configuration",
            ));
        }
        Ok(value["result"].clone())
    };
    if invoke("getblockchaininfo", serde_json::json!([])).await?["chain"] != "regtest" {
        return Err(ApiError::forbidden("Bitcoin Core is not on regtest"));
    }
    invoke(method, params).await
}
async fn wallet(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<ApiEnvelope<serde_json::Value>>, ApiError> {
    demo_gate(&state, peer, &headers)?;
    Ok(Json(ApiEnvelope::ok(
        "local wallet balance",
        core(&state, "getbalances", serde_json::json!([])).await?,
    )))
}
async fn address(
    State(state): State<AppState>,
    _user: AuthenticatedUser,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<Confirm>,
) -> Result<Json<ApiEnvelope<serde_json::Value>>, ApiError> {
    demo_gate(&state, peer, &headers)?;
    if req.confirmation != "GENERATE REGTEST ADDRESS" {
        return Err(ApiError::bad_request(
            "Confirm local regtest address generation",
        ));
    }
    let value = core(
        &state,
        "getnewaddress",
        serde_json::json!(["opendeal-guided-demo", "bech32"]),
    )
    .await?;
    if !value.as_str().is_some_and(|a| a.starts_with("bcrt1")) {
        return Err(ApiError::bad_request(
            "Wallet did not return a regtest address",
        ));
    }
    Ok(Json(ApiEnvelope::ok("regtest wallet address", value)))
}
