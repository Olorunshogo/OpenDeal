pub(crate) mod events;
mod handlers;
pub mod models;
pub(crate) mod service;

use axum::Router;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    return handlers::router();
}
