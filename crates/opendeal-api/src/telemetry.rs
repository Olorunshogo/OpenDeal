use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub fn init(json_logs: bool, otel_endpoint: Option<&str>, sentry_dsn: Option<&str>) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("opendeal_api=info,tower_http=info,sqlx=warn"));

    if let Some(dsn) = sentry_dsn.filter(|v| !v.is_empty()) {
        let guard = sentry::init((
            dsn.to_string(),
            sentry::ClientOptions {
                release: sentry::release_name!(),
                traces_sample_rate: 0.2,
                send_default_pii: false,
                ..Default::default()
            },
        ));
        std::mem::forget(guard);
    }

    let otel_layer = otel_endpoint
        .filter(|v| !v.is_empty())
        .and_then(|endpoint| match build_otel_tracer(endpoint) {
            Ok(tracer) => Some(tracing_opentelemetry::layer().with_tracer(tracer)),
            Err(err) => {
                eprintln!("otel init failed: {}", err);
                None
            }
        });

    let registry = tracing_subscriber::registry().with(filter).with(otel_layer);

    if json_logs {
        registry
            .with(tracing_subscriber::fmt::layer().json())
            .with(sentry_tracing::layer())
            .init();
    } else {
        registry
            .with(tracing_subscriber::fmt::layer())
            .with(sentry_tracing::layer())
            .init();
    }
}

fn build_otel_tracer(endpoint: &str) -> Result<opentelemetry_sdk::trace::Tracer, String> {
    let exporter = SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()
        .map_err(|e| e.to_string())?;
    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            Resource::builder()
                .with_service_name("opendeal-api")
                .build(),
        )
        .build();
    let tracer = provider.tracer("opendeal-api");
    std::mem::forget(provider);
    return Ok(tracer);
}
