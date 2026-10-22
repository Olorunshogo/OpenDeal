use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};

use crate::auth::extractor::AuthenticatedUser;
use crate::error::ApiError;
use crate::idempotency::IdempotencyKey;
use crate::response::ApiEnvelope;
use crate::state::AppState;

use super::events::list_events;
use super::models::{
    AttachPsbtSignatureRequest, CreateDealRequest, Deal, ProposeSettlementRequest,
    SignAgreementRequest, TransitionDealRequest,
};
use super::service;

pub fn router() -> Router<AppState> {
    return Router::new()
        .route("/", post(create_deal))
        .route("/{id}", get(get_deal))
        .route("/{id}/sign", post(sign_agreement))
        .route("/{id}/transition", post(transition_deal))
        .route("/{id}/funding/prepare", post(prepare_funding))
        .route("/{id}/funding/verify", post(verify_funding))
        .route("/{id}/settlement/propose", post(propose_settlement))
        .route("/{id}/settlement/sign", post(attach_psbt_signature))
        .route("/{id}/settlement/finalize", post(finalize_settlement))
        .route("/{id}/events", get(get_events))
        .route("/{id}/receipt", get(get_receipt));
}

async fn create_deal(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    _idem: IdempotencyKey,
    Json(req): Json<CreateDealRequest>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::create_deal(&state, &user.pubkey, req).await?;
    return Ok(Json(ApiEnvelope::ok("deal created", deal)));
}

async fn get_deal(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::get_deal(&state.pool, &id).await?;
    return Ok(Json(ApiEnvelope::ok("deal", deal)));
}

async fn sign_agreement(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<SignAgreementRequest>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::sign_agreement(&state, &id, &user.pubkey, req.signature).await?;
    return Ok(Json(ApiEnvelope::ok("agreement signed", deal)));
}

async fn transition_deal(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<TransitionDealRequest>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::transition_deal(&state, &id, &user.pubkey, req.to).await?;
    return Ok(Json(ApiEnvelope::ok("deal transitioned", deal)));
}

async fn prepare_funding(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    _idem: IdempotencyKey,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::prepare_funding(&state, &id, &user.pubkey).await?;
    return Ok(Json(ApiEnvelope::ok("funding prepared", deal)));
}

async fn verify_funding(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    _idem: IdempotencyKey,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::verify_funding(&state, &id, &user.pubkey).await?;
    return Ok(Json(ApiEnvelope::ok("funding checked", deal)));
}

async fn propose_settlement(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<ProposeSettlementRequest>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::propose_settlement(
        &state,
        &id,
        &user.pubkey,
        &req.destination_address,
        req.fee_sats,
        &req.purpose,
    )
    .await?;
    return Ok(Json(ApiEnvelope::ok("settlement proposed", deal)));
}

async fn attach_psbt_signature(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<AttachPsbtSignatureRequest>,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::attach_psbt_signature(&state, &id, &user.pubkey, &req.signed_psbt).await?;
    return Ok(Json(ApiEnvelope::ok("psbt updated", deal)));
}

async fn finalize_settlement(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    _idem: IdempotencyKey,
) -> Result<Json<ApiEnvelope<Deal>>, ApiError> {
    let deal = service::finalize_settlement(&state, &id, &user.pubkey).await?;
    return Ok(Json(ApiEnvelope::ok("settlement broadcast", deal)));
}

async fn get_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<Vec<opendeal_core::DealEvent>>>, ApiError> {
    let events = list_events(&state.pool, &id).await?;
    return Ok(Json(ApiEnvelope::ok("events", events)));
}

async fn get_receipt(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<opendeal_core::DealReceipt>>, ApiError> {
    let receipt = service::export_receipt(&state, &id).await?;
    return Ok(Json(ApiEnvelope::ok("receipt", receipt)));
}
