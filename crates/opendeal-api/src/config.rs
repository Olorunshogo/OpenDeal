use std::env;
use std::time::Duration;

use opendeal_core::SettlementModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Test,
    Production,
}

#[derive(Clone)]
pub struct Config {
    pub app_env: AppEnv,
    pub port: u16,
    pub database_url: String,
    pub database_admin_url: Option<String>,
    pub run_migrations: bool,
    pub cors_allowed_origins: Vec<String>,
    pub request_timeout: Duration,
    pub max_body_bytes: usize,
    pub jwt_secret: String,
    pub access_token_ttl: Duration,
    pub mediator_pubkeys: Vec<String>,
    pub settlement_model: SettlementModel,
    pub bitcoin_rpc_url: Option<String>,
    pub bitcoin_rpc_user: Option<String>,
    pub bitcoin_rpc_password: Option<String>,
    pub bitcoin_required_confirmations: u32,
    pub bitcoin_max_fee_sats: u64,
    pub bitcoin_max_fee_bps: u64,
    pub bitcoin_network: String,
    pub allow_mainnet: bool,
    pub webhook_signing_secret: String,
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "invalid configuration: {}", self.0);
    }
}

impl std::error::Error for ConfigError {}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let app_env = match optional("APP_ENV").as_deref().unwrap_or("development") {
            "development" => AppEnv::Development,
            "test" => AppEnv::Test,
            "production" => AppEnv::Production,
            other => {
                return Err(ConfigError(format!(
                    "APP_ENV must be development, test or production, got \"{}\"",
                    other
                )));
            }
        };

        let settlement_model = match optional("SETTLEMENT_MODEL")
            .as_deref()
            .unwrap_or("bitcoin_multisig_2of3")
        {
            "bitcoin_multisig_2of3" => SettlementModel::BitcoinMultisig2of3,
            "lightning_provider" => SettlementModel::LightningProvider,
            "fiat_provider" => SettlementModel::FiatProvider,
            "simulated" => SettlementModel::Simulated,
            other => {
                return Err(ConfigError(format!(
                    "unknown SETTLEMENT_MODEL \"{}\"",
                    other
                )));
            }
        };

        let config = Config {
            app_env,
            port: parse_or("PORT", 8080)?,
            database_url: required("DATABASE_URL")?,
            database_admin_url: optional("DATABASE_ADMIN_URL"),
            run_migrations: parse_or("RUN_MIGRATIONS", false)?,
            cors_allowed_origins: optional("CORS_ALLOWED_ORIGINS")
                .map(|value| {
                    value
                        .split(',')
                        .map(|o| o.trim().to_string())
                        .filter(|o| !o.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            request_timeout: Duration::from_secs(parse_or::<u64>("REQUEST_TIMEOUT_SECONDS", 30)?),
            max_body_bytes: parse_or::<usize>("MAX_BODY_KB", 1024)? * 1024,
            jwt_secret: required("JWT_SECRET")?,
            access_token_ttl: Duration::from_secs(
                60 * parse_or::<u64>("ACCESS_TOKEN_TTL_MINUTES", 60)?,
            ),
            mediator_pubkeys: optional("MEDIATOR_PUBKEYS")
                .map(|value| {
                    value
                        .split(',')
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            settlement_model,
            bitcoin_rpc_url: optional("BITCOIN_RPC_URL"),
            bitcoin_rpc_user: optional("BITCOIN_RPC_USER"),
            bitcoin_rpc_password: env::var("BITCOIN_RPC_PASSWORD")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            bitcoin_max_fee_sats: parse_or("BITCOIN_MAX_FEE_SATS", 10_000)?,
            bitcoin_max_fee_bps: parse_or("BITCOIN_MAX_FEE_BPS", 1000)?,
            bitcoin_required_confirmations: parse_or("BITCOIN_REQUIRED_CONFIRMATIONS", 1)?,
            bitcoin_network: optional("BITCOIN_NETWORK").unwrap_or_else(|| "regtest".into()),
            allow_mainnet: parse_or("OPENDEAL_ALLOW_MAINNET", false)?,
            webhook_signing_secret: optional("WEBHOOK_SIGNING_SECRET")
                .unwrap_or_else(|| "dev-webhook-signing-secret-change-me!!".into()),
        };

        config.validate()?;
        return Ok(config);
    }

    pub(crate) fn validate(&self) -> Result<(), ConfigError> {
        opendeal_bitcoin::escrow::parse_network(&self.bitcoin_network)
            .map_err(|_| ConfigError("invalid BITCOIN_NETWORK".into()))?;
        if self.bitcoin_required_confirmations == 0
            || self.bitcoin_max_fee_sats == 0
            || self.bitcoin_max_fee_bps == 0
            || self.bitcoin_max_fee_bps > 10_000
        {
            return Err(ConfigError("confirmation and fee policies must be positive; fee basis points cannot exceed 10000".into()));
        }
        if self.bitcoin_rpc_url.is_some() {
            for (name, value) in [
                ("BITCOIN_RPC_USER", &self.bitcoin_rpc_user),
                ("BITCOIN_RPC_PASSWORD", &self.bitcoin_rpc_password),
            ] {
                if value.as_ref().is_none_or(|value| value.trim().is_empty()) {
                    return Err(ConfigError(format!(
                        "{} is required when BITCOIN_RPC_URL is set",
                        name
                    )));
                }
            }
        }
        for key in &self.mediator_pubkeys {
            opendeal_core::verification::normalize_identity(key)
                .map_err(|_| ConfigError("invalid MEDIATOR_PUBKEYS".into()))?;
        }
        if self.run_migrations && self.database_admin_url.is_none() {
            return Err(ConfigError(
                "RUN_MIGRATIONS=true requires DATABASE_ADMIN_URL".into(),
            ));
        }
        if self.jwt_secret.len() < 32 {
            return Err(ConfigError(
                "JWT_SECRET must be at least 32 characters".into(),
            ));
        }
        if opendeal_bitcoin::escrow::parse_network(&self.bitcoin_network)
            .map_err(|_| ConfigError("invalid BITCOIN_NETWORK".into()))?
            == bitcoin::Network::Bitcoin
            && !self.allow_mainnet
        {
            return Err(ConfigError(
                "mainnet requires OPENDEAL_ALLOW_MAINNET=true".into(),
            ));
        }
        if self.is_production() {
            if self.jwt_secret.starts_with("dev-") || self.jwt_secret.contains("change-me") {
                return Err(ConfigError(
                    "production JWT_SECRET must replace the development placeholder".into(),
                ));
            }
            if self.cors_allowed_origins.is_empty()
                || self.cors_allowed_origins.iter().any(|origin| {
                    reqwest::Url::parse(origin).map_or(true, |url| {
                        url.scheme() != "https"
                            || url.host_str().is_none()
                            || !url.username().is_empty()
                            || url.password().is_some()
                            || url.path() != "/"
                            || url.query().is_some()
                            || url.fragment().is_some()
                    })
                })
            {
                return Err(ConfigError(
                    "production requires explicit HTTPS CORS_ALLOWED_ORIGINS".into(),
                ));
            }

            if self.settlement_model == SettlementModel::Simulated {
                return Err(ConfigError(
                    "SETTLEMENT_MODEL=simulated is refused in production".into(),
                ));
            }
            if self.mediator_pubkeys.is_empty() {
                return Err(ConfigError(
                    "MEDIATOR_PUBKEYS is required in production".into(),
                ));
            }
            if self.settlement_model == SettlementModel::BitcoinMultisig2of3
                && self.bitcoin_rpc_url.is_none()
            {
                return Err(ConfigError(
                    "BITCOIN_RPC_URL is required for bitcoin_multisig_2of3 in production".into(),
                ));
            }
        }
        return Ok(());
    }

    pub fn is_production(&self) -> bool {
        return self.app_env == AppEnv::Production;
    }
}

fn optional(name: &str) -> Option<String> {
    return env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
}

fn required(name: &str) -> Result<String, ConfigError> {
    return optional(name).ok_or_else(|| ConfigError(format!("{} must be set", name)));
}

fn parse_or<T: std::str::FromStr>(name: &str, default: T) -> Result<T, ConfigError> {
    return match optional(name) {
        None => Ok(default),
        Some(raw) => raw
            .parse()
            .map_err(|_| ConfigError(format!("{} has an invalid value \"{}\"", name, raw))),
    };
}

// Configuration contains database, JWT, webhook, and RPC secrets.
impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("app_env", &self.app_env)
            .field("port", &self.port)
            .finish_non_exhaustive()
    }
}
