use std::env;
use std::path::PathBuf;
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
    pub pilot_max_amount_sats: Option<u64>,
    pub allow_mainnet: bool,
    pub security_review_ack: bool,
    pub allowed_pubkeys: Vec<String>,
    pub bitcoin_rpc_fallback_url: Option<String>,
    pub rate_limit_per_minute: u32,
    pub lightning_api_url: Option<String>,
    pub lightning_api_key: Option<String>,
    pub fiat_api_url: Option<String>,
    pub fiat_api_key: Option<String>,
    pub webhook_signing_secret: String,
    pub webhook_max_attempts: u32,
    pub webhook_retry_interval_secs: u64,
    pub evidence_dir: PathBuf,
    pub r2_bucket: Option<String>,
    pub r2_endpoint: Option<String>,
    pub r2_access_key_id: Option<String>,
    pub r2_secret_access_key: Option<String>,
    pub r2_region: String,
    pub resend_api_key: Option<String>,
    pub email_from: Option<String>,
    pub otel_endpoint: Option<String>,
    pub sentry_dsn: Option<String>,
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

        let bitcoin_network = optional("BITCOIN_NETWORK").unwrap_or_else(|| "regtest".into());
        let pilot_max_amount_sats = parse_pilot_max_amount(&bitcoin_network)?;

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
            bitcoin_network,
            pilot_max_amount_sats,
            allow_mainnet: parse_or("OPENDEAL_ALLOW_MAINNET", false)?,
            security_review_ack: parse_or("OPENDEAL_SECURITY_REVIEW_ACK", false)?,
            allowed_pubkeys: split_csv("OPENDEAL_ALLOWED_PUBKEYS"),
            bitcoin_rpc_fallback_url: optional("BITCOIN_RPC_URL_FALLBACK"),
            rate_limit_per_minute: parse_or("RATE_LIMIT_PER_MINUTE", 120)?,
            lightning_api_url: optional("LIGHTNING_API_URL"),
            lightning_api_key: optional("LIGHTNING_API_KEY"),
            fiat_api_url: optional("FIAT_API_URL"),
            fiat_api_key: optional("FIAT_API_KEY"),
            webhook_signing_secret: optional("WEBHOOK_SIGNING_SECRET")
                .unwrap_or_else(|| "dev-webhook-signing-secret-change-me!!".into()),
            webhook_max_attempts: parse_or("WEBHOOK_MAX_ATTEMPTS", 8)?,
            webhook_retry_interval_secs: parse_or("WEBHOOK_RETRY_INTERVAL_SECS", 15)?,
            evidence_dir: PathBuf::from(
                optional("EVIDENCE_DIR").unwrap_or_else(|| "./data/evidence".into()),
            ),
            r2_bucket: optional("R2_BUCKET"),
            r2_endpoint: optional("R2_ENDPOINT"),
            r2_access_key_id: optional("R2_ACCESS_KEY_ID"),
            r2_secret_access_key: optional("R2_SECRET_ACCESS_KEY"),
            r2_region: optional("R2_REGION").unwrap_or_else(|| "auto".into()),
            resend_api_key: optional("RESEND_API_KEY"),
            email_from: optional("EMAIL_FROM"),
            otel_endpoint: optional("OTEL_EXPORTER_OTLP_ENDPOINT"),
            sentry_dsn: optional("SENTRY_DSN"),
        };

        config.validate()?;
        return Ok(config);
    }

    pub fn r2_enabled(&self) -> bool {
        return self.r2_bucket.is_some()
            && self.r2_endpoint.is_some()
            && self.r2_access_key_id.is_some()
            && self.r2_secret_access_key.is_some();
    }

    pub fn email_enabled(&self) -> bool {
        return self.resend_api_key.is_some() && self.email_from.is_some();
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
        if is_mainnet_name(&self.bitcoin_network) {
            if !self.allow_mainnet {
                return Err(ConfigError(
                    "mainnet requires OPENDEAL_ALLOW_MAINNET=1".into(),
                ));
            }
            if !self.is_production() {
                return Err(ConfigError(
                    "mainnet requires APP_ENV=production (dev session mint stays off)".into(),
                ));
            }
            if !self.security_review_ack {
                return Err(ConfigError(
                    "mainnet requires OPENDEAL_SECURITY_REVIEW_ACK=1 after an external review of opendeal-bitcoin".into(),
                ));
            }
            if self.mediator_pubkeys.is_empty() {
                return Err(ConfigError(
                    "mainnet requires MEDIATOR_PUBKEYS".into(),
                ));
            }
            if self.allowed_pubkeys.is_empty() {
                return Err(ConfigError(
                    "mainnet requires OPENDEAL_ALLOWED_PUBKEYS (known counterparties only)".into(),
                ));
            }
            match self.pilot_max_amount_sats {
                Some(cap) if cap > 0 && cap <= 100_000 => {}
                Some(cap) => {
                    return Err(ConfigError(format!(
                        "mainnet pilot cap must be 1..=100000 sats, got {cap}"
                    )));
                }
                None => {
                    return Err(ConfigError(
                        "mainnet refuses an unlimited pilot cap; set PILOT_MAX_AMOUNT_SATS".into(),
                    ));
                }
            }
            if self.bitcoin_required_confirmations < 3 {
                return Err(ConfigError(
                    "mainnet requires BITCOIN_REQUIRED_CONFIRMATIONS>=3".into(),
                ));
            }
            if self.bitcoin_rpc_url.is_none() {
                return Err(ConfigError(
                    "mainnet requires BITCOIN_RPC_URL".into(),
                ));
            }
        }
        let r2_any = self.r2_bucket.is_some()
            || self.r2_endpoint.is_some()
            || self.r2_access_key_id.is_some()
            || self.r2_secret_access_key.is_some();
        if r2_any && !self.r2_enabled() {
            return Err(ConfigError(
                "R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must all be set together".into(),
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
            if self.settlement_model == SettlementModel::LightningProvider
                && (self.lightning_api_url.is_none() || self.lightning_api_key.is_none())
            {
                return Err(ConfigError(
                    "production Lightning requires LIGHTNING_API_URL and LIGHTNING_API_KEY; in-memory stubs are refused".into(),
                ));
            }
            if self.settlement_model == SettlementModel::FiatProvider
                && (self.fiat_api_url.is_none() || self.fiat_api_key.is_none())
            {
                return Err(ConfigError(
                    "production fiat requires FIAT_API_URL and FIAT_API_KEY; in-memory stubs are refused".into(),
                ));
            }
        }
        return Ok(());
    }

    pub fn is_production(&self) -> bool {
        return self.app_env == AppEnv::Production;
    }
}

pub fn is_mainnet_name(network: &str) -> bool {
    return matches!(
        network.to_ascii_lowercase().as_str(),
        "bitcoin" | "mainnet"
    );
}

fn split_csv(name: &str) -> Vec<String> {
    return optional(name)
        .map(|value| {
            value
                .split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect()
        })
        .unwrap_or_default();
}

fn parse_pilot_max_amount(network: &str) -> Result<Option<u64>, ConfigError> {
    return match optional("PILOT_MAX_AMOUNT_SATS") {
        Some(raw) => {
            let value: u64 = raw.parse().map_err(|_| {
                ConfigError(format!(
                    "PILOT_MAX_AMOUNT_SATS has an invalid value \"{}\"",
                    raw
                ))
            })?;
            if value == 0 {
                Ok(None)
            } else {
                Ok(Some(value))
            }
        }
        None => Ok(default_pilot_max_amount(network)),
    };
}

fn default_pilot_max_amount(network: &str) -> Option<u64> {
    return match network.to_ascii_lowercase().as_str() {
        "regtest" => None,
        "testnet" | "testnet3" | "signet" => Some(100_000),
        "bitcoin" | "mainnet" => Some(50_000),
        _ => Some(100_000),
    };
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
