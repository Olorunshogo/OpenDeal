use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "OpenDeal API",
        version = "0.1.0",
        description = "Bitcoin-native commerce coordination protocol. The API never holds private keys."
    ),
    paths(
        health_live,
        health_ready,
    ),
    tags(
        (name = "health", description = "Liveness and readiness"),
        (name = "deals", description = "Deal lifecycle"),
        (name = "auth", description = "Nostr authentication"),
    )
)]
pub struct ApiDoc;

#[allow(dead_code)]
#[utoipa::path(get, path = "/health", tag = "health", responses((status = 200, description = "ok")))]
pub fn health_live() {}

#[allow(dead_code)]
#[utoipa::path(get, path = "/health/ready", tag = "health", responses((status = 200, description = "ready")))]
pub fn health_ready() {}
