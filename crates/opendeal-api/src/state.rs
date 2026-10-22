use std::collections::HashSet;
use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::NonceStore;
use crate::auth::jwt::JwtKeys;
use crate::config::Config;
use crate::ratelimit::RateLimiter;
use crate::settlement::SettlementAdapter;
use crate::storage::ObjectStorage;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub settlement: Arc<dyn SettlementAdapter>,
    pub jwt: JwtKeys,
    pub nonces: Arc<NonceStore>,
    pub mediator_pubkeys: Arc<HashSet<String>>,
    pub storage: ObjectStorage,
    pub rate_limiter: Arc<RateLimiter>,
}

impl AppState {
    pub fn new(
        pool: PgPool,
        config: Config,
        settlement: Arc<dyn SettlementAdapter>,
        storage: ObjectStorage,
    ) -> Self {
        let jwt = JwtKeys::new(&config.jwt_secret, config.access_token_ttl);
        let mediator_pubkeys = Arc::new(config.mediator_pubkeys.iter().cloned().collect());
        let rate_limiter = Arc::new(RateLimiter::new(config.rate_limit_per_minute));
        return AppState {
            pool,
            jwt,
            mediator_pubkeys,
            nonces: Arc::new(NonceStore::default()),
            settlement,
            storage,
            rate_limiter,
            config: Arc::new(config),
        };
    }
}
