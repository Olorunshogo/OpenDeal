use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use opendeal_core::{EventKind, EventPayload};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use uuid::Uuid;

use crate::auth::extractor::AuthenticatedUser;
use crate::deals::events::append_event_conn;
use crate::deals::service;
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
    pub object_key: Option<String>,
    pub content_sha256: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubmitEvidenceRequest {
    pub kind: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub content_base64: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
}

pub fn router() -> Router<AppState> {
    return Router::new()
        .route("/deals/{id}/evidence", post(submit).get(list))
        .route("/deals/{id}/evidence/{evidence_id}/content", get(download));
}

async fn submit(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
    Json(req): Json<SubmitEvidenceRequest>,
) -> Result<Json<ApiEnvelope<Evidence>>, ApiError> {
    let (mut tx, deal) = service::locked(&state, &id, &user.pubkey).await?;
    if !service::is_seller(&deal, &user.pubkey) && !service::is_buyer(&deal, &user.pubkey) {
        return Err(ApiError::forbidden(
            "only buyer or seller may submit evidence",
        ));
    }

    if req.kind.trim().is_empty() || req.kind.len() > 64 {
        return Err(ApiError::bad_request("invalid evidence kind"));
    }
    let evidence_id = Uuid::new_v4();
    let mut content = req.content.unwrap_or_default();
    let mut object_key: Option<String> = None;
    let content_sha256: Option<String>;
    let mut content_type = req.content_type.unwrap_or_else(|| "text/plain".into());

    if let Some(b64) = req.content_base64.filter(|v| !v.is_empty()) {
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
            .map_err(|_| ApiError::bad_request("content_base64 is not valid base64"))?;
        let (key, digest) = state
            .storage
            .put_bytes(&id, evidence_id, &bytes, &content_type)
            .await?;
        object_key = Some(key.clone());
        content_sha256 = Some(digest);
        if content.is_empty() {
            content = format!("object:{}", key);
        }
    } else if content.is_empty() {
        return Err(ApiError::bad_request(
            "content or content_base64 is required",
        ));
    } else {
        content_type = "text/plain".into();
        content_sha256 = Some(hex::encode(sha2::Sha256::digest(content.as_bytes())));
    }

    let row = sqlx::query_as::<_, Evidence>(
        r#"
        INSERT INTO deal_evidence (
            id, agreement_id, kind, content, submitted_by, object_key, content_sha256, content_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, agreement_id, kind, content, submitted_by, created_at,
                  object_key, content_sha256, content_type
        "#,
    )
    .bind(evidence_id)
    .bind(&id)
    .bind(&req.kind)
    .bind(&content)
    .bind(&user.pubkey)
    .bind(&object_key)
    .bind(&content_sha256)
    .bind(&content_type)
    .fetch_one(&mut *tx)
    .await?;

    append_event_conn(
        &mut tx,
        &id,
        EventKind::EvidenceSubmitted,
        EventPayload::EvidenceSubmitted {
            evidence_id: evidence_id.to_string(),
            kind: req.kind,
            content_sha256,
        },
        &user.pubkey,
        None,
    )
    .await?;

    tx.commit().await?;
    return Ok(Json(ApiEnvelope::ok("evidence recorded", row)));
}

async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(id): Path<String>,
) -> Result<Json<ApiEnvelope<Vec<Evidence>>>, ApiError> {
    service::assert_party(&service::get_deal(&state.pool, &id).await?, &user.pubkey)?;
    let rows = sqlx::query_as::<_, Evidence>(
        r#"
        SELECT id, agreement_id, kind, content, submitted_by, created_at,
               object_key, content_sha256, content_type
        FROM deal_evidence WHERE agreement_id = $1 ORDER BY created_at ASC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    return Ok(Json(ApiEnvelope::ok("evidence", rows)));
}

async fn download(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path((id, evidence_id)): Path<(String, Uuid)>,
) -> Result<Response, ApiError> {
    service::assert_party(&service::get_deal(&state.pool, &id).await?, &user.pubkey)?;

    let row: Option<(Option<String>, Option<String>, String)> = sqlx::query_as(
        r#"
        SELECT object_key, content_type, content
        FROM deal_evidence
        WHERE id = $1 AND agreement_id = $2
        "#,
    )
    .bind(evidence_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let Some((object_key, content_type, content)) = row else {
        return Err(ApiError::not_found("evidence not found"));
    };

    let (bytes, ctype) = if let Some(key) = object_key {
        let data = state.storage.get_bytes(&key).await?;
        (
            data,
            content_type.unwrap_or_else(|| "application/octet-stream".into()),
        )
    } else {
        (content.into_bytes(), "text/plain".into())
    };

    let content_type_header = HeaderValue::from_str(&ctype)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type_header);
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment"),
    );
    return Ok(response);
}
