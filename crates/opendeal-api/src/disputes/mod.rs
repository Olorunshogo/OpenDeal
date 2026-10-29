use crate::auth::extractor::AuthenticatedUser;
use crate::deals::events::append_event_conn;
use crate::deals::service;
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use opendeal_core::{DealStatus, EventKind, EventPayload};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Dispute {
    pub id: Uuid,
    pub agreement_id: String,
    pub opened_by: String,
    pub reason: String,
    pub status: String,
    pub decision: Option<String>,
    pub rationale: Option<String>,
    pub resolved_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenDisputeRequest {
    pub reason: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolveDisputeRequest {
    pub decision: String,
    pub rationale: String,
}

/* Dispute plus the deal context a mediator desk actually needs to decide — title and amount, not just an id. */
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OpenDisputeSummary {
    pub id: Uuid,
    pub agreement_id: String,
    pub title: String,
    pub amount_sats: i64,
    pub opened_by: String,
    pub reason: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListDisputesQuery {
    pub status: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/disputes", get(list_disputes))
        .route("/deals/{id}/disputes", post(open_dispute))
        .route("/disputes/{id}", get(get_dispute))
        .route("/disputes/{id}/resolve", post(resolve_dispute))
}
async fn open_dispute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<OpenDisputeRequest>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    let (mut tx, deal) = service::locked(&state, &id, &user.pubkey).await?;
    if !service::is_buyer(&deal, &user.pubkey) && !service::is_seller(&deal, &user.pubkey) {
        return Err(ApiError::forbidden(
            "only buyer or seller may open disputes",
        ));
    }
    if req.reason.trim().is_empty() || req.reason.len() > 10_000 {
        return Err(ApiError::bad_request("reason must contain 1..10000 bytes"));
    }
    if deal.settlement_txid.is_some() || deal.current_psbt.is_some() {
        return Err(ApiError::conflict_with_code(
            "settlement in progress",
            "settlement_locked",
        ));
    }
    service::set_status(&mut tx, &deal, DealStatus::Disputed, &user.pubkey).await?;
    let dispute_id = Uuid::new_v4();
    let row: Dispute = sqlx::query_as("INSERT INTO disputes (id,agreement_id,opened_by,reason,status) VALUES ($1,$2,$3,$4,'open') RETURNING *")
        .bind(dispute_id).bind(&id).bind(&user.pubkey).bind(&req.reason).fetch_one(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        &id,
        EventKind::DisputeOpened,
        EventPayload::DisputeOpened {
            dispute_id: dispute_id.to_string(),
            reason: req.reason,
        },
        &user.pubkey,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(ApiEnvelope::ok("dispute opened", row)))
}
async fn get_dispute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    let row: Dispute = sqlx::query_as("SELECT * FROM disputes WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("dispute not found"))?;
    service::assert_party(
        &service::get_deal(&state.pool, &row.agreement_id).await?,
        &user.pubkey,
    )?;
    Ok(Json(ApiEnvelope::ok("dispute", row)))
}
async fn resolve_dispute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<ResolveDisputeRequest>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    let existing: Dispute = sqlx::query_as("SELECT * FROM disputes WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("dispute not found"))?;
    let (mut tx, deal) = service::locked(&state, &existing.agreement_id, &user.pubkey).await?;
    if !service::is_mediator(&deal, &user.pubkey)
        || !crate::mediators::approved(&state, &user.pubkey).await?
    {
        return Err(ApiError::forbidden(
            "only this deal's authorized mediator may resolve",
        ));
    }
    if !["release", "refund"].contains(&req.decision.as_str())
        || req.rationale.trim().is_empty()
        || req.rationale.len() > 10_000
    {
        return Err(ApiError::bad_request(
            "decision must be release or refund and rationale is required",
        ));
    }
    let current: Dispute = sqlx::query_as("SELECT * FROM disputes WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if current.status == "resolved" {
        if current.decision.as_deref() == Some(&req.decision)
            && current.rationale.as_deref() == Some(&req.rationale)
        {
            return Ok(Json(ApiEnvelope::ok("dispute resolved", current)));
        }
        return Err(ApiError::conflict_with_code(
            "resolution is immutable",
            "dispute_resolved",
        ));
    }
    if deal.status != "disputed" || deal.settlement_txid.is_some() {
        return Err(ApiError::conflict_with_code(
            "deal is not awaiting resolution",
            "illegal_transition",
        ));
    }
    let row: Dispute = sqlx::query_as("UPDATE disputes SET status='resolved',decision=$2,rationale=$3,resolved_by=$4,resolved_at=now() WHERE id=$1 RETURNING *")
        .bind(id).bind(&req.decision).bind(&req.rationale).bind(&user.pubkey).fetch_one(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        &deal.id,
        EventKind::DisputeResolved,
        EventPayload::DisputeResolved {
            dispute_id: id.to_string(),
            decision: req.decision,
            rationale: req.rationale,
        },
        &user.pubkey,
        None,
    )
    .await?;
    // A decision authorizes an outcome; it does not spend or confirm Bitcoin.
    tx.commit().await?;
    Ok(Json(ApiEnvelope::ok("dispute resolved", row)))
}

async fn list_disputes(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Query(query): Query<ListDisputesQuery>,
) -> Result<Json<ApiEnvelope<Vec<OpenDisputeSummary>>>, ApiError> {
    if !crate::mediators::approved(&state, &user.pubkey).await? {
        return Err(ApiError::forbidden(
            "only approved mediators may list disputes",
        ));
    }
    let status = query.status.unwrap_or_else(|| "open".to_string());

    let rows = sqlx::query_as::<_, OpenDisputeSummary>(
        r#"
        SELECT d.id, d.agreement_id, deals.title, deals.amount_sats,
               d.opened_by, d.reason, d.status, d.created_at
        FROM disputes d
        JOIN deals ON deals.id = d.agreement_id
        WHERE d.status = $1 AND RIGHT(LOWER(deals.mediator_pubkey), 64) = $2
        ORDER BY d.created_at DESC
        "#,
    )
    .bind(&status)
    .bind(&user.pubkey)
    .fetch_all(&state.pool)
    .await?;

    return Ok(Json(ApiEnvelope::ok("disputes", rows)));
}
