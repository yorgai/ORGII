//! Cursor AI chat client via Connect RPC protocol.
//!
//! Calls `api2.cursor.sh/aiserver.v1.AiService/StreamChat` using HTTP
//! with Connect streaming JSON format. No gRPC or protobuf dependencies needed.
//!
//! Protocol details reverse-engineered from Cursor's source and
//! <https://github.com/everestmz/cursor-rpc>

use base64::Engine;
use reqwest::Client;
use rusqlite::Connection;
use serde_json::json;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::info;

const CURSOR_API_BASE: &str = "https://api2.cursor.sh";
const FALLBACK_CLIENT_VERSION: &str = "2.6.12";
const STREAM_CHAT_PATH: &str = "/aiserver.v1.AiService/StreamChat";
const REQUEST_TIMEOUT_SECS: u64 = 30;

static CURSOR_VERSION: OnceLock<String> = OnceLock::new();
static CURSOR_MACHINE_IDS: OnceLock<(String, Option<String>)> = OnceLock::new();

// ---------------------------------------------------------------------------
// Cursor environment helpers
// ---------------------------------------------------------------------------

fn cursor_state_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    #[cfg(target_os = "macos")]
    let path = home.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    #[cfg(target_os = "windows")]
    let path = home.join("AppData/Roaming/Cursor/User/globalStorage/state.vscdb");
    #[cfg(target_os = "linux")]
    let path = home.join(".config/Cursor/User/globalStorage/state.vscdb");
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return None;
    path.exists().then_some(path)
}

fn read_db_key(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .ok()
    .filter(|v| !v.is_empty())
}

/// Read the installed Cursor version from Info.plist, with fallback.
fn cursor_client_version() -> &'static str {
    CURSOR_VERSION.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let plist = "/Applications/Cursor.app/Contents/Info.plist";
            if let Ok(output) = std::process::Command::new("defaults")
                .args(["read", plist, "CFBundleShortVersionString"])
                .output()
            {
                let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !ver.is_empty() {
                    return ver;
                }
            }
        }
        FALLBACK_CLIENT_VERSION.to_string()
    })
}

/// Read machine IDs from Cursor's state database (telemetry.machineId, telemetry.macMachineId).
fn cursor_machine_ids() -> &'static (String, Option<String>) {
    CURSOR_MACHINE_IDS.get_or_init(|| {
        let fallback = (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            None,
        );
        let Some(db_path) = cursor_state_db_path() else {
            return fallback;
        };
        let Ok(conn) =
            Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            return fallback;
        };
        let machine_id =
            read_db_key(&conn, "telemetry.machineId").unwrap_or_else(|| fallback.0.clone());
        let mac_machine_id = read_db_key(&conn, "telemetry.macMachineId");
        (machine_id, mac_machine_id)
    })
}

// ---------------------------------------------------------------------------
// Checksum generation (matches Cursor's JS implementation exactly)
// ---------------------------------------------------------------------------

/// Generate the `x-cursor-checksum` header value.
///
/// Cursor JS source:
/// ```js
/// const S = Math.floor(Date.now() / 1e6);
/// const k = new Uint8Array([S>>40&255, S>>32&255, S>>24&255, S>>16&255, S>>8&255, S&255]);
/// const E = qqt(k);  // rolling XOR encrypt
/// const C = base64(E);
/// // format: base64 + machineId [+ "/" + macMachineId]
/// ```
fn generate_checksum() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Cursor JS: Math.floor(Date.now() / 1e6)
    let timestamp = millis / 1_000_000;

    let timestamp_bytes: [u8; 6] = [
        (timestamp >> 40) as u8,
        (timestamp >> 32) as u8,
        (timestamp >> 24) as u8,
        (timestamp >> 16) as u8,
        (timestamp >> 8) as u8,
        timestamp as u8,
    ];

    let encrypted = encrypt_bytes(&timestamp_bytes);
    let b64 = base64::engine::general_purpose::STANDARD.encode(encrypted);

    let (machine_id, mac_machine_id) = cursor_machine_ids();
    match mac_machine_id {
        Some(mac_id) => format!("{}{}/{}", b64, machine_id, mac_id),
        None => format!("{}{}", b64, machine_id),
    }
}

/// Rolling XOR encryption — matches Cursor's JS `qqt` function.
fn encrypt_bytes(input: &[u8]) -> Vec<u8> {
    let mut result = input.to_vec();
    let mut w: u8 = 165;
    for (i, byte) in result.iter_mut().enumerate() {
        *byte = (*byte ^ w).wrapping_add((i % 256) as u8);
        w = *byte;
    }
    result
}

// ---------------------------------------------------------------------------
// Token / envelope helpers
// ---------------------------------------------------------------------------

/// Extract the JWT portion from a Cursor session token.
/// The stored format is `userId%3A%3AjwtToken`. The API needs just the JWT.
fn extract_jwt(session_token: &str) -> String {
    let decoded = urlencoding::decode(session_token)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| session_token.to_string());
    if decoded.contains("::") {
        decoded.split("::").last().unwrap_or(&decoded).to_string()
    } else {
        decoded
    }
}

/// Wrap a JSON message in a Connect streaming envelope.
/// Format: `[flags: 1B][length: 4B big-endian][data: NB]`
fn wrap_connect_envelope(json_bytes: &[u8]) -> Vec<u8> {
    let len = json_bytes.len() as u32;
    let mut envelope = Vec::with_capacity(5 + json_bytes.len());
    envelope.push(0x00);
    envelope.extend_from_slice(&len.to_be_bytes());
    envelope.extend_from_slice(json_bytes);
    envelope
}

/// Read the IANA timezone from the system (macOS: /etc/localtime symlink).
fn localtime_timezone() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let link = std::fs::read_link("/etc/localtime").ok()?;
        let path = link.to_str()?;
        let marker = "zoneinfo/";
        let idx = path.find(marker)? + marker.len();
        Some(path[idx..].to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Call Cursor's StreamChat API and return the concatenated response text.
pub async fn cursor_stream_chat(
    session_token: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let version = cursor_client_version();
    let client = Client::builder()
        .user_agent(format!("cursor/{}", version))
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {}", err))?;
    let access_token = extract_jwt(session_token);

    let request_body = json!({
        "modelDetails": {
            "modelName": model
        },
        "conversation": [
            {
                "text": prompt,
                "type": "MESSAGE_TYPE_HUMAN"
            }
        ]
    });

    info!(
        "cursor_stream_chat: model={} version={} prompt_len={}",
        model,
        version,
        prompt.len()
    );

    let json_bytes = serde_json::to_vec(&request_body)
        .map_err(|err| format!("Failed to serialize request: {}", err))?;
    let envelope = wrap_connect_envelope(&json_bytes);

    let url = format!("{}{}", CURSOR_API_BASE, STREAM_CHAT_PATH);

    let timezone = localtime_timezone().unwrap_or_else(|| "UTC".to_string());
    let session_id = uuid::Uuid::new_v4().to_string();

    let response = client
        .post(&url)
        .header("Content-Type", "application/connect+json")
        .header("Connect-Protocol-Version", "1")
        .header("authorization", format!("Bearer {}", access_token))
        .header("x-cursor-client-version", version)
        .header("x-cursor-client-type", "ide")
        .header("x-cursor-client-os", std::env::consts::OS)
        .header("x-cursor-client-arch", std::env::consts::ARCH)
        .header("x-cursor-client-device-type", "desktop")
        .header("x-ghost-mode", "false")
        .header("x-new-onboarding-completed", "true")
        .header("x-cursor-timezone", &timezone)
        .header("x-session-id", &session_id)
        .header("x-cursor-checksum", generate_checksum())
        .body(envelope)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|err| format!("Cursor API request failed: {}", err))?;

    let status = response.status().as_u16();
    if status != 200 {
        // A body-read failure here is itself diagnostic — preserve
        // the error so the user sees "(body read failed: ...)"
        // instead of an empty body that makes the HTTP failure
        // look like the server returned no diagnostic info.
        let body = match response.text().await {
            Ok(t) => t,
            Err(err) => format!("(body read failed: {})", err),
        };
        return Err(format!(
            "Cursor API HTTP {}: {}",
            status,
            &body[..body.len().min(300)]
        ));
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read Cursor response body: {}", err))?;

    let text = parse_connect_stream(&body_bytes)?;

    if text.is_empty() {
        return Err("Cursor StreamChat returned empty response".to_string());
    }

    info!("cursor_stream_chat: success, response_len={}", text.len());
    Ok(text)
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// Parse Connect RPC streaming response envelopes.
///
/// Each envelope: `[flags: 1B][length: 4B big-endian][JSON payload]`
/// - flags 0x00 = data frame (contains `{"text": "..."}`)
/// - flags 0x02 = trailer frame (may contain `{"error": {...}}`)
fn parse_connect_stream(data: &[u8]) -> Result<String, String> {
    let mut result = String::new();
    let mut offset = 0;

    while offset + 5 <= data.len() {
        let flags = data[offset];
        let length = u32::from_be_bytes([
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
            data[offset + 4],
        ]) as usize;
        offset += 5;

        if offset + length > data.len() {
            break;
        }

        let payload = &data[offset..offset + length];
        offset += length;

        let json_str = match std::str::from_utf8(payload) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let value: serde_json::Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if flags & 0x02 != 0 {
            if let Some(err_msg) = value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
            {
                if result.is_empty() {
                    return Err(format!("Cursor API error: {}", err_msg));
                }
            }
            continue;
        }

        if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
            result.push_str(text);
        }
    }

    Ok(result)
}
