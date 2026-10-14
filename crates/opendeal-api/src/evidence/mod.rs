use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use opendeal_core::{EventKind, EventPayload};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::extractor::AuthenticatedUser;
use crate::deals;
use crate::deals::events::append_event;
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Evidence {
    pub id: Uuid,
    pub agreement_id: String,
    pub kind: String,
    pub content: String,
    pub submitted_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitEvidenceRequest {
    pub kind: String,
    pub content: String,
}

pub fn router() -> Router<AppState> {
    return Router::new().route("/deals/{id}/evidence", post(submit).get(list));
}

async fn submit(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<SubmitEvidenceRequest>,
) -> Result<Json<ApiEnvelope<Evidence>>, ApiError> {
    let deal = deals::get_deal(&state.pool, &id).await?;
    if user.pubkey != deal.seller_pubkey && user.pubkey != deal.buyer_pubkey {
        return Err(ApiError::forbidden(
            "only buyer or seller may submit evidence",
        ));
    }
    let evidence_id = Uuid::new_v4();
    let row = sqlx::query_as::<_, Evidence>(
        r#"
        INSERT INTO deal_evidence (id, agreement_id, kind, content, submitted_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, agreement_id, kind, content, submitted_by, created_at
        "#,
    )
    .bind(evidence_id)
    .bind(&id)
    .bind(&req.kind)
    .bind(&req.content)
    .bind(&user.pubkey)
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
        &id,
        EventKind::EvidenceSubmitted,
        EventPayload::EvidenceSubmitted {
            evidence_id: evidence_id.to_string(),
            kind: req.kind,
        },
        &user.pubkey,
        None,
    )
    .await?;

    return Ok(Json(ApiEnvelope::ok("evidence recorded", row)));
}

async fn list(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<Vec<Evidence>>>, ApiError> {
    let rows = sqlx::query_as::<_, Evidence>(
        r#"
        SELECT id, agreement_id, kind, content, submitted_by, created_at
        FROM deal_evidence WHERE agreement_id = $1 ORDER BY created_at ASC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    return Ok(Json(ApiEnvelope::ok("evidence", rows)));
}
