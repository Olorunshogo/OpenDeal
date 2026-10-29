//! Read-only client for the public OpenDeal API endpoints. Sends no credentials.

use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::identity::parse_public_key;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// Connection refused, DNS failure, timeout.
    Unreachable(String),
    /// Non-2xx with the API's `message` when present.
    Http { status: u16, message: String },
    /// 2xx with an unexpected body.
    Decode(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return match self {
            ApiError::Unreachable(m) => write!(f, "API unreachable: {}", m),
            ApiError::Http { status, message } => write!(f, "HTTP {}: {}", status, message),
            ApiError::Decode(m) => write!(f, "unexpected API response: {}", m),
        };
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Meta {
    pub network: String,
    pub settlement_model: String,
    pub custody: String,
    pub pilot_max_amount_sats: Option<u64>,
    pub required_confirmations: u32,
    pub demo_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediatorEntry {
    /// Normalized x-only identity.
    pub pubkey: String,
    pub display_name: String,
    /// `registry` (signed registration, administrator approved) or `configuration` (MEDIATOR_PUBKEYS).
    pub source: String,
}

#[derive(Deserialize)]
struct RawMediator {
    pubkey: String,
    display_name: String,
    status: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Deserialize)]
struct ErrorBody {
    message: String,
}

pub struct ApiClient {
    base: String,
    http: reqwest::blocking::Client,
}

pub fn validate_base_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| format!("invalid URL: {}", raw))?;
    if !["http", "https"].contains(&url.scheme()) {
        return Err("URL must use http or https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL must not embed credentials".into());
    }
    return Ok(url.as_str().trim_end_matches('/').to_string());
}

impl ApiClient {
    pub fn new(base: &str) -> Result<Self, String> {
        let base = validate_base_url(base)?;
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(4))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("opendeal-tui/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;
        return Ok(ApiClient { base, http });
    }

    fn get(&self, path: &str) -> Result<(u16, String), ApiError> {
        let response = self
            .http
            .get(format!("{}{}", self.base, path))
            .send()
            .map_err(|e| {
                ApiError::Unreachable(if e.is_timeout() {
                    "timed out".into()
                } else if e.is_connect() {
                    "connection refused".into()
                } else {
                    "request failed".into()
                })
            })?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .map_err(|_| ApiError::Decode("unreadable body".into()))?;
        return Ok((status, body));
    }

    fn get_envelope<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let (status, body) = self.get(path)?;
        if !(200..300).contains(&status) {
            let message = serde_json::from_str::<ErrorBody>(&body)
                .map(|b| b.message)
                .unwrap_or_else(|_| "no error message".into());
            return Err(ApiError::Http { status, message });
        }
        return serde_json::from_str::<Envelope<T>>(&body)
            .map(|e| e.data)
            .map_err(|e| ApiError::Decode(e.to_string()));
    }

    /// `GET /health` (liveness).
    pub fn health(&self) -> Result<(), ApiError> {
        let (status, body) = self.get("/health")?;
        if status == 200 && body.trim() == "ok" {
            return Ok(());
        }
        return Err(ApiError::Http {
            status,
            message: body.chars().take(80).collect(),
        });
    }

    /// `GET /health/ready`: true when the API can query Postgres.
    pub fn database_ready(&self) -> Result<bool, ApiError> {
        let (status, _) = self.get("/health/ready")?;
        return match status {
            200 => Ok(true),
            503 => Ok(false),
            other => Err(ApiError::Http {
                status: other,
                message: "unexpected readiness status".into(),
            }),
        };
    }

    pub fn meta(&self) -> Result<Meta, ApiError> {
        return self.get_envelope("/api/v1/meta");
    }

    /// Approved mediators. Entries with invalid keys are dropped and counted, never trusted.
    pub fn mediators(&self) -> Result<(Vec<MediatorEntry>, usize), ApiError> {
        let raw: Vec<RawMediator> = self.get_envelope("/api/v1/mediators")?;
        return Ok(sanitize_mediators(raw));
    }
}

fn sanitize_mediators(raw: Vec<RawMediator>) -> (Vec<MediatorEntry>, usize) {
    let mut out: Vec<MediatorEntry> = Vec::new();
    let mut rejected = 0;
    for m in raw {
        let name_ok = !m.display_name.trim().is_empty()
            && m.display_name.len() <= 80
            && !m.display_name.chars().any(char::is_control);
        match parse_public_key(&m.pubkey) {
            Ok(pubkey) if m.status == "approved" && name_ok => {
                if !out.iter().any(|e| e.pubkey == pubkey) {
                    out.push(MediatorEntry {
                        pubkey,
                        display_name: m.display_name.trim().to_string(),
                        source: m.source.unwrap_or_else(|| "registry".into()),
                    });
                }
            }
            _ => rejected += 1,
        }
    }
    return (out, rejected);
}

/// Everything the dashboard shows about the backend, gathered off the UI thread.
#[derive(Debug, Clone)]
pub struct StatusSnapshot {
    pub health: Result<(), ApiError>,
    pub database_ready: Option<Result<bool, ApiError>>,
    pub meta: Option<Result<Meta, ApiError>>,
    pub mediators: Option<Result<(Vec<MediatorEntry>, usize), ApiError>>,
    pub checked_at: chrono::DateTime<chrono::Utc>,
}

impl StatusSnapshot {
    pub fn collect(api_url: &str) -> StatusSnapshot {
        let now = chrono::Utc::now();
        let client = match ApiClient::new(api_url) {
            Ok(c) => c,
            Err(e) => {
                return StatusSnapshot {
                    health: Err(ApiError::Unreachable(e)),
                    database_ready: None,
                    meta: None,
                    mediators: None,
                    checked_at: now,
                };
            }
        };
        let health = client.health();
        if health.is_err() {
            return StatusSnapshot {
                health,
                database_ready: None,
                meta: None,
                mediators: None,
                checked_at: now,
            };
        }
        return StatusSnapshot {
            health,
            database_ready: Some(client.database_ready()),
            meta: Some(client.meta()),
            mediators: Some(client.mediators()),
            checked_at: now,
        };
    }

    pub fn online(&self) -> bool {
        return self.health.is_ok();
    }

    pub fn meta(&self) -> Option<&Meta> {
        return self.meta.as_ref().and_then(|m| m.as_ref().ok());
    }

    pub fn mediator_list(&self) -> &[MediatorEntry] {
        return match &self.mediators {
            Some(Ok((list, _))) => list,
            _ => &[],
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::tests::test_pubkey_xonly;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Minimal HTTP server answering each request from `routes` (path -> (status, body)).
    fn serve(routes: Vec<(&'static str, u16, String)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(16) {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, body) = routes
                    .iter()
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, s, b)| (*s, b.clone()))
                    .unwrap_or((404, "{\"message\":\"not found\",\"success\":false}".into()));
                let _ = write!(
                    stream,
                    "HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    status,
                    body.len(),
                    body
                );
            }
        });
        return format!("http://{}", addr);
    }

    #[test]
    fn parses_status_meta_and_sanitizes_mediators() {
        let mediators = serde_json::json!({"message":"approved mediators","success":true,"data":[
            {"pubkey": test_pubkey_xonly(3), "display_name":"Desk A","status":"approved","source":"registry"},
            {"pubkey": "not-a-key", "display_name":"Bad","status":"approved","source":"registry"},
            {"pubkey": test_pubkey_xonly(4), "display_name":"Pending","status":"pending"},
        ]});
        let meta = serde_json::json!({"message":"meta","success":true,"data":{
            "network":"regtest","settlement_model":"bitcoin_multisig_2of3","custody":"multisig_2of3_no_server_keys",
            "pilot_max_amount_sats":null,"required_confirmations":1,"rate_limit_per_minute":120,
            "bitcoin_max_fee_sats":10000,"bitcoin_max_fee_bps":1000,"demo_enabled":true}});
        let base = serve(vec![
            ("/health", 200, "ok".into()),
            ("/health/ready", 503, "database unavailable".into()),
            ("/api/v1/meta", 200, meta.to_string()),
            ("/api/v1/mediators", 200, mediators.to_string()),
        ]);
        let snapshot = StatusSnapshot::collect(&base);
        assert!(snapshot.online());
        assert_eq!(snapshot.database_ready, Some(Ok(false)));
        assert_eq!(snapshot.meta().unwrap().network, "regtest");
        let (list, rejected) = snapshot.mediators.unwrap().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].display_name, "Desk A");
        assert_eq!(rejected, 2);
    }

    #[test]
    fn reports_http_errors_with_api_message() {
        let base = serve(vec![
            ("/health", 200, "ok".into()),
            (
                "/api/v1/meta",
                429,
                "{\"message\":\"rate limit exceeded; retry shortly\",\"success\":false}".into(),
            ),
            ("/api/v1/mediators", 200, "{not json".into()),
        ]);
        let client = ApiClient::new(&base).unwrap();
        assert_eq!(
            client.meta().unwrap_err(),
            ApiError::Http {
                status: 429,
                message: "rate limit exceeded; retry shortly".into()
            }
        );
        assert!(matches!(client.mediators(), Err(ApiError::Decode(_))));
    }

    #[test]
    fn unreachable_api_is_reported_not_panicked() {
        // Bind then drop to get a port that is very likely closed.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let snapshot = StatusSnapshot::collect(&format!("http://127.0.0.1:{}", port));
        assert!(!snapshot.online());
        assert!(matches!(snapshot.health, Err(ApiError::Unreachable(_))));
        assert!(snapshot.meta.is_none());
    }

    #[test]
    fn base_url_validation() {
        assert_eq!(
            validate_base_url("http://localhost:8080/").unwrap(),
            "http://localhost:8080"
        );
        assert!(validate_base_url("ftp://x").is_err());
        assert!(validate_base_url("http://user:pw@localhost").is_err());
        assert!(validate_base_url("nope").is_err());
    }
}
