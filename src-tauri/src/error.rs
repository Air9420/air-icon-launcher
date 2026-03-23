use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::new(
            "NOT_FOUND",
            format!("Resource not found: {}", resource.into()),
        )
    }

    pub fn invalid_input(reason: impl Into<String>) -> Self {
        Self::new("INVALID_INPUT", reason)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new("INTERNAL_ERROR", msg)
    }

    pub fn permission_denied(reason: impl Into<String>) -> Self {
        Self::new("PERMISSION_DENIED", reason)
    }

    pub fn io_error(msg: impl Into<String>) -> Self {
        Self::new("IO_ERROR", msg)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::io_error(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("PARSE_ERROR", format!("JSON parse error: {}", e))
    }
}

impl From<std::string::FromUtf8Error> for AppError {
    fn from(e: std::string::FromUtf8Error) -> Self {
        Self::new("ENCODING_ERROR", format!("UTF-8 encoding error: {}", e))
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[macro_export]
macro_rules! bail {
    ($err:expr) => {
        return Err($err.into());
    };
    ($fmt:literal, $($arg:tt)*) => {
        return Err($crate::error::AppError::new("USER_ERROR", format!($fmt, $($arg)*)));
    };
}

#[macro_export]
macro_rules! ensure {
    ($cond:expr, $err:expr) => {
        if !$cond {
            return Err($err.into());
        }
    };
    ($cond:expr, $fmt:literal, $($arg:tt)*) => {
        if !$cond {
            return Err($crate::error::AppError::new("USER_ERROR", format!($fmt, $($arg)*)));
        }
    };
}
