use std::collections::HashSet;
use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::NonceStore;
use crate::auth::jwt::JwtKeys;
use crate::config::Config;
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
        return AppState {
            pool,
            jwt,
            mediator_pubkeys,
            nonces: Arc::new(NonceStore::default()),
            settlement,
            storage,
            config: Arc::new(config),
        };
    }
}
