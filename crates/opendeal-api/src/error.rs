use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug)]
pub enum ApiError {
    BadRequest {
        message: String,
        code: Option<&'static str>,
    },
    Unauthorized {
        message: String,
        code: Option<&'static str>,
    },
    Forbidden {
        message: String,
        code: Option<&'static str>,
    },
    NotFound(String),
    Conflict {
        message: String,
        code: Option<&'static str>,
    },
    TooManyRequests(String),
    Internal(String),
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        return ApiError::BadRequest {
            message: message.into(),
            code: None,
        };
    }

    pub fn bad_request_with_code(message: impl Into<String>, code: &'static str) -> Self {
        return ApiError::BadRequest {
            message: message.into(),
            code: Some(code),
        };
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        return ApiError::Unauthorized {
            message: message.into(),
            code: None,
        };
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        return ApiError::Forbidden {
            message: message.into(),
            code: None,
        };
    }

    pub fn conflict_with_code(message: impl Into<String>, code: &'static str) -> Self {
        return ApiError::Conflict {
            message: message.into(),
            code: Some(code),
        };
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        return ApiError::NotFound(message.into());
    }

    pub fn too_many_requests(message: impl Into<String>) -> Self {
        return ApiError::TooManyRequests(message.into());
    }
}

#[derive(Serialize)]
struct ErrorBody {
    message: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message, code) = match self {
            ApiError::BadRequest { message, code } => (StatusCode::BAD_REQUEST, message, code),
            ApiError::Unauthorized { message, code } => (StatusCode::UNAUTHORIZED, message, code),
            ApiError::Forbidden { message, code } => (StatusCode::FORBIDDEN, message, code),
            ApiError::NotFound(message) => (StatusCode::NOT_FOUND, message, None),
            ApiError::Conflict { message, code } => (StatusCode::CONFLICT, message, code),
            ApiError::TooManyRequests(message) => {
                (StatusCode::TOO_MANY_REQUESTS, message, Some("rate_limited"))
            }
            ApiError::Internal(message) => {
                tracing::error!(error = %message, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong".to_string(),
                    None,
                )
            }
        };
        return (
            status,
            Json(ErrorBody {
                message,
                success: false,
                code,
            }),
        )
            .into_response();
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        if err
            .as_database_error()
            .is_some_and(|error| error.code().as_deref() == Some("23505"))
        {
            return ApiError::conflict_with_code(
                "resource already exists or funding outpoint is already assigned",
                "duplicate_resource",
            );
        }
        return ApiError::Internal(err.to_string());
    }
}

impl From<opendeal_core::ProtocolError> for ApiError {
    fn from(err: opendeal_core::ProtocolError) -> Self {
        return match err {
            opendeal_core::ProtocolError::IllegalTransition { .. } => {
                ApiError::conflict_with_code(err.to_string(), "illegal_transition")
            }
            opendeal_core::ProtocolError::Unauthorized(msg) => ApiError::forbidden(msg),
            other => ApiError::bad_request(other.to_string()),
        };
    }
}
