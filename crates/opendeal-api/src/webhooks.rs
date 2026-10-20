use std::time::Duration;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{TimeDelta, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::auth::extractor::AuthenticatedUser;
use crate::deals::models::Deal;
use crate::error::ApiError;
use crate::response::ApiEnvelope;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, serde::Deserialize)]
pub struct RegisterWebhookRequest {
    pub url: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct WebhookEndpoint {
    pub id: Uuid,
    pub owner_pubkey: String,
    pub url: String,
    pub secret: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct DeliveryRow {
    id: Uuid,
    event_type: String,
    payload: serde_json::Value,
    attempts: i32,
    url: String,
    secret: String,
}

pub fn router() -> Router<AppState> {
    return Router::new().route("/webhooks", post(register_webhook));
}

async fn register_webhook(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(req): Json<RegisterWebhookRequest>,
) -> Result<Json<ApiEnvelope<WebhookEndpoint>>, ApiError> {
    let endpoint = register_endpoint(&state, &user.pubkey, req.url).await?;
    return Ok(Json(ApiEnvelope::ok("webhook registered", endpoint)));
}

pub async fn register_endpoint(
    state: &AppState,
    owner_pubkey: &str,
    url: String,
) -> Result<WebhookEndpoint, ApiError> {
    let id = Uuid::new_v4();
    let secret = format!("whsec_{}", Uuid::new_v4());
    let row = sqlx::query_as::<_, WebhookEndpoint>(
        r#"
        INSERT INTO webhook_endpoints (id, owner_pubkey, url, secret)
        VALUES ($1, $2, $3, $4)
        RETURNING id, owner_pubkey, url, secret, created_at
        "#,
    )
    .bind(id)
    .bind(owner_pubkey)
    .bind(&url)
    .bind(&secret)
    .fetch_one(&state.pool)
    .await?;
    return Ok(row);
}

pub async fn enqueue_deal_event(
    state: &AppState,
    event_type: &str,
    deal: &Deal,
) -> Result<(), ApiError> {
    let endpoints: Vec<WebhookEndpoint> = sqlx::query_as(
        r#"
        SELECT id, owner_pubkey, url, secret, created_at FROM webhook_endpoints
        WHERE owner_pubkey IN ($1, $2, $3)
        "#,
    )
    .bind(&deal.seller_pubkey)
    .bind(&deal.buyer_pubkey)
    .bind(&deal.mediator_pubkey)
    .fetch_all(&state.pool)
    .await?;

    let payload = serde_json::json!({
        "type": event_type,
        "deal": deal,
    });

    for endpoint in endpoints {
        let delivery_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, attempts, next_attempt_at)
            VALUES ($1, $2, $3, $4, 'pending', 0, now())
            "#,
        )
        .bind(delivery_id)
        .bind(endpoint.id)
        .bind(event_type)
        .bind(&payload)
        .execute(&state.pool)
        .await?;

        deliver_once(
            &state.pool,
            delivery_id,
            &endpoint.url,
            &endpoint.secret,
            event_type,
            &payload,
            0,
            state.config.webhook_max_attempts,
        )
        .await?;
    }
    return Ok(());
}

pub fn spawn_retry_worker(state: AppState) {
    tokio::spawn(async move {
        let interval = Duration::from_secs(state.config.webhook_retry_interval_secs.max(5));
        loop {
            if let Err(err) = process_retries(&state).await {
                tracing::warn!(error = ?err, "webhook retry tick failed");
            }
            tokio::time::sleep(interval).await;
        }
    });
}

async fn process_retries(state: &AppState) -> Result<(), ApiError> {
    let max_attempts = state.config.webhook_max_attempts as i32;
    let rows: Vec<DeliveryRow> = sqlx::query_as(
        r#"
        SELECT d.id, d.event_type, d.payload, d.attempts, e.url, e.secret
        FROM webhook_deliveries d
        JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.status IN ('pending', 'failed')
          AND d.attempts < $1
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
        ORDER BY d.created_at ASC
        LIMIT 25
        "#,
    )
    .bind(max_attempts)
    .fetch_all(&state.pool)
    .await?;

    for row in rows {
        deliver_once(
            &state.pool,
            row.id,
            &row.url,
            &row.secret,
            &row.event_type,
            &row.payload,
            row.attempts,
            state.config.webhook_max_attempts,
        )
        .await?;
    }
    return Ok(());
}

#[allow(clippy::too_many_arguments)]
async fn deliver_once(
    pool: &sqlx::PgPool,
    delivery_id: Uuid,
    url: &str,
    secret: &str,
    event_type: &str,
    payload: &serde_json::Value,
    prior_attempts: i32,
    max_attempts: u32,
) -> Result<(), ApiError> {
    let attempts = prior_attempts + 1;
    let body = payload.to_string();
    let signature = sign_payload(secret, &body);
    let client = reqwest::Client::new();
    let result = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-OpenDeal-Signature", signature)
        .header("X-OpenDeal-Event", event_type)
        .body(body)
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => {
            sqlx::query(
                r#"
                UPDATE webhook_deliveries
                SET status = 'delivered', attempts = $2, delivered_at = now(), last_error = NULL, next_attempt_at = NULL
                WHERE id = $1
                "#,
            )
            .bind(delivery_id)
            .bind(attempts)
            .execute(pool)
            .await?;
        }
        Ok(resp) => {
            let err = format!("http {}", resp.status());
            mark_failure(pool, delivery_id, attempts, max_attempts, &err).await?;
        }
        Err(err) => {
            mark_failure(pool, delivery_id, attempts, max_attempts, &err.to_string()).await?;
        }
    }
    return Ok(());
}

async fn mark_failure(
    pool: &sqlx::PgPool,
    delivery_id: Uuid,
    attempts: i32,
    max_attempts: u32,
    error: &str,
) -> Result<(), ApiError> {
    if attempts as u32 >= max_attempts {
        sqlx::query(
            r#"
            UPDATE webhook_deliveries
            SET status = 'dead', attempts = $2, last_error = $3, next_attempt_at = NULL
            WHERE id = $1
            "#,
        )
        .bind(delivery_id)
        .bind(attempts)
        .bind(error)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let backoff_secs = 2i64.pow(attempts.clamp(1, 8) as u32);
    let next = Utc::now() + TimeDelta::seconds(backoff_secs);
    sqlx::query(
        r#"
        UPDATE webhook_deliveries
        SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = $4
        WHERE id = $1
        "#,
    )
    .bind(delivery_id)
    .bind(attempts)
    .bind(error)
    .bind(next)
    .execute(pool)
    .await?;
    return Ok(());
}

pub fn sign_payload(secret: &str, body: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC key length is valid");
    mac.update(body.as_bytes());
    return hex::encode(mac.finalize().into_bytes());
}
