use uuid::Uuid;

use crate::deals::models::Deal;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
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
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| ApiError::bad_request("invalid webhook URL"))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ApiError::bad_request(
            "webhook URL must be HTTPS without credentials or fragment",
        ));
    }
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

/// Transactional outbox only. Delivery requires a separate allowlisted worker;
/// user-controlled webhook URLs are never fetched in the API request path.
pub async fn enqueue_event_conn(
    connection: &mut sqlx::PgConnection,
    event_type: &str,
    deal: &Deal,
) -> Result<(), ApiError> {
    let payload = serde_json::json!({"type":event_type,"deal_id":deal.id,"status":deal.status});
    sqlx::query("INSERT INTO webhook_deliveries (id,endpoint_id,event_type,payload,status,attempts) SELECT gen_random_uuid(),id,$1,$2,'pending',0 FROM webhook_endpoints WHERE owner_pubkey IN ($3,$4,$5)")
        .bind(event_type).bind(payload).bind(&deal.seller_pubkey).bind(&deal.buyer_pubkey).bind(&deal.mediator_pubkey).execute(connection).await?;
    Ok(())
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
