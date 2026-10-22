pub(crate) mod events;
mod handlers;
pub mod models;
mod service;

use axum::Router;

use crate::state::AppState;

pub use service::{get_deal, transition_deal};

pub fn router() -> Router<AppState> {
    return handlers::router();
}
