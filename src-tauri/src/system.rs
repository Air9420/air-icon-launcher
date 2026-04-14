use crate::error::{AppError, AppResult};
use std::process::Command;

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::invalid_input("URL cannot be empty"));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL on Windows: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL on macOS: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL on Linux: {}", e)))?;
    }

    Ok(())
}

#[tauri::command]
pub fn fetch_favicon_from_url(url: String) -> AppResult<Option<String>> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(None);
    }

    let domain = match extract_domain(url) {
        Some(d) => d,
        None => return Ok(None),
    };

    let favicon_url = format!("https://{}/favicon.ico", domain);

    #[cfg(target_os = "windows")]
    {
        let ps_script = format!(
            "try {{ \
                $response = Invoke-WebRequest -Uri '{}' -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 1 -ErrorAction Stop; \
                if ($response.StatusCode -eq 200 -and $response.Content.Length -gt 0) {{ \
                    Write-Output 'SUCCESS:'; \
                    [Convert]::ToBase64String($response.Content) \
                }} else {{ \
                    Write-Output 'FAILED:StatusCode'; \
                }} \
             }} catch {{ \
                Write-Output ('FAILED:' + $_.Exception.Message); \
             }}",
            favicon_url
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| AppError::internal(format!("Failed to fetch favicon: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("SUCCESS:") {
            let base64 = stdout.replace("SUCCESS:", "").trim().to_string();
            if !base64.is_empty() && base64.len() > 100 {
                return Ok(Some(base64));
            }
        }
    }

    Ok(None)
}

fn extract_domain(url: &str) -> Option<String> {
    let url = url.trim();
    let without_protocol = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);

    let domain = without_protocol
        .split('/')
        .next()
        .unwrap_or(without_protocol)
        .split(':')
        .next()
        .unwrap_or(without_protocol);

    if domain.is_empty() || domain.contains('.') {
        Some(domain.to_string())
    } else {
        None
    }
}
