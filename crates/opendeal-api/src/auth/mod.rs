mod dev;
pub mod extractor;
pub mod jwt;
pub mod models;
mod nostr;

use axum::Router;

use crate::state::AppState;

pub use nostr::NonceStore;

pub fn router() -> Router<AppState> {
    return Router::new()
        .nest("/nostr", nostr::router())
        .nest("/dev", dev::router());
}
