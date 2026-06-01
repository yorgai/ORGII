//! Heartbeat Import
//!
//! Imports heartbeats from IDE local history and AI CLI logs into
//! `coding_heartbeats`. VS Code family IDEs (Code, Cursor, Trae, Windsurf)
//! store `User/History/{hash}/entries.json` with per-file save timestamps.
//! AI CLIs store JSONL history at `~/.claude/history.jsonl` and
//! `~/.codex/history.jsonl`.
//!
//! Scan progress is tracked per source in `ide_scan_progress` so repeated
//! scans only process new entries.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::params;

use super::collector::detect_language;
use super::types::ActivitySource;
use database::db::get_connection;

const RETENTION_DAYS: i64 = 90;

// ============================================
// IDE History Directory Configs
// ============================================

struct IdeHistoryConfig {
    source: ActivitySource,
    app_name: &'static str,
}

const VSCODE_FAMILY: &[IdeHistoryConfig] = &[
    IdeHistoryConfig {
        source: ActivitySource::VsCode,
        app_name: "Code",
    },
    IdeHistoryConfig {
        source: ActivitySource::Cursor,
        app_name: "Cursor",
    },
    IdeHistoryConfig {
        source: ActivitySource::Trae,
        app_name: "Trae",
    },
    IdeHistoryConfig {
        source: ActivitySource::Windsurf,
        app_name: "Windsurf",
    },
];

// ============================================
// Public API
// ============================================

/// Scan all supported IDE history directories and insert new heartbeats.
/// Returns the total number of heartbeats inserted.
pub fn scan_all() -> Result<u64, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let mut total_inserted: u64 = 0;

    for config in VSCODE_FAMILY {
        let history_dir = ide_history_dir(&home, config.app_name);
        match scan_vscode_history(config.source, &history_dir) {
            Ok(count) => {
                if count > 0 {
                    println!(
                        "[heartbeat_import] Imported {} heartbeats from {}",
                        count, config.app_name
                    );
                }
                total_inserted += count;
            }
            Err(err) => {
                eprintln!(
                    "[heartbeat_import] Error scanning {}: {}",
                    config.app_name, err
                );
            }
        }
    }

    match scan_ai_cli_history(&home) {
        Ok(count) => {
            if count > 0 {
                println!(
                    "[heartbeat_import] Imported {} heartbeats from AI CLI history",
                    count
                );
            }
            total_inserted += count;
        }
        Err(err) => {
            eprintln!("[heartbeat_import] Error scanning AI CLI history: {}", err);
        }
    }

    if total_inserted > 0 {
        println!(
            "[heartbeat_import] Total: {} new heartbeats imported",
            total_inserted
        );
    }

    Ok(total_inserted)
}

// ============================================
// VS Code Family History Scanner
// ============================================

fn scan_vscode_history(source: ActivitySource, history_dir: &Path) -> Result<u64, String> {
    if !history_dir.is_dir() {
        return Ok(0);
    }

    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;

    let last_ts_ms = get_last_scan_timestamp(&conn, source);
    let cutoff_ms = cutoff_timestamp_ms();
    let threshold_ms = last_ts_ms.max(cutoff_ms);

    let entries = fs::read_dir(history_dir).map_err(|err| format!("Read dir error: {}", err))?;

    let mut inserted: u64 = 0;
    let mut max_ts_ms: i64 = last_ts_ms;

    for entry in entries.flatten() {
        let entry_dir = entry.path();
        if !entry_dir.is_dir() {
            continue;
        }

        let entries_json = entry_dir.join("entries.json");
        if !entries_json.exists() {
            continue;
        }

        let content = match fs::read_to_string(&entries_json) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let parsed = match parse_entries_json(&content) {
            Some(parsed) => parsed,
            None => continue,
        };

        let file_path = match uri_to_path(&parsed.resource) {
            Some(path) => path,
            None => continue,
        };

        let language = match detect_language(&file_path) {
            Some(lang) => lang,
            None => continue,
        };

        let repo = extract_repo_name(&file_path);

        for ts_ms in &parsed.timestamps {
            if *ts_ms <= threshold_ms {
                continue;
            }

            let timestamp_iso = ms_to_iso(*ts_ms);

            let result = conn.execute(
                "INSERT INTO coding_heartbeats
                    (timestamp, workspace_path, file_path, language, source, event_type, lines_added, lines_removed, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'file_edit', 0, 0, 'retroactive_ide')",
                params![
                    timestamp_iso,
                    repo,
                    file_path,
                    language,
                    source.to_string(),
                ],
            );

            if result.is_ok() {
                inserted += 1;
                if *ts_ms > max_ts_ms {
                    max_ts_ms = *ts_ms;
                }
            }
        }
    }

    if max_ts_ms > last_ts_ms {
        update_scan_progress(&conn, source, max_ts_ms);
    }

    Ok(inserted)
}

// ============================================
// AI CLI History Scanner
// ============================================

struct AiCliHistoryConfig {
    name: &'static str,
    source: ActivitySource,
    dir_from_home: &'static str,
    file_name: &'static str,
    timestamp_unit: TimestampUnit,
}

enum TimestampUnit {
    Milliseconds,
    Seconds,
}

const AI_CLI_HISTORY_CONFIGS: &[AiCliHistoryConfig] = &[
    AiCliHistoryConfig {
        name: "Claude Code",
        source: ActivitySource::ClaudeCode,
        dir_from_home: ".claude",
        file_name: "history.jsonl",
        timestamp_unit: TimestampUnit::Milliseconds,
    },
    AiCliHistoryConfig {
        name: "Codex",
        source: ActivitySource::Codex,
        dir_from_home: ".codex",
        file_name: "history.jsonl",
        timestamp_unit: TimestampUnit::Seconds,
    },
    AiCliHistoryConfig {
        name: "Gemini CLI",
        source: ActivitySource::GeminiCli,
        dir_from_home: ".gemini",
        file_name: "history.jsonl",
        timestamp_unit: TimestampUnit::Milliseconds,
    },
    AiCliHistoryConfig {
        name: "Kiro CLI",
        source: ActivitySource::KiroCli,
        dir_from_home: ".kiro",
        file_name: "history.jsonl",
        timestamp_unit: TimestampUnit::Milliseconds,
    },
    AiCliHistoryConfig {
        name: "Aider",
        source: ActivitySource::Aider,
        dir_from_home: ".aider",
        file_name: "history.jsonl",
        timestamp_unit: TimestampUnit::Seconds,
    },
];

fn scan_ai_cli_history(home: &Path) -> Result<u64, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let cutoff_ms = cutoff_timestamp_ms();
    let mut total_inserted: u64 = 0;

    for config in AI_CLI_HISTORY_CONFIGS {
        let history_file = home.join(config.dir_from_home).join(config.file_name);
        if !history_file.exists() {
            continue;
        }

        let last_ts_ms = get_last_scan_timestamp(&conn, config.source);
        let threshold_ms = last_ts_ms.max(cutoff_ms);
        let mut max_ts_ms: i64 = last_ts_ms;

        let content = match fs::read_to_string(&history_file) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let session_cwd_map: HashMap<String, String> = if config.dir_from_home == ".codex" {
            build_codex_session_cwd_map(home)
        } else {
            HashMap::new()
        };

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let ts_ms = match parse_ai_cli_timestamp(trimmed, &config.timestamp_unit) {
                Some(ts) => ts,
                None => continue,
            };

            if ts_ms <= threshold_ms {
                continue;
            }

            let workspace_path = ["workspace", "cwd", "path", "root"]
                .iter()
                .find_map(|field| parse_jsonl_string_field(trimmed, field))
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    parse_jsonl_string_field(trimmed, "session_id")
                        .and_then(|sid| session_cwd_map.get(&sid).cloned())
                })
                .or_else(|| Some(config.dir_from_home.to_string()));
            let timestamp_iso = ms_to_iso(ts_ms);

            let result = conn.execute(
                "INSERT INTO coding_heartbeats
                    (timestamp, workspace_path, file_path, language, source, event_type, lines_added, lines_removed, metadata_json)
                 VALUES (?1, ?2, NULL, NULL, ?3, 'agent_action', 0, 0, ?4)",
                params![
                    timestamp_iso,
                    workspace_path,
                    config.source.to_string(),
                    config.name,
                ],
            );

            if result.is_ok() {
                total_inserted += 1;
                if ts_ms > max_ts_ms {
                    max_ts_ms = ts_ms;
                }
            }
        }

        if max_ts_ms > last_ts_ms {
            update_scan_progress(&conn, config.source, max_ts_ms);
        }
    }

    Ok(total_inserted)
}

/// Build session_id -> cwd map from Codex rollout JSONL files.
/// Rollout files contain session_meta with id and cwd for each session.
fn build_codex_session_cwd_map(home: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let sessions_dir = home.join(".codex").join("sessions");
    if !sessions_dir.is_dir() {
        return map;
    }

    for year_entry in fs::read_dir(&sessions_dir).into_iter().flatten().flatten() {
        if !year_entry.path().is_dir() {
            continue;
        }
        for month_entry in fs::read_dir(year_entry.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if !month_entry.path().is_dir() {
                continue;
            }
            for day_entry in fs::read_dir(month_entry.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                if !day_entry.path().is_dir() {
                    continue;
                }
                for file_entry in fs::read_dir(day_entry.path())
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    let path = file_entry.path();
                    if path.extension().is_none_or(|e| e != "jsonl") {
                        continue;
                    }
                    if let Ok(content) = fs::read_to_string(&path) {
                        for line in content.lines() {
                            let t = line.trim();
                            if t.is_empty() || !t.contains("session_meta") {
                                continue;
                            }
                            if let (Some(id), Some(cwd)) = (
                                parse_jsonl_string_field(t, "id"),
                                parse_jsonl_string_field(t, "cwd"),
                            ) {
                                if !id.is_empty() && !cwd.is_empty() {
                                    map.insert(id, cwd);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    map
}

fn parse_ai_cli_timestamp(line: &str, unit: &TimestampUnit) -> Option<i64> {
    let ts_key = match unit {
        TimestampUnit::Milliseconds => "\"timestamp\"",
        TimestampUnit::Seconds => "\"ts\"",
    };

    let key_pos = line.find(ts_key)?;
    let after_key = &line[key_pos + ts_key.len()..];
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();
    let end_pos = after_colon
        .find(|ch: char| !ch.is_ascii_digit())
        .unwrap_or(after_colon.len());
    let raw_ts = after_colon[..end_pos].parse::<i64>().ok()?;

    match unit {
        TimestampUnit::Milliseconds => Some(raw_ts),
        TimestampUnit::Seconds => Some(raw_ts * 1000),
    }
}

fn parse_jsonl_string_field(line: &str, field: &str) -> Option<String> {
    let key = format!("\"{}\"", field);
    let key_pos = line.find(&key)?;
    let after_key = &line[key_pos + key.len()..];
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();

    if !after_colon.starts_with('"') {
        return None;
    }

    let value_start = 1;
    let mut end_pos = value_start;
    let bytes = after_colon.as_bytes();
    while end_pos < bytes.len() {
        if bytes[end_pos] == b'"' && (end_pos == 0 || bytes[end_pos - 1] != b'\\') {
            break;
        }
        end_pos += 1;
    }

    Some(after_colon[value_start..end_pos].to_string())
}

// ============================================
// JSON Parsing (no serde_json dependency)
// ============================================

struct ParsedEntries {
    resource: String,
    timestamps: Vec<i64>,
}

fn parse_entries_json(content: &str) -> Option<ParsedEntries> {
    let resource = extract_json_string(content, "\"resource\"")?;

    let entries_start = content.find("\"entries\"")?;
    let array_start = content[entries_start..].find('[')? + entries_start;
    let array_end = content[array_start..].find(']')? + array_start;
    let array_content = &content[array_start + 1..array_end];

    let mut timestamps = Vec::new();
    let mut search_from = 0;
    while let Some(ts_key_pos) = array_content[search_from..].find("\"timestamp\"") {
        let abs_pos = search_from + ts_key_pos;
        let after_key = &array_content[abs_pos + 11..];
        if let Some(colon) = after_key.find(':') {
            let after_colon = after_key[colon + 1..].trim_start();
            let end_pos = after_colon
                .find(|ch: char| !ch.is_ascii_digit())
                .unwrap_or(after_colon.len());
            if let Ok(ts) = after_colon[..end_pos].parse::<i64>() {
                timestamps.push(ts);
            }
        }
        search_from = abs_pos + 11;
    }

    if timestamps.is_empty() {
        return None;
    }

    Some(ParsedEntries {
        resource,
        timestamps,
    })
}

fn extract_json_string(content: &str, key: &str) -> Option<String> {
    let key_pos = content.find(key)?;
    let after_key = &content[key_pos + key.len()..];
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();

    if !after_colon.starts_with('"') {
        return None;
    }

    let value_start = 1;
    let mut end_pos = value_start;
    let bytes = after_colon.as_bytes();
    while end_pos < bytes.len() {
        if bytes[end_pos] == b'"' && (end_pos == 0 || bytes[end_pos - 1] != b'\\') {
            break;
        }
        end_pos += 1;
    }

    Some(after_colon[value_start..end_pos].to_string())
}

// ============================================
// Path Utilities
// ============================================

fn uri_to_path(uri: &str) -> Option<String> {
    let path_str = uri.strip_prefix("file://")?;
    Some(percent_decode(path_str))
}

fn percent_decode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else {
            result.push(ch);
        }
    }
    result
}

fn extract_repo_name(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    let mut first_marker: Option<&Path> = None;

    for ancestor in path.ancestors() {
        if ancestor == Path::new("/") || ancestor == Path::new("") {
            break;
        }
        if ancestor.join(".git").is_dir() {
            return Some(ancestor.to_string_lossy().to_string());
        }
        if first_marker.is_none() {
            let has_marker = [
                "package.json",
                "Cargo.toml",
                "go.mod",
                "pyproject.toml",
                "build.gradle",
            ]
            .iter()
            .any(|marker| ancestor.join(marker).exists());
            if has_marker {
                first_marker = Some(ancestor);
            }
        }
    }

    if let Some(p) = first_marker {
        return Some(p.to_string_lossy().to_string());
    }

    // Fallback: paths with no .git or workspace markers (app config, temp, etc.).
    // Use a stable label so they group instead of becoming null/Unknown.
    let path_str = path.to_string_lossy();
    let path_lower = path_str.to_lowercase();

    // App config / editor dirs (order: most specific first)
    if path_str.contains(".cursor") {
        return Some(".cursor".to_string());
    }
    if path_str.contains(".vscode") {
        return Some(".vscode".to_string());
    }
    if path_str.contains(".idea") && !path_str.contains(".git") {
        return Some(".idea".to_string());
    }
    if path_str.contains(".config") {
        return Some(".config".to_string());
    }
    if path_str.contains(".local") {
        return Some(".local".to_string());
    }
    if path_str.contains(".cache") {
        return Some(".cache".to_string());
    }

    // Temp dirs
    if path_lower.contains("/tmp/") || path_lower.contains("\\tmp\\") {
        return Some("tmp".to_string());
    }
    if path_lower.contains("/temp/") || path_lower.contains("\\temp\\") {
        return Some("temp".to_string());
    }
    if path_str.contains("/var/folders/") {
        return Some("tmp".to_string());
    }

    // macOS Application Support (e.g. ~/Library/Application Support/Cursor/...)
    if path_str.contains("Application Support") {
        if let Some(rest) = path_str.split("Application Support").nth(1) {
            let components: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
            if let Some(first) = components.first() {
                let name = first.trim();
                if !name.is_empty() && name != "User" {
                    return Some(name.to_string());
                }
            }
        }
    }

    // Windows AppData
    if path_lower.contains("appdata") {
        if path_lower.contains("appdata\\roaming") || path_lower.contains("appdata/roaming") {
            return Some("AppData".to_string());
        }
        if path_lower.contains("appdata\\local") || path_lower.contains("appdata/local") {
            return Some("AppData".to_string());
        }
    }

    None
}

fn ide_history_dir(home: &Path, app_name: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join(app_name)
            .join("User")
            .join("History")
    }
    #[cfg(target_os = "linux")]
    {
        home.join(".config")
            .join(app_name)
            .join("User")
            .join("History")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        home.join("AppData")
            .join("Roaming")
            .join(app_name)
            .join("User")
            .join("History")
    }
}

// ============================================
// DB Helpers
// ============================================

fn get_last_scan_timestamp(conn: &rusqlite::Connection, source: ActivitySource) -> i64 {
    conn.query_row(
        "SELECT last_timestamp_ms FROM ide_scan_progress WHERE source = ?1",
        params![source.to_string()],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn update_scan_progress(conn: &rusqlite::Connection, source: ActivitySource, ts_ms: i64) {
    conn.execute(
        "INSERT OR REPLACE INTO ide_scan_progress (source, last_timestamp_ms) VALUES (?1, ?2)",
        params![source.to_string(), ts_ms],
    )
    .ok();
}

fn cutoff_timestamp_ms() -> i64 {
    let cutoff = chrono::Utc::now()
        .naive_utc()
        .checked_sub_signed(chrono::Duration::days(RETENTION_DAYS));
    match cutoff {
        Some(dt) => dt.and_utc().timestamp_millis(),
        None => 0,
    }
}

fn ms_to_iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
        .unwrap_or_default()
}
