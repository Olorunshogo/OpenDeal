#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::routing::get;
use opendeal_bitcoin::{BitcoinMultisigAdapter, HttpBitcoinRpc, MockBitcoinRpc};
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

mod auth;
pub mod config;
mod deals;
mod disputes;
mod error;
mod evidence;
mod idempotency;
mod openapi;
mod response;
mod settlement;
mod shutdown;
mod state;
mod telemetry;
mod webhooks;

pub use telemetry::init as init_telemetry;

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
        .map_err(|_| StartupError("database connection or migration failed; verify configuration and database privileges".into()))?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|_| StartupError("database connection or migration failed; verify configuration and database privileges".into()))?;
    return Ok(());
}

pub async fn build_state(config: Config) -> Result<AppState, StartupError> {
    config
        .validate()
        .map_err(|err| StartupError(err.to_string()))?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .map_err(|_| StartupError("database connection or migration failed; verify configuration and database privileges".into()))?;

    let settlement: Arc<dyn settlement::SettlementAdapter> = match config.settlement_model {
        SettlementModel::BitcoinMultisig2of3 => {
            let rpc: Arc<dyn opendeal_bitcoin::BitcoinRpc> = match &config.bitcoin_rpc_url {
                Some(url) => Arc::new(HttpBitcoinRpc::new(
                    url.clone(),
                    config
                        .bitcoin_rpc_user
                        .clone()
                        .ok_or_else(|| StartupError("BITCOIN_RPC_USER is required".into()))?,
                    config
                        .bitcoin_rpc_password
                        .clone()
                        .ok_or_else(|| StartupError("BITCOIN_RPC_PASSWORD is required".into()))?,
                )),
                None => {
                    tracing::warn!(
                        "BITCOIN_RPC_URL unset; using MockBitcoinRpc (not for production)"
                    );
                    Arc::new(MockBitcoinRpc::new())
                }
            };
            let adapter = BitcoinMultisigAdapter::new(rpc, config.bitcoin_required_confirmations);
            Arc::new(settlement::MultisigSettlementAdapter::new(adapter))
        }
        SettlementModel::LightningProvider => {
            Arc::new(settlement::LightningSettlementAdapter::new())
        }
        SettlementModel::FiatProvider => Arc::new(settlement::FiatSettlementAdapter::new()),
        SettlementModel::Simulated => Arc::new(settlement::SimulatedSettlementAdapter),
    };

    return Ok(AppState::new(pool, config, settlement));
}

pub fn build_app(state: AppState) -> Router {
    let request_id_header = HeaderName::from_static("x-request-id");
    let cors = build_cors(&state.config.cors_allowed_origins);

    let api = Router::new()
        .nest("/auth", auth::router())
        .nest("/deals", deals::router())
        .merge(evidence::router())
        .merge(disputes::router())
        .merge(webhooks::router());

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

#[cfg(test)]
mod tests;
