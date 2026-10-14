use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ApiEnvelope<T> {
    pub message: String,
    pub data: T,
    pub success: bool,
}

impl<T> ApiEnvelope<T> {
    pub fn ok(message: impl Into<String>, data: T) -> Self {
        return Self {
            message: message.into(),
            data,
            success: true,
        };
    }
}
