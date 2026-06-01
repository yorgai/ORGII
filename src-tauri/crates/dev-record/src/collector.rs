//! Heartbeat Collector
//!
//! Central ingestion point for coding activity. Implements:
//! - Dedup: skip if same (file_path, source) within 2 minutes
//! - Rate limiting: max 30 heartbeats per minute
//! - Session management: gap > 5 min closes current session, starts new one
//! - Language detection from file extension
//! - Auto-cleanup of old heartbeats on init

use chrono::{NaiveDateTime, Utc};
use rusqlite::params;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

use super::ide_detector;
use super::types::{ActivitySource, EventType, Heartbeat};
use database::db::get_connection;

// ============================================
// Constants
// ============================================

const DEDUP_WINDOW_SECS: i64 = 120;
const MAX_RECENT_ENTRIES: usize = 200;
const RATE_LIMIT_PER_MINUTE: usize = 30;
const SESSION_GAP_SECS: i64 = 300;
const HEARTBEAT_RETENTION_DAYS: i64 = 90;
const SESSION_RETENTION_DAYS: i64 = 180;

// ============================================
// Dedup + Rate Limiting State
// ============================================

struct RecentEntry {
    file_path: String,
    source: ActivitySource,
    timestamp: Instant,
}

struct CollectorState {
    recent: VecDeque<RecentEntry>,
    minute_timestamps: VecDeque<Instant>,
    last_heartbeat_time: Option<String>,
    current_session_id: Option<i64>,
}

static COLLECTOR: std::sync::OnceLock<Mutex<CollectorState>> = std::sync::OnceLock::new();

fn get_state() -> &'static Mutex<CollectorState> {
    COLLECTOR.get_or_init(|| {
        Mutex::new(CollectorState {
            recent: VecDeque::with_capacity(MAX_RECENT_ENTRIES),
            minute_timestamps: VecDeque::with_capacity(RATE_LIMIT_PER_MINUTE + 1),
            last_heartbeat_time: None,
            current_session_id: None,
        })
    })
}

// ============================================
// Public API
// ============================================

/// Record a heartbeat. Applies dedup and rate-limiting before persisting.
///
/// The mutex is held only for in-memory checks (dedup, rate-limit, session
/// decision). DB I/O runs outside the lock to avoid blocking other callers.
pub fn record_heartbeat(heartbeat: Heartbeat) {
    let state = get_state();
    let now = Instant::now();

    // Step 1: check dedup/rate-limit and prepare session decision under lock
    let session_decision = {
        // Poisoned mutex would silently stop ALL dev-record event
        // collection (rate-limit + session bookkeeping live here)
        // for the rest of the process lifetime. Warn so the
        // poisoning surfaces instead of looking like "no events".
        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    "dev_record::collector: state mutex poisoned; event collection will be silently disabled until process restart"
                );
                return;
            }
        };

        guard
            .minute_timestamps
            .retain(|ts| now.duration_since(*ts).as_secs() < 60);
        if guard.minute_timestamps.len() >= RATE_LIMIT_PER_MINUTE {
            return;
        }

        if let Some(ref file_path) = heartbeat.file_path {
            let is_dup = guard.recent.iter().any(|entry| {
                entry.source == heartbeat.source
                    && entry.file_path == *file_path
                    && now.duration_since(entry.timestamp).as_secs() < DEDUP_WINDOW_SECS as u64
            });
            if is_dup {
                return;
            }
        }

        prepare_session_decision(&guard, &heartbeat)
    }; // lock released

    // Step 2: DB operations (no lock held)
    if let Some(prev_id) = session_decision.close_prev_id {
        close_session(prev_id, session_decision.close_prev_end.as_deref());
    }

    let new_session_id = if session_decision.create_new {
        create_session(
            &heartbeat.timestamp,
            &heartbeat.source,
            heartbeat.workspace_path.as_deref(),
        )
    } else {
        session_decision.existing_id
    };

    if let Err(err) = insert_heartbeat(&heartbeat) {
        eprintln!("[dev_record] Failed to insert heartbeat: {}", err);
        return;
    }

    if let Some(sid) = new_session_id {
        update_session_heartbeat_count(sid);
    }

    // Step 3: update in-memory tracking state under lock
    if let Ok(mut guard) = state.lock() {
        if let Some(ref file_path) = heartbeat.file_path {
            if guard.recent.len() >= MAX_RECENT_ENTRIES {
                guard.recent.pop_front();
            }
            guard.recent.push_back(RecentEntry {
                file_path: file_path.clone(),
                source: heartbeat.source,
                timestamp: now,
            });
        }

        guard.minute_timestamps.push_back(now);
        guard.last_heartbeat_time = Some(heartbeat.timestamp.clone());
        guard.current_session_id = new_session_id;
    }
}

/// Record a file change detected by the git watcher. Attributes it to the
/// frontmost IDE (or `Unknown` if ambiguous).
pub fn record_file_change(
    workspace_path: Option<String>,
    file_path: String,
    lines_added: i32,
    lines_removed: i32,
) {
    let source = attribute_source();
    let language = detect_language(&file_path);

    record_heartbeat(Heartbeat {
        timestamp: Utc::now().to_rfc3339(),
        workspace_path,
        file_path: Some(file_path),
        language,
        source,
        event_type: EventType::FileEdit,
        lines_added,
        lines_removed,
        metadata_json: None,
    });
}

/// Run cleanup of old data. Called on init and periodically.
pub fn cleanup_old_data() {
    let conn = match get_connection() {
        Ok(conn) => conn,
        Err(_) => return,
    };

    let heartbeat_cutoff = Utc::now()
        .naive_utc()
        .checked_sub_signed(chrono::Duration::days(HEARTBEAT_RETENTION_DAYS))
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string());

    let session_cutoff = Utc::now()
        .naive_utc()
        .checked_sub_signed(chrono::Duration::days(SESSION_RETENTION_DAYS))
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string());

    if let Some(cutoff) = heartbeat_cutoff {
        conn.execute(
            "DELETE FROM coding_heartbeats WHERE timestamp < ?1",
            params![cutoff],
        )
        .ok();
    }

    if let Some(cutoff) = session_cutoff {
        conn.execute(
            "DELETE FROM coding_sessions WHERE start_time < ?1",
            params![cutoff],
        )
        .ok();
    }
}

// ============================================
// Internal Helpers
// ============================================

fn attribute_source() -> ActivitySource {
    let ides = ide_detector::scan_ides();

    if ides.is_empty() {
        return ActivitySource::OrgiiEditor;
    }

    // If exactly one IDE and it's Orgii-related, attribute to Orgii
    if ides.len() == 1 {
        return ides[0].source;
    }

    // If an external IDE is frontmost, attribute to it
    if let Some(frontmost) = ides.iter().find(|ide| ide.is_frontmost) {
        return frontmost.source;
    }

    ActivitySource::Unknown
}

struct SessionDecision {
    create_new: bool,
    existing_id: Option<i64>,
    close_prev_id: Option<i64>,
    close_prev_end: Option<String>,
}

fn prepare_session_decision(state: &CollectorState, heartbeat: &Heartbeat) -> SessionDecision {
    let needs_new = match &state.last_heartbeat_time {
        None => true,
        Some(last_time) => {
            let last = NaiveDateTime::parse_from_str(
                last_time.trim_end_matches('Z'),
                "%Y-%m-%dT%H:%M:%S%.f",
            )
            .or_else(|_| NaiveDateTime::parse_from_str(last_time, "%Y-%m-%dT%H:%M:%S%:z"));

            match last {
                Ok(last_dt) => {
                    let current = NaiveDateTime::parse_from_str(
                        heartbeat.timestamp.trim_end_matches('Z'),
                        "%Y-%m-%dT%H:%M:%S%.f",
                    )
                    .or_else(|_| {
                        NaiveDateTime::parse_from_str(&heartbeat.timestamp, "%Y-%m-%dT%H:%M:%S%:z")
                    });

                    match current {
                        Ok(curr_dt) => {
                            curr_dt.signed_duration_since(last_dt).num_seconds() > SESSION_GAP_SECS
                        }
                        Err(_) => true,
                    }
                }
                Err(_) => true,
            }
        }
    };

    if needs_new {
        SessionDecision {
            create_new: true,
            existing_id: None,
            close_prev_id: state.current_session_id,
            close_prev_end: state.last_heartbeat_time.clone(),
        }
    } else {
        SessionDecision {
            create_new: false,
            existing_id: state.current_session_id,
            close_prev_id: None,
            close_prev_end: None,
        }
    }
}

fn insert_heartbeat(heartbeat: &Heartbeat) -> Result<(), String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    conn.execute(
        "INSERT INTO coding_heartbeats (timestamp, workspace_path, file_path, language, source, event_type, lines_added, lines_removed, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            heartbeat.timestamp,
            heartbeat.workspace_path,
            heartbeat.file_path,
            heartbeat.language,
            heartbeat.source.to_string(),
            heartbeat.event_type.to_string(),
            heartbeat.lines_added,
            heartbeat.lines_removed,
            heartbeat.metadata_json,
        ],
    )
    .map_err(|err| format!("Insert failed: {}", err))?;
    Ok(())
}

fn create_session(
    start_time: &str,
    source: &ActivitySource,
    workspace_path: Option<&str>,
) -> Option<i64> {
    let conn = get_connection().ok()?;
    conn.execute(
        "INSERT INTO coding_sessions (start_time, workspace_path, source, duration_seconds, heartbeat_count)
         VALUES (?1, ?2, ?3, 0, 1)",
        params![start_time, workspace_path, source.to_string()],
    )
    .ok()?;
    Some(conn.last_insert_rowid())
}

fn close_session(session_id: i64, end_time: Option<&str>) {
    let conn = match get_connection() {
        Ok(conn) => conn,
        Err(_) => return,
    };

    let end = end_time.unwrap_or("");
    if end.is_empty() {
        return;
    }

    conn.execute(
        "UPDATE coding_sessions
         SET end_time = ?1,
             duration_seconds = CAST(
                 (julianday(?1) - julianday(start_time)) * 86400 AS INTEGER
             )
         WHERE id = ?2 AND end_time IS NULL",
        params![end, session_id],
    )
    .ok();
}

fn update_session_heartbeat_count(session_id: i64) {
    let conn = match get_connection() {
        Ok(conn) => conn,
        Err(_) => return,
    };
    conn.execute(
        "UPDATE coding_sessions SET heartbeat_count = heartbeat_count + 1 WHERE id = ?1",
        params![session_id],
    )
    .ok();
}

// ============================================
// Language Detection
// ============================================

/// Detect programming language from file extension.
pub fn detect_language(file_path: &str) -> Option<String> {
    let ext = file_path.rsplit('.').next()?.to_lowercase();
    let lang = match ext.as_str() {
        "rs" => "Rust",
        "ts" | "mts" | "cts" => "TypeScript",
        "tsx" => "TypeScript React",
        "js" | "mjs" | "cjs" => "JavaScript",
        "jsx" => "JavaScript React",
        "py" | "pyw" => "Python",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "c" => "C",
        "cpp" | "cc" | "cxx" => "C++",
        "h" | "hpp" => "C/C++ Header",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "lua" => "Lua",
        "r" => "R",
        "scala" => "Scala",
        "dart" => "Dart",
        "zig" => "Zig",
        "ex" | "exs" => "Elixir",
        "erl" => "Erlang",
        "hs" => "Haskell",
        "ml" | "mli" => "OCaml",
        "clj" | "cljs" => "Clojure",
        "sql" => "SQL",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "SCSS",
        "less" => "Less",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "xml" => "XML",
        "md" | "mdx" => "Markdown",
        "sh" | "bash" | "zsh" => "Shell",
        "ps1" => "PowerShell",
        "dockerfile" => "Dockerfile",
        "tf" | "hcl" => "Terraform",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "astro" => "Astro",
        "graphql" | "gql" => "GraphQL",
        "proto" => "Protocol Buffers",
        "wasm" => "WebAssembly",
        _ => return None,
    };
    Some(lang.to_string())
}
