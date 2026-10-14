//! Observability bootstrap.
//!
//! Structured tracing is always on. OpenTelemetry export can be wired here later via
//! `tracing-opentelemetry` without changing call sites. Handlers already emit spans through
//! `tower_http::trace` and `tracing` macros.

use tracing_subscriber::EnvFilter;

pub fn init(json_logs: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("opendeal_api=info,tower_http=info,sqlx=warn"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if json_logs {
        builder.json().init();
    } else {
        builder.init();
    }
}
