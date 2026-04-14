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

    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_error_new() {
        let err = AppError::new("TEST_CODE", "test message");
        assert_eq!(err.code, "TEST_CODE");
        assert_eq!(err.message, "test message");
        assert!(err.details.is_none());
    }

    #[test]
    fn test_app_error_with_details() {
        let err = AppError::new("CODE", "msg").with_details(serde_json::json!({"key": "value"}));
        assert_eq!(err.details, Some(serde_json::json!({"key": "value"})));
    }

    #[test]
    fn test_not_found() {
        let err = AppError::not_found("user_123");
        assert_eq!(err.code, "NOT_FOUND");
        assert!(err.message.contains("user_123"));
    }

    #[test]
    fn test_invalid_input() {
        let err = AppError::invalid_input("email is empty");
        assert_eq!(err.code, "INVALID_INPUT");
        assert_eq!(err.message, "email is empty");
    }

    #[test]
    fn test_internal_error() {
        let err = AppError::internal("db connection failed");
        assert_eq!(err.code, "INTERNAL_ERROR");
    }

    #[test]
    fn test_permission_denied() {
        let err = AppError::permission_denied("no write access");
        assert_eq!(err.code, "PERMISSION_DENIED");
    }

    #[test]
    fn test_io_error() {
        let err = AppError::io_error("file not found");
        assert_eq!(err.code, "IO_ERROR");
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let app_err: AppError = io_err.into();
        assert_eq!(app_err.code, "IO_ERROR");
        assert!(app_err.message.contains("not found"));
    }

    #[test]
    fn test_from_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let app_err: AppError = json_err.into();
        assert_eq!(app_err.code, "PARSE_ERROR");
        assert!(app_err.message.contains("JSON parse error"));
    }

    #[test]
    fn test_bail_macro_returns_err() {
        fn check() -> Result<(), AppError> {
            bail!(AppError::internal("something went wrong"));
        }
        let result = check();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "INTERNAL_ERROR");
        assert_eq!(err.message, "something went wrong");
    }

    #[test]
    fn test_bail_macro_format_string() {
        fn check(val: i32) -> Result<(), AppError> {
            ensure!(val > 0, "value {} must be positive", val);
            Ok(())
        }
        assert!(check(-1).is_err());
        assert!(check(1).is_ok());
    }

    #[test]
    fn test_ensure_macro_passes() {
        fn check() -> Result<(), AppError> {
            ensure!(true, AppError::internal("should not reach"));
            Ok(())
        }
        assert!(check().is_ok());
    }

    #[test]
    fn test_ensure_macro_fails() {
        fn check(flag: bool) -> Result<(), AppError> {
            ensure!(flag, AppError::invalid_input("flag is false"));
            Ok(())
        }
        let result = check(false);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "INVALID_INPUT");
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let original = AppError::new("TEST", "hello").with_details(serde_json::json!({"n": 42}));
        let json = serde_json::to_string(&original).unwrap();
        let restored: AppError = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.code, original.code);
        assert_eq!(restored.message, original.message);
        assert_eq!(restored.details, original.details);
    }
}
