use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::deals::models::Deal;
use crate::error::ApiError;
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
            INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, attempts)
            VALUES ($1, $2, $3, $4, 'pending', 0)
            "#,
        )
        .bind(delivery_id)
        .bind(endpoint.id)
        .bind(event_type)
        .bind(&payload)
        .execute(&state.pool)
        .await?;

        // Best-effort sync delivery for MVP; failures stay pending for retry jobs later.
        let body = payload.to_string();
        let signature = sign_payload(&endpoint.secret, &body);
        let client = reqwest::Client::new();
        match client
            .post(&endpoint.url)
            .header("Content-Type", "application/json")
            .header("X-OpenDeal-Signature", signature)
            .header("X-OpenDeal-Event", event_type)
            .body(body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                sqlx::query(
                    "UPDATE webhook_deliveries SET status = 'delivered', attempts = 1, delivered_at = now() WHERE id = $1",
                )
                .bind(delivery_id)
                .execute(&state.pool)
                .await?;
            }
            Ok(resp) => {
                let err = format!("http {}", resp.status());
                sqlx::query(
                    "UPDATE webhook_deliveries SET status = 'failed', attempts = 1, last_error = $2 WHERE id = $1",
                )
                .bind(delivery_id)
                .bind(&err)
                .execute(&state.pool)
                .await?;
            }
            Err(err) => {
                sqlx::query(
                    "UPDATE webhook_deliveries SET status = 'failed', attempts = 1, last_error = $2 WHERE id = $1",
                )
                .bind(delivery_id)
                .bind(err.to_string())
                .execute(&state.pool)
                .await?;
            }
        }
    }
    return Ok(());
}

pub fn sign_payload(secret: &str, body: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC key length is valid");
    mac.update(body.as_bytes());
    return hex::encode(mac.finalize().into_bytes());
}

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};

use crate::auth::extractor::AuthenticatedUser;
use crate::response::ApiEnvelope;

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
