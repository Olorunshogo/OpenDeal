#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use std::net::SocketAddr;
use std::process::ExitCode;

use opendeal_api::{
    Config, build_app, build_state, init_telemetry, run_migrations, shutdown_signal,
    spawn_retry_worker,
};

#[tokio::main]
async fn main() -> ExitCode {
    let _ = dotenvy::from_filename("crates/opendeal-api/.env");
    let _ = dotenvy::dotenv();
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("{}", err);
            return ExitCode::FAILURE;
        }
    };

    init_telemetry(
        config.is_production(),
        config.otel_endpoint.as_deref(),
        config.sentry_dsn.as_deref(),
    );

    if config.run_migrations
        && let Some(admin_url) = &config.database_admin_url
        && let Err(err) = run_migrations(admin_url).await
    {
        tracing::error!(%err, "refusing to start");
        return ExitCode::FAILURE;
    }

    let port = config.port;
    let state = match build_state(config).await {
        Ok(state) => state,
        Err(err) => {
            tracing::error!(%err, "refusing to start");
            return ExitCode::FAILURE;
        }
    };

    spawn_retry_worker(state.clone());

    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(%err, port, "failed to bind port");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!(port, "opendeal-api listening");

    let service = build_app(state).into_make_service_with_connect_info::<SocketAddr>();
    if let Err(err) = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(%err, "server error");
        return ExitCode::FAILURE;
    }

    tracing::info!("shut down cleanly");
    return ExitCode::SUCCESS;
}
