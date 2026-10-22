use std::collections::HashSet;
use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::NonceStore;
use crate::auth::jwt::JwtKeys;
use crate::config::Config;
use crate::settlement::SettlementAdapter;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub rpc: Arc<dyn opendeal_bitcoin::rpc::BitcoinChain>,
    pub config: Arc<Config>,
    pub settlement: Arc<dyn SettlementAdapter>,
    pub jwt: JwtKeys,
    pub nonces: Arc<NonceStore>,
    pub mediator_pubkeys: Arc<HashSet<String>>,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config, settlement: Arc<dyn SettlementAdapter>) -> Self {
        let jwt = JwtKeys::new(&config.jwt_secret, config.access_token_ttl);
        let mediator_pubkeys = Arc::new(
            config
                .mediator_pubkeys
                .iter()
                .filter_map(|key| opendeal_core::verification::normalize_identity(key).ok())
                .collect(),
        );
        let rpc: Arc<dyn opendeal_bitcoin::rpc::BitcoinChain> = match &config.bitcoin_rpc_url {
            Some(url) => Arc::new(opendeal_bitcoin::HttpBitcoinRpc::new(
                url,
                config.bitcoin_rpc_user.as_deref().unwrap_or_default(),
                config.bitcoin_rpc_password.as_deref().unwrap_or_default(),
            )),
            None => Arc::new(opendeal_bitcoin::MockBitcoinRpc::new()),
        };
        return AppState {
            rpc,
            pool,
            jwt,
            mediator_pubkeys,
            nonces: Arc::new(NonceStore::default()),
            settlement,
            config: Arc::new(config),
        };
    }
}
