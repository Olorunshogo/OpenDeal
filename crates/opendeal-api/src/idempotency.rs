use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;

/// Creation keys are scoped and atomically persisted in the deal service. Other
/// mutations are idempotent through locked state, unique signatures and txids.
pub struct IdempotencyKey {
    pub key: Option<String>,
}
impl FromRequestParts<AppState> for IdempotencyKey {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get("Idempotency-Key")
            .map(|value| {
                value
                    .to_str()
                    .map(str::to_owned)
                    .map_err(|_| ApiError::bad_request("invalid Idempotency-Key"))
            })
            .transpose()?;
        if key
            .as_ref()
            .is_some_and(|key| key.is_empty() || key.len() > 128)
        {
            return Err(ApiError::bad_request(
                "Idempotency-Key must contain 1..128 characters",
            ));
        }
        Ok(Self { key })
    }
}
