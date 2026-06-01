//! IDE Attribution
//!
//! Scans IDE-specific databases and artifacts to determine which IDEs were
//! active during an offline gap. Used by the retroactive backfill to attribute
//! commits to the correct editor.
//!
//! Supported IDEs:
//! - VS Code / Cursor / Trae / Windsurf: workspace storage state.vscdb mtime
//! - JetBrains: recentProjects.xml projectOpenTimestamp
//! - Vim/Neovim: .viminfo / shada mtime
//! - Sublime, Zed, Xcode, Emacs: session file mtime
//! - AI CLIs (Claude Code, Codex): history.jsonl mtime

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::types::ActivitySource;

// ============================================
// Types
// ============================================

#[derive(Debug, Clone)]
pub struct IdeActivityWindow {
    pub source: ActivitySource,
    /// ISO8601 timestamp of when the IDE was last active
    pub last_active: String,
    /// Repo/workspace path this activity is associated with (if determinable)
    pub workspace_path: Option<String>,
}

// ============================================
// Public API
// ============================================

/// Scan all known IDE artifacts to find which IDEs were active after `gap_start`.
/// Returns activity windows for IDEs that show evidence of use during the gap.
pub fn scan_ide_activity(gap_start: &str) -> Vec<IdeActivityWindow> {
    let mut results = Vec::new();

    let home = match dirs::home_dir() {
        Some(home) => home,
        None => return results,
    };

    let gap_start_ts = match parse_timestamp(gap_start) {
        Some(ts) => ts,
        None => return results,
    };

    scan_vscode_cursor(&home, gap_start_ts, &mut results);
    scan_jetbrains(&home, gap_start_ts, &mut results);
    scan_vim(&home, gap_start_ts, &mut results);
    scan_mtime_based_ides(&home, gap_start_ts, &mut results);
    scan_ai_cli_artifacts(&home, gap_start_ts, &mut results);

    results
}

/// Determine which IDE was most likely responsible for a commit at the given
/// timestamp, based on collected IDE activity windows and the commit's repo path.
pub fn attribute_commit(
    commit_timestamp: &str,
    repo_path: &str,
    ide_windows: &[IdeActivityWindow],
) -> ActivitySource {
    let commit_ts = match parse_timestamp(commit_timestamp) {
        Some(ts) => ts,
        None => return ActivitySource::Unknown,
    };

    // Find IDEs that were active at or after the gap start (and thus during the gap)
    // Prefer ones that match the workspace path
    let mut candidates: Vec<&IdeActivityWindow> = ide_windows
        .iter()
        .filter(|window| {
            let window_ts = parse_timestamp(&window.last_active).unwrap_or(0);
            window_ts >= commit_ts - 3600 // Active within 1 hour of the commit
        })
        .collect();

    if candidates.is_empty() {
        // Fall back to currently running IDEs
        let running = super::ide_detector::scan_ides();
        return match running.len() {
            0 => ActivitySource::Unknown,
            1 => running[0].source,
            _ => running
                .iter()
                .find(|ide| ide.is_frontmost)
                .map(|ide| ide.source)
                .unwrap_or(ActivitySource::Unknown),
        };
    }

    // Prefer workspace-matching candidate
    if let Some(matched) = candidates.iter().find(|window| {
        window
            .workspace_path
            .as_ref()
            .is_some_and(|wp| repo_path.starts_with(wp) || wp.starts_with(repo_path))
    }) {
        return matched.source;
    }

    // Sort by most recently active
    candidates.sort_by(|lhs, rhs| {
        let lhs_ts = parse_timestamp(&lhs.last_active).unwrap_or(0);
        let rhs_ts = parse_timestamp(&rhs.last_active).unwrap_or(0);
        rhs_ts.cmp(&lhs_ts)
    });

    candidates[0].source
}

// ============================================
// VS Code / Cursor Scanner
// ============================================

fn scan_vscode_cursor(home: &Path, gap_start_ts: i64, results: &mut Vec<IdeActivityWindow>) {
    let configs = [
        (ActivitySource::VsCode, "Code"),
        (ActivitySource::Cursor, "Cursor"),
        (ActivitySource::Trae, "Trae"),
        (ActivitySource::Windsurf, "Windsurf"),
    ];

    for (source, app_name) in &configs {
        #[cfg(target_os = "macos")]
        let app_support = home
            .join("Library")
            .join("Application Support")
            .join(app_name);
        #[cfg(target_os = "linux")]
        let app_support = home.join(".config").join(app_name);
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let app_support = home.join("AppData").join("Roaming").join(app_name);

        let global_state = app_support
            .join("User")
            .join("globalStorage")
            .join("state.vscdb");

        // Check global state.vscdb mtime
        if let Some(mtime_ts) = file_mtime_epoch(&global_state) {
            if mtime_ts >= gap_start_ts {
                results.push(IdeActivityWindow {
                    source: *source,
                    last_active: epoch_to_iso(mtime_ts),
                    workspace_path: None,
                });
            }
        }

        // Scan workspace storage for per-repo attribution
        let workspace_storage = app_support.join("User").join("workspaceStorage");
        if let Ok(entries) = fs::read_dir(&workspace_storage) {
            for entry in entries.flatten() {
                let ws_dir = entry.path();
                if !ws_dir.is_dir() {
                    continue;
                }

                let ws_state = ws_dir.join("state.vscdb");
                let ws_json = ws_dir.join("workspace.json");

                let ws_mtime = file_mtime_epoch(&ws_state);
                if ws_mtime.is_none_or(|ts| ts < gap_start_ts) {
                    continue;
                }

                // Parse workspace.json to get the folder path
                let folder_path = parse_workspace_json(&ws_json);
                if folder_path.is_some() {
                    results.push(IdeActivityWindow {
                        source: *source,
                        last_active: epoch_to_iso(ws_mtime.unwrap_or(0)),
                        workspace_path: folder_path,
                    });
                }
            }
        }
    }
}

/// Parse workspace.json to extract the folder URI.
/// Format: `{"folder": "file:///Users/.../workspace"}`
fn parse_workspace_json(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    // Simple JSON parsing without serde_json dependency
    let folder_key = "\"folder\"";
    let idx = content.find(folder_key)?;
    let after_key = &content[idx + folder_key.len()..];
    let colon_idx = after_key.find(':')?;
    let after_colon = after_key[colon_idx + 1..].trim_start();
    if !after_colon.starts_with('"') {
        return None;
    }
    let value_start = 1; // skip opening quote
    let value_end = after_colon[value_start..].find('"')?;
    let uri = &after_colon[value_start..value_start + value_end];

    // Convert file:// URI to path
    if let Some(path_str) = uri.strip_prefix("file://") {
        Some(percent_decode(path_str))
    } else {
        Some(uri.to_string())
    }
}

// ============================================
// JetBrains Scanner
// ============================================

fn scan_jetbrains(home: &Path, gap_start_ts: i64, results: &mut Vec<IdeActivityWindow>) {
    #[cfg(target_os = "macos")]
    let jb_base = home
        .join("Library")
        .join("Application Support")
        .join("JetBrains");
    #[cfg(target_os = "linux")]
    let jb_base = home.join(".config").join("JetBrains");
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let jb_base = home.join("AppData").join("Roaming").join("JetBrains");

    if !jb_base.is_dir() {
        return;
    }

    let entries = match fs::read_dir(&jb_base) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let product_dir = entry.path();
        if !product_dir.is_dir() {
            continue;
        }

        let recent_projects = product_dir.join("options").join("recentProjects.xml");

        if !recent_projects.exists() {
            continue;
        }

        let content = match fs::read_to_string(&recent_projects) {
            Ok(content) => content,
            Err(_) => continue,
        };

        // Parse projectOpenTimestamp values from XML
        // Format: <option name="projectOpenTimestamp" value="1709..." />
        parse_jetbrains_timestamps(&content, gap_start_ts, results);
    }
}

fn parse_jetbrains_timestamps(
    xml_content: &str,
    gap_start_ts: i64,
    results: &mut Vec<IdeActivityWindow>,
) {
    // Find <entry key="/path/to/workspace"> blocks
    let gap_start_millis = gap_start_ts * 1000;
    let mut current_path: Option<String> = None;

    for line in xml_content.lines() {
        let trimmed = line.trim();

        // Match: <entry key="/path/to/workspace">
        if trimmed.starts_with("<entry key=\"") {
            if let Some(start) = trimmed.find("key=\"") {
                let after = &trimmed[start + 5..];
                if let Some(end) = after.find('"') {
                    let path = &after[..end];
                    // JetBrains uses $ for substitutions (e.g., $USER_HOME$)
                    if !path.starts_with('$') {
                        current_path = Some(path.to_string());
                    }
                }
            }
        }

        // Match: <option name="projectOpenTimestamp" value="1709..." />
        if trimmed.contains("projectOpenTimestamp") {
            if let Some(val_start) = trimmed.find("value=\"") {
                let after = &trimmed[val_start + 7..];
                if let Some(val_end) = after.find('"') {
                    let ts_str = &after[..val_end];
                    if let Ok(ts_millis) = ts_str.parse::<i64>() {
                        if ts_millis >= gap_start_millis {
                            results.push(IdeActivityWindow {
                                source: ActivitySource::JetBrains,
                                last_active: epoch_to_iso(ts_millis / 1000),
                                workspace_path: current_path.clone(),
                            });
                        }
                    }
                }
            }
        }

        if trimmed == "</entry>" {
            current_path = None;
        }
    }
}

// ============================================
// Vim / Neovim Scanner
// ============================================

fn scan_vim(home: &Path, gap_start_ts: i64, results: &mut Vec<IdeActivityWindow>) {
    // Vim: ~/.viminfo
    let viminfo = home.join(".viminfo");
    if let Some(mtime) = file_mtime_epoch(&viminfo) {
        if mtime >= gap_start_ts {
            // Parse file marks from viminfo for workspace attribution
            let workspace = parse_viminfo_files(&viminfo);
            results.push(IdeActivityWindow {
                source: ActivitySource::Vim,
                last_active: epoch_to_iso(mtime),
                workspace_path: workspace,
            });
        }
    }

    // Neovim: check shada mtime
    let shada_paths = [
        home.join(".local")
            .join("state")
            .join("nvim")
            .join("shada")
            .join("main.shada"),
        home.join(".local")
            .join("share")
            .join("nvim")
            .join("shada")
            .join("main.shada"),
    ];

    for shada_path in &shada_paths {
        if let Some(mtime) = file_mtime_epoch(shada_path) {
            if mtime >= gap_start_ts {
                results.push(IdeActivityWindow {
                    source: ActivitySource::Vim,
                    last_active: epoch_to_iso(mtime),
                    workspace_path: None,
                });
                break;
            }
        }
    }
}

/// Parse viminfo file marks to find the most recently edited file's directory.
fn parse_viminfo_files(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        if let Some(file_path) = line.strip_prefix("> ") {
            let expanded = if file_path.starts_with('~') {
                dirs::home_dir()
                    .map(|home| file_path.replacen('~', &home.to_string_lossy(), 1))
                    .unwrap_or_else(|| file_path.to_string())
            } else {
                file_path.to_string()
            };
            // Return the parent directory as the workspace
            if let Some(parent) = Path::new(&expanded).parent() {
                return Some(parent.to_string_lossy().to_string());
            }
        }
    }
    None
}

// ============================================
// Simple mtime-based IDE scanners
// ============================================

fn scan_mtime_based_ides(home: &Path, gap_start_ts: i64, results: &mut Vec<IdeActivityWindow>) {
    #[cfg(target_os = "macos")]
    let checks: Vec<(ActivitySource, PathBuf)> = vec![
        (
            ActivitySource::Sublime,
            home.join("Library")
                .join("Application Support")
                .join("Sublime Text")
                .join("Local")
                .join("Session.sublime_session"),
        ),
        (
            ActivitySource::Zed,
            home.join("Library")
                .join("Application Support")
                .join("Zed")
                .join("db"),
        ),
        (
            ActivitySource::Xcode,
            home.join("Library")
                .join("Developer")
                .join("Xcode")
                .join("UserData"),
        ),
        (ActivitySource::Emacs, home.join(".emacs.d").join("recentf")),
        (
            ActivitySource::Nova,
            home.join("Library")
                .join("Application Support")
                .join("Nova"),
        ),
        (
            ActivitySource::Fleet,
            home.join("Library")
                .join("Application Support")
                .join("JetBrains")
                .join("Fleet"),
        ),
        (
            ActivitySource::Lapce,
            home.join("Library")
                .join("Application Support")
                .join("dev.lapce.Lapce-Stable"),
        ),
    ];

    #[cfg(not(target_os = "macos"))]
    let checks: Vec<(ActivitySource, PathBuf)> = vec![
        (
            ActivitySource::Sublime,
            home.join(".config")
                .join("sublime-text")
                .join("Local")
                .join("Session.sublime_session"),
        ),
        (ActivitySource::Emacs, home.join(".emacs.d").join("recentf")),
        (
            ActivitySource::Lapce,
            home.join(".config").join("lapce-stable"),
        ),
    ];

    for (source, path) in &checks {
        // Skip IDEs whose data dirs exist but the app isn't actually installed
        if !is_ide_installed(*source) {
            continue;
        }
        if let Some(mtime) = file_mtime_epoch(path) {
            if mtime >= gap_start_ts {
                results.push(IdeActivityWindow {
                    source: *source,
                    last_active: epoch_to_iso(mtime),
                    workspace_path: None,
                });
            }
        }
    }
}

/// Verify the IDE is actually installed by checking for the app binary/bundle.
fn is_ide_installed(source: ActivitySource) -> bool {
    #[cfg(target_os = "macos")]
    {
        let app_path = match source {
            ActivitySource::Sublime => "/Applications/Sublime Text.app",
            ActivitySource::Zed => "/Applications/Zed.app",
            ActivitySource::Xcode => "/Applications/Xcode.app",
            ActivitySource::Emacs => "/Applications/Emacs.app",
            ActivitySource::Nova => "/Applications/Nova.app",
            ActivitySource::Fleet => "/Applications/Fleet.app",
            ActivitySource::Lapce => "/Applications/Lapce.app",
            _ => return true,
        };
        Path::new(app_path).exists()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = source;
        true
    }
}

// ============================================
// AI CLI Artifact Scanner
// ============================================

fn scan_ai_cli_artifacts(home: &Path, gap_start_ts: i64, results: &mut Vec<IdeActivityWindow>) {
    let history_files = [
        home.join(".claude").join("history.jsonl"),
        home.join(".codex").join("history.jsonl"),
    ];

    for history_path in &history_files {
        if let Some(mtime) = file_mtime_epoch(history_path) {
            if mtime >= gap_start_ts {
                results.push(IdeActivityWindow {
                    source: ActivitySource::AiCli,
                    last_active: epoch_to_iso(mtime),
                    workspace_path: None,
                });
                return;
            }
        }
    }
}

// ============================================
// Utility Functions
// ============================================

fn file_mtime_epoch(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let mtime = metadata.modified().ok()?;
    let duration = mtime.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    Some(duration.as_secs() as i64)
}

pub(crate) fn epoch_to_iso(epoch_secs: i64) -> String {
    chrono::DateTime::from_timestamp(epoch_secs, 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
        .unwrap_or_default()
}

fn parse_timestamp(ts: &str) -> Option<i64> {
    // Try RFC3339 first (from heartbeat timestamps)
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return Some(dt.timestamp());
    }
    // Try NaiveDateTime (no timezone)
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.and_utc().timestamp());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(dt.and_utc().timestamp());
    }
    None
}

pub(crate) fn percent_decode(input: &str) -> String {
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

#[cfg(test)]
#[path = "tests/ide_attribution_tests.rs"]
mod tests;
