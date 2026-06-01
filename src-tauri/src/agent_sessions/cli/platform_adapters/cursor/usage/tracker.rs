//! Cursor Dashboard API client — fetches token usage events.

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tracing;

// ============================================
// Public types
// ============================================

/// Aggregated token usage from Cursor Dashboard API.
#[derive(Debug, Clone, Default)]
pub struct CursorUsageSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub event_count: usize,
    /// The most frequently occurring model in the returned events.
    /// Captures the *actual* model used (from the API), not the session's stored model.
    pub dominant_model: Option<String>,
}

// ============================================
// Internal API response types
// ============================================

#[derive(Debug, Deserialize)]
struct UsageResponse {
    #[serde(default)]
    #[serde(rename = "usageEventsDisplay")]
    usage_events_display: Vec<UsageEventRaw>,
}

#[derive(Debug, Deserialize)]
struct UsageEventRaw {
    #[serde(default)]
    model: Option<String>,
    #[serde(default, rename = "tokenUsage")]
    token_usage: Option<TokenUsageRaw>,
    /// Event timestamp from the Cursor Dashboard API (useful for debugging).
    #[serde(default)]
    #[allow(dead_code)]
    timestamp: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenUsageRaw {
    #[serde(default, rename = "inputTokens")]
    input_tokens: Option<u64>,
    #[serde(default, rename = "outputTokens")]
    output_tokens: Option<u64>,
    #[serde(default, rename = "cacheWriteTokens")]
    cache_write_tokens: Option<u64>,
    #[serde(default, rename = "cacheReadTokens")]
    cache_read_tokens: Option<u64>,
}

// ============================================
// Constants
// ============================================

const API_URL: &str = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const DEFAULT_PAGE_SIZE: u32 = 100;

/// Known base model identifiers for normalization.
/// Order matters: more specific names must come before generic ones.
const BASE_MODELS: &[&str] = &[
    "sonnet", "opus", "haiku", "claude", // claude AFTER its variants
    "gpt", "codex", "gemini", "grok", "composer", "o1", "o3", "o4",
];

/// Modifier keywords that appear in model names.
const MODIFIERS: &[&str] = &[
    "thinking", "high", "low", "xhigh", "fast", "max", "pro", "flash", "mini", "preview",
];

// ============================================
// Public API
// ============================================

/// Fetch token usage from the Cursor Dashboard API for a given time window.
///
/// # Arguments
///
/// * `session_token` — Full session token (`userId%3A%3AjwtToken` or raw JWT)
/// * `start_time` — Start of the time window
/// * `end_time` — End of the time window
/// * `model_filter` — Optional model name to filter events by (e.g., `"sonnet-4.5"`)
///
/// # Returns
///
/// Aggregated usage summary, or an error string on failure.
pub async fn fetch_cursor_usage(
    session_token: &str,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    model_filter: Option<&str>,
) -> Result<CursorUsageSummary, String> {
    let start_ms = start_time.timestamp_millis();
    let end_ms = end_time.timestamp_millis();

    let payload = serde_json::json!({
        "startDate": start_ms,
        "endDate": end_ms,
        "page": 1,
        "pageSize": DEFAULT_PAGE_SIZE,
    });

    // Build alternative token format for retry
    let alt_token = build_alt_token(session_token);

    // Try primary token first
    let client = reqwest::Client::new();
    let response = make_request(&client, session_token, &payload).await;

    let response = match response {
        Ok(resp) if is_auth_failure(resp.status()) => {
            // Try alternative format if available
            if let Some(ref alt) = alt_token {
                tracing::info!(
                    "[CursorUsage] Primary token format failed ({}), trying alternative",
                    resp.status()
                );
                make_request(&client, alt, &payload)
                    .await
                    .map_err(|err| format!("API request failed: {}", err))?
            } else {
                tracing::warn!(
                    "[CursorUsage] API auth failed ({}) and no alternative token available",
                    resp.status()
                );
                return Err(format!("Auth failed: {}", resp.status()));
            }
        }
        Ok(resp) => resp,
        Err(err) => return Err(format!("API request failed: {}", err)),
    };

    if !response.status().is_success() {
        let status = response.status();
        // A body-read failure on top of the API error is itself
        // diagnostic — preserve it so the warning shows
        // "(body read failed: <err>)" instead of an empty preview
        // that hides the transport issue.
        let body = match response.text().await {
            Ok(t) => t,
            Err(err) => format!("(body read failed: {})", err),
        };
        let preview: String = body.chars().take(200).collect();
        tracing::warn!("[CursorUsage] API error: {} — {}", status, preview);
        return Err(format!("API error: {}", status));
    }

    let data: UsageResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse response: {}", err))?;

    // Aggregate events, optionally filtering by model
    let mut summary = CursorUsageSummary::default();
    let mut model_counts: HashMap<String, usize> = HashMap::new();

    for event in &data.usage_events_display {
        // Apply model filter if specified
        if let Some(filter) = model_filter {
            if let Some(ref event_model) = event.model {
                if !models_match(filter, event_model) {
                    continue;
                }
            }
        }

        if let Some(ref usage) = event.token_usage {
            let input = usage.input_tokens.unwrap_or(0);
            let output = usage.output_tokens.unwrap_or(0);
            let cache_write = usage.cache_write_tokens.unwrap_or(0);
            let cache_read = usage.cache_read_tokens.unwrap_or(0);

            summary.input_tokens += input;
            summary.output_tokens += output;
            summary.cache_write_tokens += cache_write;
            summary.cache_read_tokens += cache_read;
            summary.event_count += 1;

            // Track model frequency
            if let Some(ref model_name) = event.model {
                *model_counts.entry(model_name.clone()).or_insert(0) += 1;
            }
        }
    }

    summary.total_tokens =
        summary.cache_write_tokens + summary.cache_read_tokens + summary.output_tokens;

    // Pick the most frequent model as the dominant model
    summary.dominant_model = model_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(model, _)| model);

    let models: Vec<&str> = data
        .usage_events_display
        .iter()
        .filter_map(|event| event.model.as_deref())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    tracing::info!(
        "[CursorUsage] Got {} events: {} in, {} out, {} cache_write, {} cache_read, total={}, models={:?}, dominant={:?}",
        summary.event_count,
        summary.input_tokens,
        summary.output_tokens,
        summary.cache_write_tokens,
        summary.cache_read_tokens,
        summary.total_tokens,
        models,
        summary.dominant_model,
    );

    Ok(summary)
}

// ============================================
// HTTP helpers
// ============================================

async fn make_request(
    client: &reqwest::Client,
    token: &str,
    payload: &serde_json::Value,
) -> Result<reqwest::Response, reqwest::Error> {
    client
        .post(API_URL)
        .header("Content-Type", "application/json")
        .header("Cookie", format!("WorkosCursorSessionToken={}", token))
        .header("Origin", "https://cursor.com")
        .header("Referer", "https://cursor.com/settings")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        )
        .json(payload)
        .send()
        .await
}

fn is_auth_failure(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 401 | 403 | 404 | 302 | 307)
}

/// Build an alternative token format for retry.
///
/// If the token is `userId%3A%3AjwtToken`, the alt is just the JWT.
/// If the token is a raw JWT, the alt tries to construct `userId%3A%3AjwtToken`.
fn build_alt_token(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split("%3A%3A").collect();
    if parts.len() == 2 {
        // Primary is prefixed → alt is just the JWT
        Some(parts[1].to_string())
    } else if token.matches('.').count() >= 2 {
        // Primary is raw JWT → try to extract user_id and build prefixed version
        extract_user_id_from_jwt(token).map(|uid| format!("{}%3A%3A{}", uid, token))
    } else {
        None
    }
}

/// Extract user_id (`sub` claim) from a JWT token.
fn extract_user_id_from_jwt(jwt: &str) -> Option<String> {
    use base64::Engine;

    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() < 2 {
        return None;
    }

    // Base64url decode the payload
    let payload_b64 = parts[1];
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let decoded = engine.decode(payload_b64).ok()?;
    let payload: serde_json::Value = serde_json::from_slice(&decoded).ok()?;

    payload
        .get("sub")
        .or_else(|| payload.get("user_id"))
        .and_then(|val| val.as_str())
        .map(|s| s.to_string())
}

// ============================================
// Model normalization
// ============================================

/// Normalized model representation: (base, version, modifiers).
type ModelNorm = (String, String, HashSet<String>);

/// Normalize a model name to `(base, version, modifiers)` for comparison.
///
/// Handles CLI vs API naming differences:
/// - `"sonnet-4.5"` → `("sonnet", "4.5", {})`
/// - `"claude-4.5-sonnet"` → `("sonnet", "4.5", {})`
/// - `"claude-4.5-opus-high-thinking"` → `("opus", "4.5", {"high", "thinking"})`
/// - `"gpt-4o-mini"` → `("gpt", "4o", {"mini"})`
/// - `"auto"` / `"default"` → `("auto", "", {})`
pub(crate) fn normalize_model(model: &str) -> ModelNorm {
    if model.is_empty() {
        return (String::new(), String::new(), HashSet::new());
    }

    let model_lower = model.to_lowercase().trim().to_string();

    // Special: "default" is API name for "auto"
    if model_lower == "default" || model_lower == "auto" {
        return ("auto".to_string(), String::new(), HashSet::new());
    }

    // Find base model
    let mut base = String::new();
    for candidate in BASE_MODELS {
        if model_lower.contains(candidate) {
            base = candidate.to_string();
            break;
        }
    }

    // Extract version: digit(s) + optional decimal + optional letter suffix
    let version_re = Regex::new(r"(\d+(?:\.\d+)?[a-z]?)").unwrap();
    let mut version = String::new();

    if !base.is_empty() {
        // Split by the base to find version on either side
        let parts: Vec<&str> = model_lower.splitn(2, base.as_str()).collect();
        for part in &parts {
            if let Some(cap) = version_re.find(part) {
                version = cap.as_str().to_string();
                break;
            }
        }
    } else {
        // No base found, try to extract version from the full string
        if let Some(cap) = version_re.find(&model_lower) {
            version = cap.as_str().to_string();
        }
    }

    // Extract modifiers
    let mods: HashSet<String> = MODIFIERS
        .iter()
        .filter(|modifier| model_lower.contains(**modifier))
        .map(|modifier| modifier.to_string())
        .collect();

    (base, version, mods)
}

/// Check if a CLI model name matches an API-reported model name.
///
/// Handles Cursor-specific quirks:
/// - `"opus-4.5"` matches `"claude-4.5-opus-high"` (Cursor adds `-high` internally)
/// - `"sonnet-4.5"` matches `"claude-4.5-sonnet"`
/// - `"auto"` matches any model
/// - `"composer-1"` matches other composer models only
pub(crate) fn models_match(cli_model: &str, api_model: &str) -> bool {
    if cli_model.is_empty() || api_model.is_empty() {
        return false;
    }

    let cli_norm = normalize_model(cli_model);
    let api_norm = normalize_model(api_model);

    // Exact match
    if cli_norm == api_norm {
        return true;
    }

    let (cli_base, cli_ver, cli_mods) = &cli_norm;
    let (api_base, api_ver, api_mods) = &api_norm;

    // Composer: only matches other composer models
    if cli_base == "composer" && api_base == "composer" {
        return true;
    }

    // Auto matches any model
    if cli_base == "auto" {
        return true;
    }

    // Can't match if we couldn't identify a base for either
    if cli_base.is_empty() || api_base.is_empty() {
        return false;
    }

    // Special case for opus: Cursor routes "opus-4.5" to "claude-4.5-opus-high"
    if cli_base == "opus" && api_base == "opus" && cli_ver == api_ver {
        let quality_mods: HashSet<String> = ["high", "low", "xhigh"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let cli_quality: HashSet<String> = cli_mods.intersection(&quality_mods).cloned().collect();
        let api_quality: HashSet<String> = api_mods.intersection(&quality_mods).cloned().collect();
        let cli_other: HashSet<String> = cli_mods.difference(&quality_mods).cloned().collect();
        let api_other: HashSet<String> = api_mods.difference(&quality_mods).cloned().collect();

        if cli_quality.is_empty()
            && api_quality.len() == 1
            && api_quality.contains("high")
            && cli_other == api_other
        {
            return true;
        }
    }

    false
}

// ============================================
// Local Cursor token extraction
// ============================================

/// Read the session token from the locally installed Cursor IDE.
///
/// This is the same account the Cursor CLI authenticates as. Reads from
/// `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (macOS).
///
/// Returns the token in format `{userId}%3A%3A{jwtToken}`, or `None` if not found.
pub fn get_local_cursor_session_token() -> Option<String> {
    let db_path = get_cursor_state_db_path()?;

    let conn = match rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(conn) => conn,
        Err(err) => {
            tracing::debug!("[CursorUsage] Failed to open Cursor state DB: {}", err);
            return None;
        }
    };

    let jwt_token: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
            [],
            |row| row.get(0),
        )
        .ok()?;

    if jwt_token.is_empty() {
        return None;
    }

    // Construct full token: {userId}%3A%3A{jwtToken}
    match extract_user_id_from_jwt(&jwt_token) {
        Some(user_id) => {
            tracing::debug!(
                "[CursorUsage] Extracted local Cursor token for user {}...",
                &user_id[..user_id.len().min(12)]
            );
            Some(format!("{}%3A%3A{}", user_id, jwt_token))
        }
        None => {
            tracing::debug!("[CursorUsage] Using raw JWT (no user_id extracted)");
            Some(jwt_token)
        }
    }
}

fn get_cursor_state_db_path() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    {
        let path = home.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let path = home.join("AppData/Roaming/Cursor/User/globalStorage/state.vscdb");
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let path = home.join(".config/Cursor/User/globalStorage/state.vscdb");
        if path.exists() {
            return Some(path);
        }
    }

    None
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
#[path = "tests/tracker_tests.rs"]
mod tests;
