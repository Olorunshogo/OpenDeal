use crate::auth::extractor::AuthenticatedUser;
use crate::deals::{events::append_event_conn, service};
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use opendeal_core::{EventKind, EventPayload};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Evidence {
    pub id: Uuid,
    pub agreement_id: String,
    pub kind: String,
    pub content: String,
    pub submitted_by: String,
    pub created_at: DateTime<Utc>,
    pub content_sha256: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmitEvidenceRequest {
    pub kind: String,
    pub content: String,
}
pub fn router() -> Router<AppState> {
    Router::new().route("/deals/{id}/evidence", post(submit).get(list))
}
async fn submit(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<SubmitEvidenceRequest>,
) -> Result<Json<ApiEnvelope<Evidence>>, ApiError> {
    let (mut tx, deal) = service::locked(&state, &id, &user.pubkey).await?;
    if !service::is_buyer(&deal, &user.pubkey) && !service::is_seller(&deal, &user.pubkey) {
        return Err(ApiError::forbidden(
            "only buyer or seller may submit evidence",
        ));
    }
    if req.kind.trim().is_empty()
        || req.kind.len() > 64
        || req.content.trim().is_empty()
        || req.content.len() > 100_000
    {
        return Err(ApiError::bad_request(
            "invalid evidence kind or content size",
        ));
    }
    let evidence_id = Uuid::new_v4();
    let hash = hex::encode(Sha256::digest(req.content.as_bytes()));
    let row: Evidence = sqlx::query_as("INSERT INTO deal_evidence (id,agreement_id,kind,content,submitted_by,content_sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *")
        .bind(evidence_id).bind(&id).bind(&req.kind).bind(&req.content).bind(&user.pubkey).bind(&hash).fetch_one(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        &id,
        EventKind::EvidenceSubmitted,
        EventPayload::EvidenceSubmitted {
            evidence_id: evidence_id.to_string(),
            kind: req.kind,
            content_sha256: Some(hash),
        },
        &user.pubkey,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(ApiEnvelope::ok("evidence recorded", row)))
}
async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<Vec<Evidence>>>, ApiError> {
    service::assert_party(&service::get_deal(&state.pool, &id).await?, &user.pubkey)?;
    let rows =
        sqlx::query_as("SELECT * FROM deal_evidence WHERE agreement_id=$1 ORDER BY created_at,id")
            .bind(&id)
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(ApiEnvelope::ok("evidence", rows)))
}
