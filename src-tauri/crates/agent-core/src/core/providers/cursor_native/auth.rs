//! Auth + telemetry helpers for Cursor's native API.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::Connection;

pub const CURSOR_API_BASE: &str = "https://api2.cursor.sh";

const FALLBACK_CLIENT_VERSION: &str = "2.6.12";

static CURSOR_VERSION: OnceLock<String> = OnceLock::new();
static CURSOR_MACHINE_IDS: OnceLock<(String, Option<String>)> = OnceLock::new();

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
    .filter(|value| !value.is_empty())
}

pub fn cursor_client_version() -> &'static str {
    CURSOR_VERSION.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let plist = "/Applications/Cursor.app/Contents/Info.plist";
            if let Ok(output) = std::process::Command::new("defaults")
                .args(["read", plist, "CFBundleShortVersionString"])
                .output()
            {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !version.is_empty() {
                    return version;
                }
            }
        }
        FALLBACK_CLIENT_VERSION.to_string()
    })
}

pub fn cursor_machine_ids() -> &'static (String, Option<String>) {
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

pub fn generate_checksum() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
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
    let checksum = base64::engine::general_purpose::STANDARD.encode(encrypted);

    let (machine_id, mac_machine_id) = cursor_machine_ids();
    match mac_machine_id {
        Some(mac_id) => format!("{}{}/{}", checksum, machine_id, mac_id),
        None => format!("{}{}", checksum, machine_id),
    }
}

fn encrypt_bytes(input: &[u8]) -> Vec<u8> {
    let mut result = input.to_vec();
    let mut rolling: u8 = 165;
    for (index, byte) in result.iter_mut().enumerate() {
        *byte = (*byte ^ rolling).wrapping_add((index % 256) as u8);
        rolling = *byte;
    }
    result
}

pub fn extract_jwt(session_token: &str) -> String {
    let decoded = urlencoding::decode(session_token)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| session_token.to_string());
    if decoded.contains("::") {
        decoded.split("::").last().unwrap_or(&decoded).to_string()
    } else {
        decoded
    }
}

pub fn is_web_session_token(session_token: &str) -> bool {
    let jwt = extract_jwt(session_token);
    let Some(payload) = jwt.split('.').nth(1) else {
        return false;
    };
    let Ok(decoded) = URL_SAFE_NO_PAD.decode(payload) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&decoded) else {
        return false;
    };

    value.get("type").and_then(|value| value.as_str()) == Some("web")
}

pub fn localtime_timezone() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let link = std::fs::read_link("/etc/localtime").ok()?;
        let path = link.to_str()?;
        let marker = "zoneinfo/";
        let index = path.find(marker)? + marker.len();
        Some(path[index..].to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_jwt_strips_userid_prefix() {
        let token = "user_abc123%3A%3Aeyjhbg.payload.sig";
        assert_eq!(extract_jwt(token), "eyjhbg.payload.sig");
    }

    #[test]
    fn extract_jwt_passes_bare_jwt_through() {
        let bare = "eyjhbg.payload.sig";
        assert_eq!(extract_jwt(bare), bare);
    }

    #[test]
    fn checksum_has_stable_shape() {
        let checksum = generate_checksum();
        assert!(checksum.len() >= 8 + 64, "checksum too short: {checksum}");
    }
}
