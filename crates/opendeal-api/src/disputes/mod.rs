use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use opendeal_core::{DealStatus, EventKind, EventPayload};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::extractor::AuthenticatedUser;
use crate::deals;
use crate::deals::events::append_event;
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;

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
pub struct OpenDisputeRequest {
    pub reason: String,
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

#[derive(Debug, Deserialize)]
pub struct ResolveDisputeRequest {
    /// `release` (pay seller / settle) or `refund` (refund buyer).
    pub decision: String,
    pub rationale: String,
}

pub fn router() -> Router<AppState> {
    return Router::new()
        .route("/deals/{id}/disputes", post(open_dispute))
        .route("/disputes", get(list_disputes))
        .route("/disputes/{id}", get(get_dispute))
        .route("/disputes/{id}/resolve", post(resolve_dispute));
}

async fn open_dispute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<OpenDisputeRequest>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    let deal = deals::get_deal(&state.pool, &id).await?;
    if user.pubkey != deal.seller_pubkey && user.pubkey != deal.buyer_pubkey {
        return Err(ApiError::forbidden(
            "only buyer or seller may open a dispute",
        ));
    }

    deals::transition_deal(&state, &id, &user.pubkey, DealStatus::Disputed).await?;

    let dispute_id = Uuid::new_v4();
    let row = sqlx::query_as::<_, Dispute>(
        r#"
        INSERT INTO disputes (id, agreement_id, opened_by, reason, status)
        VALUES ($1, $2, $3, $4, 'open')
        RETURNING id, agreement_id, opened_by, reason, status, decision, rationale, resolved_by, created_at, resolved_at
        "#,
    )
    .bind(dispute_id)
    .bind(&id)
    .bind(&user.pubkey)
    .bind(&req.reason)
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
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

    return Ok(Json(ApiEnvelope::ok("dispute opened", row)));
}

/* Any configured mediator can list and act on any dispute — the allowlist is global, not per-deal (see resolve_dispute). Default to "open" since a resolved dispute has nothing left for a mediator to do. */
async fn list_disputes(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Query(query): Query<ListDisputesQuery>,
) -> Result<Json<ApiEnvelope<Vec<OpenDisputeSummary>>>, ApiError> {
    if !state.mediator_pubkeys.contains(&user.pubkey) {
        return Err(ApiError::forbidden(
            "only configured mediators may list disputes",
        ));
    }
    let status = query.status.unwrap_or_else(|| "open".to_string());

    let rows = sqlx::query_as::<_, OpenDisputeSummary>(
        r#"
        SELECT d.id, d.agreement_id, deals.title, deals.amount_sats,
               d.opened_by, d.reason, d.status, d.created_at
        FROM disputes d
        JOIN deals ON deals.id = d.agreement_id
        WHERE d.status = $1
        ORDER BY d.created_at DESC
        "#,
    )
    .bind(&status)
    .fetch_all(&state.pool)
    .await?;

    return Ok(Json(ApiEnvelope::ok("disputes", rows)));
}

async fn get_dispute(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    let row = sqlx::query_as::<_, Dispute>(
        r#"
        SELECT id, agreement_id, opened_by, reason, status, decision, rationale, resolved_by, created_at, resolved_at
        FROM disputes WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("dispute not found"))?;
    return Ok(Json(ApiEnvelope::ok("dispute", row)));
}

async fn resolve_dispute(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(req): Json<ResolveDisputeRequest>,
) -> Result<Json<ApiEnvelope<Dispute>>, ApiError> {
    if !state.mediator_pubkeys.contains(&user.pubkey) {
        return Err(ApiError::forbidden(
            "only configured mediators may resolve disputes",
        ));
    }
    if req.decision != "release" && req.decision != "refund" {
        return Err(ApiError::bad_request("decision must be release or refund"));
    }

    let existing = sqlx::query_as::<_, Dispute>(
        r#"
        SELECT id, agreement_id, opened_by, reason, status, decision, rationale, resolved_by, created_at, resolved_at
        FROM disputes WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("dispute not found"))?;

    let next = if req.decision == "refund" {
        DealStatus::Refunded
    } else {
        DealStatus::Settled
    };
    // Mediator decision updates protocol state; Bitcoin still requires 2-of-3 PSBT for multisig.
    deals::transition_deal(&state, &existing.agreement_id, &user.pubkey, next).await?;

    let row = sqlx::query_as::<_, Dispute>(
        r#"
        UPDATE disputes
        SET status = 'resolved', decision = $2, rationale = $3, resolved_by = $4, resolved_at = now()
        WHERE id = $1
        RETURNING id, agreement_id, opened_by, reason, status, decision, rationale, resolved_by, created_at, resolved_at
        "#,
    )
    .bind(id)
    .bind(&req.decision)
    .bind(&req.rationale)
    .bind(&user.pubkey)
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
        &existing.agreement_id,
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

    return Ok(Json(ApiEnvelope::ok("dispute resolved", row)));
}
