//! Tauri Commands for Dev Record
//!
//! Exposes dev activity data to the frontend via Tauri's invoke system.
//! All commands are `async` so they run on Tauri's thread pool
//! instead of blocking the main (WebView) thread.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::claude_code::db as claude_code_db;
use super::claude_code::db::ClaudeCodeSession;
use super::claude_code::history as claude_code_history;
use super::cli_session_db::{self, CliSession};
use super::codex::app as codex_app;
use super::collector;
use super::cursor::db as cursor_db;
use super::cursor::db::CursorSession;
use super::cursor::history as cursor_db_history;
use super::heartbeat_import;
use super::ide_detector;
use super::queries;
use super::types::{
    CodingSession, DailySummary, DetectedIde, FileHotspot, HeatmapCell, IdeUsageStat, LanguageStat,
    StreakInfo,
};
use super::windsurf::history as windsurf_history;

fn imported_recent_paths() -> Result<Vec<super::imported_history::ImportedHistoryRecentPath>, String>
{
    let mut paths = codex_app::list_codex_app_recent_paths(0)?;
    paths.extend(claude_code_history::list_claude_code_recent_paths(0)?);
    Ok(super::imported_history::recent_paths_from_paths(&paths))
}

#[tauri::command]
pub async fn dev_record_get_summary(
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySummary>, String> {
    tokio::task::spawn_blocking(move || queries::get_daily_summaries(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_language_stats(
    start_date: String,
    end_date: String,
) -> Result<Vec<LanguageStat>, String> {
    tokio::task::spawn_blocking(move || queries::get_language_distribution(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_heatmap(
    start_date: String,
    end_date: String,
) -> Result<Vec<HeatmapCell>, String> {
    tokio::task::spawn_blocking(move || queries::get_hourly_heatmap(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_ide_usage(
    start_date: String,
    end_date: String,
) -> Result<Vec<IdeUsageStat>, String> {
    tokio::task::spawn_blocking(move || queries::get_ide_distribution(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_streaks() -> Result<StreakInfo, String> {
    tokio::task::spawn_blocking(queries::get_coding_streaks)
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_active_ides() -> Result<Vec<DetectedIde>, String> {
    tokio::task::spawn_blocking(|| Ok(ide_detector::scan_ides()))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_sessions(
    start_date: String,
    end_date: String,
) -> Result<Vec<CodingSession>, String> {
    tokio::task::spawn_blocking(move || queries::get_sessions(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_session_count(
    start_date: String,
    end_date: String,
) -> Result<i64, String> {
    tokio::task::spawn_blocking(move || queries::get_session_count(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_cursor_sessions(
    start_date: String,
    end_date: String,
) -> Result<Vec<CursorSession>, String> {
    tokio::task::spawn_blocking(move || cursor_db::get_cursor_sessions(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

/// Read all bubbles for one Cursor IDE composer and normalize them into the
/// canonical [`core_types::activity::ActivityChunk`] shape. The frontend's
/// `cursorIdeAdapter` invokes this and pipes the result through
/// `processChunksRust`, so Cursor IDE history renders through the same
/// ChatHistory pipeline as any other session.
///
/// Read-only — never writes to Cursor's `state.vscdb`.
#[tauri::command]
pub async fn cursor_ide_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || cursor_db_history::load_history_for_session(&session_id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn cursor_ide_initial_window(
    session_id: String,
    recent_limit: Option<usize>,
) -> Result<cursor_db_history::CursorIdeInitialWindow, String> {
    tokio::task::spawn_blocking(move || {
        cursor_db_history::load_initial_window_for_session(&session_id, recent_limit)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn cursor_ide_full_refresh(
    session_id: String,
) -> Result<cursor_db_history::CursorIdeFullRefresh, String> {
    tokio::task::spawn_blocking(move || {
        cursor_db_history::load_full_refresh_for_session(&session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn cursor_ide_turn_window(
    session_id: String,
    user_bubble_id: String,
) -> Result<cursor_db_history::CursorIdeTurnWindow, String> {
    tokio::task::spawn_blocking(move || {
        cursor_db_history::load_turn_window_for_session(&session_id, &user_bubble_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Paginated Cursor IDE composer list, sourced from the shared
/// `cursor_session_cache` table (subagent-filtered, delta-synced from
/// Cursor's `state.vscdb`).
///
/// `limit` defaults to 200 (covers the previous "everything" behaviour for
/// typical users while bounding the worst case for power users), `offset`
/// defaults to 0. The response includes a `hasMore` flag so the sidebar
/// knows whether to render a "Load more" row for this category.
#[tauri::command]
pub async fn cursor_ide_list_sessions(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<cursor_db_history::CursorIdeSessionPage, String> {
    let limit = limit.unwrap_or(200);
    let offset = offset.unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        cursor_db_history::list_cursor_ide_sessions_paginated(limit, offset)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn codex_app_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || codex_app::load_codex_app_for_session(&session_id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn codex_app_list_sessions(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<codex_app::CodexAppSessionPage, String> {
    let limit = limit.unwrap_or(200);
    let offset = offset.unwrap_or(0);
    tokio::task::spawn_blocking(move || codex_app::list_codex_app_sessions_paginated(limit, offset))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn codex_app_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<codex_app::CodexAppRecentPath>, String> {
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || codex_app::list_codex_app_recent_paths(limit))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn external_history_auto_import_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<git::repos::repo_db::RepoRecord>, String> {
    let limit = super::imported_history::effective_limit(limit.unwrap_or(20));
    let paths = tokio::task::spawn_blocking(imported_recent_paths)
        .await
        .map_err(|err| format!("Task join error: {}", err))??;

    let mut imported = Vec::new();
    for recent_path in paths.into_iter().take(limit) {
        if !Path::new(&recent_path.path).is_dir() {
            continue;
        }
        imported.push(git::repos::repo_service::import_auto(recent_path.path, None).await?);
    }

    Ok(imported)
}

#[tauri::command]
pub async fn claude_code_history_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        claude_code_history::load_claude_code_history_for_session(&session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn claude_code_history_list_sessions(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<claude_code_history::ClaudeCodeHistorySessionPage, String> {
    let limit = limit.unwrap_or(200);
    let offset = offset.unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        claude_code_history::list_claude_code_history_sessions_paginated(limit, offset)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn claude_code_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<claude_code_history::ClaudeCodeRecentPath>, String> {
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || claude_code_history::list_claude_code_recent_paths(limit))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn windsurf_history_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        windsurf_history::load_windsurf_history_for_session(&session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn windsurf_history_list_sessions(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<windsurf_history::WindsurfHistorySessionPage, String> {
    let limit = limit.unwrap_or(200);
    let offset = offset.unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        windsurf_history::list_windsurf_history_sessions_paginated(limit, offset)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_claude_sessions(
    start_date: String,
    end_date: String,
) -> Result<Vec<ClaudeCodeSession>, String> {
    tokio::task::spawn_blocking(move || claude_code_db::get_claude_sessions(&start_date, &end_date))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_file_hotspots(
    start_date: String,
    end_date: String,
    limit: Option<i64>,
) -> Result<Vec<FileHotspot>, String> {
    let max = limit.unwrap_or(50);
    tokio::task::spawn_blocking(move || {
        let rows = queries::get_file_hotspots_with_workspace(&start_date, &end_date, max)?;
        enrich_with_commit_counts(rows, &start_date, &end_date)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Count commits per file by running `git log --name-only` on each repo,
/// then merge counts into the hotspot results.
fn enrich_with_commit_counts(
    rows: Vec<(FileHotspot, Option<String>)>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<FileHotspot>, String> {
    let repo_map = build_repo_path_map();

    let mut repo_files: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, (_hotspot, repo)) in rows.iter().enumerate() {
        if let Some(repo_id) = repo {
            repo_files.entry(repo_id.clone()).or_default().push(index);
        }
    }

    let mut commit_counts: HashMap<String, i64> = HashMap::new();

    for repo_id in repo_files.keys() {
        if let Some(repo_path) = repo_map.get(repo_id) {
            if let Ok(counts) = count_commits_per_file(repo_path, start_date, end_date) {
                for (file, count) in counts {
                    commit_counts.insert(format!("{repo_id}:{file}"), count);
                }
            }
        }
    }

    let results = rows
        .into_iter()
        .map(|(mut hotspot, repo)| {
            if let Some(repo_id) = &repo {
                let key = format!("{repo_id}:{}", hotspot.file_path);
                if let Some(&count) = commit_counts.get(&key) {
                    hotspot.commit_count = count;
                }
            }
            hotspot
        })
        .collect();

    Ok(results)
}

fn build_repo_path_map() -> HashMap<String, String> {
    match git::repos::repo_db::list_repos() {
        Ok(repos) => repos
            .into_iter()
            .map(|repo| (repo.repo_id, repo.path))
            .collect(),
        Err(_) => HashMap::new(),
    }
}

/// Run `git log --name-only` for a date range and count how many
/// distinct commits each file appears in.
fn count_commits_per_file(
    repo_path: &str,
    start_date: &str,
    end_date: &str,
) -> Result<HashMap<String, i64>, String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let output = git::util::run_git(
        path,
        &[
            "log",
            "--format=%H",
            "--name-only",
            "--no-merges",
            &format!("--after={start_date}"),
            &format!("--before={end_date}T23:59:59"),
            "-500",
        ],
    )?;

    if !output.status.success() {
        return Ok(HashMap::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut file_commits: HashMap<String, HashSet<String>> = HashMap::new();
    let mut current_sha: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            current_sha = None;
            continue;
        }
        if trimmed.len() == 40 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
            current_sha = Some(trimmed.to_string());
        } else if let Some(ref sha) = current_sha {
            file_commits
                .entry(trimmed.to_string())
                .or_default()
                .insert(sha.clone());
        }
    }

    Ok(file_commits
        .into_iter()
        .map(|(file, shas)| (file, shas.len() as i64))
        .collect())
}

#[tauri::command]
pub async fn dev_record_cleanup(days_to_keep: Option<u32>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let _days = days_to_keep.unwrap_or(90);
        collector::cleanup_old_data();
        Ok("Cleanup completed".to_string())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_import_heartbeats() -> Result<u64, String> {
    tokio::task::spawn_blocking(heartbeat_import::scan_all)
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn dev_record_get_cli_sessions(
    tool: Option<String>,
    start_date: String,
    end_date: String,
) -> Result<Vec<CliSession>, String> {
    tokio::task::spawn_blocking(move || {
        cli_session_db::get_cli_sessions(tool.as_deref(), &start_date, &end_date)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}
