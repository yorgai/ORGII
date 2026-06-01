//! Kiro proxy auth DB setup (market-key / MITM proxy mode)
//!
//! Builds a temp HOME directory with a Kiro-shaped SQLite that injects a
//! proxy token where Kiro CLI expects an AWS access token. No AWS SDK
//! dependency — the "AWS-looking" token is fake (`aoaAAAAA<b64>` prefix)
//! and the MITM proxy decodes it on the wire.
//!
//! Extracted out of the archived `sso.rs` so we can drop the
//! `aws-config` / `aws-sdk-ssooidc` crates while keeping market-key Kiro
//! sessions working. The own-key SSO login path lives in `.archive/kiro-sso/`;
//! own-key Kiro logins fall back to the PTY flow in `kiro_auth.rs`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::params;

const KIRO_DEVICE_REG_KEY: &str = "kirocli:odic:device-registration";
const KIRO_TOKEN_KEY: &str = "kirocli:odic:token";
const KIRO_SCOPES: &[&str] = &[
    "codewhisperer:completions",
    "codewhisperer:analysis",
    "codewhisperer:conversations",
];

fn kiro_sqlite_relative_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("Library/Application Support/kiro-cli/data.sqlite3")
    }
    #[cfg(target_os = "linux")]
    {
        PathBuf::from(".local/share/kiro-cli/data.sqlite3")
    }
    #[cfg(target_os = "windows")]
    {
        PathBuf::from("AppData/Roaming/kiro-cli/data.sqlite3")
    }
}

fn create_kiro_auth_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, migration_time INTEGER NOT NULL);\
         CREATE TABLE IF NOT EXISTS auth_kv (key TEXT PRIMARY KEY, value TEXT);\
         CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value BLOB);\
         CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, command TEXT, shell TEXT, pid INTEGER, session_id TEXT, cwd TEXT, start_time INTEGER, hostname TEXT, exit_code INTEGER, end_time INTEGER, duration INTEGER);\
         CREATE TABLE IF NOT EXISTS conversations (key TEXT PRIMARY KEY, value TEXT);\
         CREATE TABLE IF NOT EXISTS conversations_v2 (key TEXT NOT NULL, conversation_id TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key, conversation_id));\
         CREATE INDEX IF NOT EXISTS idx_conversations_v2_key_updated ON conversations_v2(key, updated_at DESC);\
         CREATE INDEX IF NOT EXISTS idx_conversations_v2_updated_at ON conversations_v2(updated_at DESC);",
    )
    .map_err(|err| format!("Failed to create Kiro auth schema: {}", err))?;

    for (id, version) in (1..=9).zip(0..=8) {
        conn.execute(
            "INSERT OR IGNORE INTO migrations (id, version, migration_time) VALUES (?1, ?2, ?3)",
            params![id, version, now_secs],
        )
        .map_err(|err| format!("Failed to seed Kiro auth migration row: {}", err))?;
    }

    Ok(())
}

fn write_kiro_auth_records(
    db_path: &Path,
    token_json: &serde_json::Value,
    device_reg_json: &serde_json::Value,
) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create Kiro auth dir: {}", err))?;
    }

    let conn = rusqlite::Connection::open(db_path)
        .map_err(|err| format!("Failed to open Kiro auth DB: {}", err))?;
    create_kiro_auth_schema(&conn)?;

    let token_str = serde_json::to_string(token_json)
        .map_err(|err| format!("Failed to serialize Kiro token: {}", err))?;
    let device_reg_str = serde_json::to_string(device_reg_json)
        .map_err(|err| format!("Failed to serialize Kiro device registration: {}", err))?;

    conn.execute(
        "INSERT OR REPLACE INTO auth_kv (key, value) VALUES (?1, ?2)",
        params![KIRO_TOKEN_KEY, token_str],
    )
    .map_err(|err| format!("Failed to write Kiro token record: {}", err))?;
    conn.execute(
        "INSERT OR REPLACE INTO auth_kv (key, value) VALUES (?1, ?2)",
        params![KIRO_DEVICE_REG_KEY, device_reg_str],
    )
    .map_err(|err| format!("Failed to write Kiro device registration record: {}", err))?;

    Ok(())
}

fn prepare_kiro_home(home: &Path) -> Result<(), String> {
    let bin_dir = home.join(".local").join("bin");
    std::fs::create_dir_all(&bin_dir)
        .map_err(|err| format!("Failed to create Kiro bin dir: {}", err))?;

    let real_home = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let candidates = [
        format!("{}/.local/bin/kiro-cli-chat", real_home),
        "/usr/local/bin/kiro-cli-chat".to_string(),
        "/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat".to_string(),
    ];
    for candidate in &candidates {
        let path = Path::new(candidate);
        if path.exists() {
            let target = bin_dir.join("kiro-cli-chat");
            if !target.exists() {
                #[cfg(unix)]
                std::os::unix::fs::symlink(path, &target)
                    .map_err(|err| format!("Failed to symlink kiro-cli-chat: {}", err))?;
            }
            break;
        }
    }

    std::fs::create_dir_all(home.join(".kiro").join("sessions").join("cli"))
        .map_err(|err| format!("Failed to create .kiro/sessions/cli: {}", err))?;
    Ok(())
}

/// Create a temp HOME directory with a pre-populated Kiro SQLite DB
/// containing the proxy token as the access_token.
///
/// Kiro CLI reads credentials from SQLite (not env vars), so we create
/// an isolated HOME with the proxy token injected. The caller sets
/// `HOME` to the returned path when spawning `kiro-cli acp`.
pub fn setup_proxy_auth_db(
    proxy_token: &str,
    region: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    let safe_id = session_id.replace(
        |char_value: char| !char_value.is_alphanumeric() && char_value != '-',
        "_",
    );
    let temp_home = std::env::temp_dir().join(format!("kiro-proxy-{}", safe_id));
    let db_path = temp_home.join(kiro_sqlite_relative_path());

    use base64::Engine;
    let proxy_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(proxy_token.as_bytes());
    let fake_aws_token = format!("aoaAAAAA{}", proxy_b64);
    let far_future = "2099-12-31T23:59:59Z";
    let token_json = serde_json::json!({
        "access_token": fake_aws_token,
        "refresh_token": "proxy_managed",
        "expires_at": far_future,
        "region": region,
        "start_url": "https://d-yorgproxy.awsapps.com/start",
        "oauth_flow": "DeviceCode",
        "scopes": KIRO_SCOPES
    });
    let device_reg_json = serde_json::json!({
        "client_id": "proxy_client",
        "client_secret": "proxy_secret",
        "client_secret_expires_at": far_future,
        "region": region,
        "oauth_flow": "DeviceCode",
        "scopes": KIRO_SCOPES
    });
    write_kiro_auth_records(&db_path, &token_json, &device_reg_json)?;
    prepare_kiro_home(&temp_home)?;
    log::info!("[KiroProxy] Created proxy auth DB at {:?}", db_path);

    Ok(temp_home)
}

pub fn setup_own_key_home(
    profile_home: &Path,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    let Some(access_token) = env_vars
        .get("KIRO_ACCESS_TOKEN")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        if env_vars
            .get("KIRO_API_KEY")
            .is_some_and(|value| !value.trim().is_empty())
        {
            prepare_kiro_home(profile_home)?;
            return Ok(());
        }
        return Err("Kiro own-key session requires KIRO_ACCESS_TOKEN or KIRO_API_KEY".to_string());
    };
    let refresh_token = env_vars
        .get("KIRO_REFRESH_TOKEN")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("orgii_managed");
    let region = env_vars
        .get("KIRO_REGION")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("us-east-1");
    let start_url = env_vars
        .get("KIRO_START_URL")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("https://d-92671f3112.awsapps.com/start");
    let client_id = env_vars
        .get("KIRO_CLIENT_ID")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("orgii_client");
    let client_secret = env_vars
        .get("KIRO_CLIENT_SECRET")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("orgii_secret");
    let expires_at = env_vars
        .get("KIRO_EXPIRES_AT")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("2099-12-31T23:59:59Z");

    let token_json = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "region": region,
        "start_url": start_url,
        "oauth_flow": "DeviceCode",
        "scopes": KIRO_SCOPES
    });
    let device_reg_json = serde_json::json!({
        "client_id": client_id,
        "client_secret": client_secret,
        "client_secret_expires_at": expires_at,
        "region": region,
        "oauth_flow": "DeviceCode",
        "scopes": KIRO_SCOPES
    });

    let db_path = profile_home.join(kiro_sqlite_relative_path());
    write_kiro_auth_records(&db_path, &token_json, &device_reg_json)?;
    prepare_kiro_home(profile_home)?;
    log::info!("[KiroProxy] Created own-key auth DB at {:?}", db_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_key_api_key_home_does_not_require_oauth_token() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut env_vars = HashMap::new();
        env_vars.insert("KIRO_API_KEY".to_string(), "api-key-test".to_string());

        setup_own_key_home(temp_dir.path(), &env_vars).unwrap();
        assert!(temp_dir
            .path()
            .join(".kiro")
            .join("sessions")
            .join("cli")
            .exists());
    }

    #[test]
    fn own_key_auth_db_writes_kiro_sqlite_records() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut env_vars = HashMap::new();
        env_vars.insert("KIRO_ACCESS_TOKEN".to_string(), "aoa-test".to_string());
        env_vars.insert("KIRO_REFRESH_TOKEN".to_string(), "aor-test".to_string());
        env_vars.insert("KIRO_REGION".to_string(), "us-west-2".to_string());
        env_vars.insert(
            "KIRO_START_URL".to_string(),
            "https://d-test.awsapps.com/start".to_string(),
        );
        env_vars.insert("KIRO_CLIENT_ID".to_string(), "client-test".to_string());
        env_vars.insert("KIRO_CLIENT_SECRET".to_string(), "secret-test".to_string());
        env_vars.insert(
            "KIRO_EXPIRES_AT".to_string(),
            "2030-01-01T00:00:00Z".to_string(),
        );

        setup_own_key_home(temp_dir.path(), &env_vars).unwrap();
        let db_path = temp_dir.path().join(kiro_sqlite_relative_path());
        let conn = rusqlite::Connection::open(db_path).unwrap();
        let token_json: String = conn
            .query_row(
                "SELECT value FROM auth_kv WHERE key = ?1",
                params![KIRO_TOKEN_KEY],
                |row| row.get(0),
            )
            .unwrap();
        let token: serde_json::Value = serde_json::from_str(&token_json).unwrap();
        assert_eq!(token["access_token"], "aoa-test");
        assert_eq!(token["refresh_token"], "aor-test");
        assert_eq!(token["region"], "us-west-2");

        let device_json: String = conn
            .query_row(
                "SELECT value FROM auth_kv WHERE key = ?1",
                params![KIRO_DEVICE_REG_KEY],
                |row| row.get(0),
            )
            .unwrap();
        let device: serde_json::Value = serde_json::from_str(&device_json).unwrap();
        assert_eq!(device["client_id"], "client-test");
        assert_eq!(device["client_secret"], "secret-test");
    }
}
