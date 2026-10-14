use std::time::Duration;

use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

#[derive(Clone)]
pub struct JwtKeys {
    secret: String,
    ttl: Duration,
}

impl JwtKeys {
    pub fn new(secret: &str, ttl: Duration) -> Self {
        return JwtKeys {
            secret: secret.to_string(),
            ttl,
        };
    }

    pub fn issue(&self, pubkey: &str) -> Result<String, ApiError> {
        let exp = (chrono::Utc::now() + self.ttl).timestamp() as usize;
        let claims = Claims {
            sub: pubkey.to_string(),
            exp,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|err| ApiError::Internal(format!("failed to issue token: {}", err)))?;
        return Ok(token);
    }

    pub fn verify(&self, token: &str) -> Result<String, ApiError> {
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|_| ApiError::unauthorized("invalid or expired token"))?;
        return Ok(data.claims.sub);
    }
}
