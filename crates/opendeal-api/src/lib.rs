#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use serde::Serialize;
use opendeal_bitcoin::{
    BitcoinMultisigAdapter, HttpBitcoinRpc, MockBitcoinRpc, RedundantBitcoinRpc,
};
use opendeal_core::SettlementModel;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::error::ApiError;

mod auth;
pub mod config;
mod deals;
mod disputes;
mod error;
mod evidence;
mod idempotency;
mod mail;
mod openapi;
mod ratelimit;
mod response;
mod settlement;
mod shutdown;
mod state;
mod storage;
mod telemetry;
mod webhooks;

pub use telemetry::init as init_telemetry;
pub use webhooks::spawn_retry_worker;

pub use config::Config;
pub use shutdown::shutdown_signal;
pub use state::AppState;

pub fn app() -> Router {
    return Router::new().route("/health", get(report_liveness));
}

async fn report_liveness() -> &'static str {
    return "ok";
}

async fn report_readiness(State(state): State<AppState>) -> (StatusCode, &'static str) {
    return match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(err) => {
            tracing::error!(error = %err, "readiness check failed");
            (StatusCode::SERVICE_UNAVAILABLE, "database unavailable")
        }
    };
}

#[derive(Debug, Serialize)]
struct PublicMeta {
    network: String,
    settlement_model: String,
    custody: String,
    pilot_max_amount_sats: Option<u64>,
    required_confirmations: u32,
    rate_limit_per_minute: u32,
}

async fn public_meta(State(state): State<AppState>) -> Json<response::ApiEnvelope<PublicMeta>> {
    return Json(response::ApiEnvelope::ok(
        "meta",
        PublicMeta {
            network: state.config.bitcoin_network.clone(),
            settlement_model: state.config.settlement_model.as_str().to_string(),
            custody: custody_label(state.config.settlement_model).to_string(),
            pilot_max_amount_sats: state.config.pilot_max_amount_sats,
            required_confirmations: state.config.bitcoin_required_confirmations,
            rate_limit_per_minute: state.config.rate_limit_per_minute,
        },
    ));
}

fn custody_label(model: SettlementModel) -> &'static str {
    return match model {
        SettlementModel::BitcoinMultisig2of3 => "multisig_2of3_no_server_keys",
        SettlementModel::LightningProvider => "provider_custody",
        SettlementModel::FiatProvider => "provider_custody",
        SettlementModel::Simulated => "simulated",
    };
}

async fn rate_limit(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, ApiError> {
    let key = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("local")
        .split(',')
        .next()
        .unwrap_or("local")
        .trim()
        .to_string();
    if !state.rate_limiter.allow(&key) {
        return Err(ApiError::too_many_requests(
            "rate limit exceeded; retry shortly",
        ));
    }
    return Ok(next.run(request).await);
}

#[derive(Debug)]
pub struct StartupError(pub String);

impl std::fmt::Display for StartupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "startup failed: {}", self.0);
    }
}

impl std::error::Error for StartupError {}

pub async fn run_migrations(admin_url: &str) -> Result<(), StartupError> {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(admin_url)
        .await
        .map_err(|e| StartupError(e.to_string()))?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| StartupError(e.to_string()))?;
    return Ok(());
}

pub async fn build_state(config: Config) -> Result<AppState, StartupError> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .map_err(|e| StartupError(e.to_string()))?;

    let settlement: Arc<dyn settlement::SettlementAdapter> = match config.settlement_model {
        SettlementModel::BitcoinMultisig2of3 => {
            let primary: Arc<dyn opendeal_bitcoin::BitcoinRpc> = match &config.bitcoin_rpc_url {
                Some(url) => Arc::new(HttpBitcoinRpc::new(url.clone())),
                None => {
                    tracing::warn!(
                        "BITCOIN_RPC_URL unset; using MockBitcoinRpc (not for production)"
                    );
                    Arc::new(MockBitcoinRpc::new())
                }
            };
            let rpc: Arc<dyn opendeal_bitcoin::BitcoinRpc> =
                if let Some(fallback) = &config.bitcoin_rpc_fallback_url {
                    Arc::new(RedundantBitcoinRpc::new(
                        primary,
                        Arc::new(HttpBitcoinRpc::new(fallback.clone())),
                    ))
                } else {
                    primary
                };
            let adapter = BitcoinMultisigAdapter::new(rpc, config.bitcoin_required_confirmations);
            Arc::new(settlement::MultisigSettlementAdapter::new(adapter))
        }
        SettlementModel::LightningProvider => {
            match (&config.lightning_api_url, &config.lightning_api_key) {
                (Some(url), Some(key)) => Arc::new(settlement::LightningSettlementAdapter::with_http(
                    settlement::HttpInvoiceClient::new(url, key, "lightning_provider"),
                )),
                _ => {
                    tracing::warn!("LIGHTNING_API_URL unset; using in-memory Lightning stub");
                    Arc::new(settlement::LightningSettlementAdapter::new())
                }
            }
        }
        SettlementModel::FiatProvider => {
            match (&config.fiat_api_url, &config.fiat_api_key) {
                (Some(url), Some(key)) => Arc::new(settlement::FiatSettlementAdapter::with_http(
                    settlement::HttpInvoiceClient::new(url, key, "fiat_provider"),
                )),
                _ => {
                    tracing::warn!("FIAT_API_URL unset; using in-memory fiat stub");
                    Arc::new(settlement::FiatSettlementAdapter::new())
                }
            }
        }
        SettlementModel::Simulated => Arc::new(settlement::SimulatedSettlementAdapter),
    };

    let storage = match storage::ObjectStorage::from_config(&config).await {
        Ok(storage) => storage,
        Err(err) => {
            return Err(StartupError(format!("{:?}", err)));
        }
    };
    return Ok(AppState::new(pool, config, settlement, storage));
}

pub fn build_app(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");
    let cors = build_cors(&state.config.cors_allowed_origins);

    let api = Router::new()
        .route("/meta", get(public_meta))
        .nest("/auth", auth::router())
        .nest("/deals", deals::router())
        .merge(evidence::router())
        .merge(disputes::router())
        .merge(webhooks::router())
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit));

    return Router::new()
        .route("/health", get(report_liveness))
        .route("/health/ready", get(report_readiness))
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", openapi::ApiDoc::openapi()))
        .nest("/api/v1", api)
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            state.config.request_timeout,
        ))
        .layer(DefaultBodyLimit::max(state.config.max_body_bytes))
        .layer(RequestBodyLimitLayer::new(state.config.max_body_bytes))
        .layer(SetRequestIdLayer::new(
            request_id_header.clone(),
            MakeRequestUuid,
        ))
        .layer(PropagateRequestIdLayer::new(request_id_header))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(cors)
        .with_state(state);
}

fn build_cors(origins: &[String]) -> CorsLayer {
    if origins.is_empty() {
        return CorsLayer::new()
            .allow_origin(AllowOrigin::predicate(|_, _| true))
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([
                header::AUTHORIZATION,
                header::CONTENT_TYPE,
                HeaderName::from_static("idempotency-key"),
            ]);
    }
    let parsed: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    return CorsLayer::new()
        .allow_origin(AllowOrigin::list(parsed))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("idempotency-key"),
        ]);
}
