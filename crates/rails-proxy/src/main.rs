use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

/*
 * Sandbox implementation of the HTTP invoice contract in docs/rails.md.
 *
 * OpenDeal's Lightning/fiat settlement adapters (crates/opendeal-api/src/settlement) talk to
 * this contract over HTTP. This binary is an in-memory stand-in: no real Lightning or fiat
 * funds ever move through it. To go live, replace the bodies of create_invoice /
 * invoice_status / release / refund with calls to a real provider (Bitnob, MavaPay, an NWC
 * wallet, Paystack, Flutterwave) and keep the same request/response shapes so the API side
 * needs no changes.
 */

#[derive(Clone, Default)]
struct InvoiceRecord {
    amount_sats: u64,
    funded: bool,
    txid: Option<String>,
}

#[derive(Clone)]
struct AppState {
    token: String,
    invoices: Arc<Mutex<HashMap<String, InvoiceRecord>>>,
}

#[derive(Debug, Deserialize)]
struct CreateInvoiceRequest {
    reference: String,
    amount_sats: u64,
}

#[derive(Debug, Serialize)]
struct CreateInvoiceResponse {
    checkout_reference: String,
    label: Option<String>,
}

#[derive(Debug, Serialize)]
struct InvoiceStatusResponse {
    funded: bool,
    amount_sats: Option<u64>,
    txid: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct MarkFundedRequest {
    #[serde(default)]
    txid: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let token =
        env::var("RAILS_PROXY_TOKEN").unwrap_or_else(|_| "dev-rails-proxy-token".to_string());
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8081);

    let state = AppState {
        token,
        invoices: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/invoices", post(create_invoice))
        .route("/invoices/{reference}", get(invoice_status))
        .route("/invoices/{reference}/release", post(release))
        .route("/invoices/{reference}/refund", post(refund))
        .route("/sandbox/invoices/{reference}/fund", post(mark_funded))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind rails-proxy port");
    tracing::warn!(
        port,
        "rails-proxy listening — SANDBOX ONLY, no real funds move"
    );
    axum::serve(listener, app).await.expect("serve rails-proxy");
}

fn check_auth(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    let expected = format!("Bearer {}", state.token);
    let ok = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == expected)
        .unwrap_or(false);
    if ok {
        return Ok(());
    }
    return Err((StatusCode::UNAUTHORIZED, "missing or invalid bearer token").into_response());
}

async fn create_invoice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateInvoiceRequest>,
) -> Result<Json<CreateInvoiceResponse>, Response> {
    check_auth(&state, &headers)?;
    let mut invoices = state.invoices.lock().unwrap();
    invoices.insert(
        req.reference.clone(),
        InvoiceRecord {
            amount_sats: req.amount_sats,
            funded: false,
            txid: None,
        },
    );
    return Ok(Json(CreateInvoiceResponse {
        checkout_reference: req.reference,
        label: Some(format!("sandbox invoice for {} sats", req.amount_sats)),
    }));
}

async fn invoice_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<InvoiceStatusResponse>, Response> {
    check_auth(&state, &headers)?;
    let invoices = state.invoices.lock().unwrap();
    let record = invoices
        .get(&reference)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "unknown reference").into_response())?;
    return Ok(Json(InvoiceStatusResponse {
        funded: record.funded,
        amount_sats: Some(record.amount_sats),
        txid: record.txid.clone(),
    }));
}

async fn release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<StatusCode, Response> {
    check_auth(&state, &headers)?;
    let invoices = state.invoices.lock().unwrap();
    if invoices.contains_key(&reference) {
        return Ok(StatusCode::OK);
    }
    return Err((StatusCode::NOT_FOUND, "unknown reference").into_response());
}

async fn refund(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<StatusCode, Response> {
    check_auth(&state, &headers)?;
    let invoices = state.invoices.lock().unwrap();
    if invoices.contains_key(&reference) {
        return Ok(StatusCode::OK);
    }
    return Err((StatusCode::NOT_FOUND, "unknown reference").into_response());
}

/* Sandbox-only: flips `funded` so you can exercise the OpenDeal API's status polling without
 * a real provider webhook. No equivalent route exists on a real provider — delete this handler
 * and its route once you replace the sandbox body above with a real client. */
async fn mark_funded(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reference): Path<String>,
    body: Option<Json<MarkFundedRequest>>,
) -> Result<StatusCode, Response> {
    check_auth(&state, &headers)?;
    let req = body.map(|Json(v)| v).unwrap_or_default();
    let mut invoices = state.invoices.lock().unwrap();
    let record = invoices
        .get_mut(&reference)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "unknown reference").into_response())?;
    record.funded = true;
    record.txid = req.txid;
    return Ok(StatusCode::OK);
}
