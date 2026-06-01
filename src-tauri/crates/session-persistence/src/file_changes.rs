//! File-change tracking derived from session event log
//!
//! Scans persisted tool-call events for file-write operations
//! (`write_file`, `apply_patch`, etc.) and builds a deduplicated
//! `HashMap<path, Vec<ChangeRecord>>` used by the frontend to show
//! which files an agent modified in a session.

use rusqlite::Result as SqliteResult;
use std::collections::{HashMap, HashSet};

use agent_core::tools::names as tool_names;

use super::connection::get_connection;
use super::types::{FileChangeInfo, FileChangesResult, FileChangesStats};

const FILE_DIFF_EVENT_FUNCTION_NAME: &str = "file_diff";
const FILE_EDIT_FUNCTION_NAMES: &[&str] = &[
    tool_names::EDIT_FILE,
    tool_names::APPLY_PATCH,
    tool_names::STORAGE_WRITE_FILE,
    tool_names::STORAGE_CREATE_FILE,
    tool_names::STORAGE_EDIT_FILE_BY_REPLACE,
    tool_names::STORAGE_APPEND_FILE,
    tool_names::STORAGE_FILE_RANGE_EDIT,
    tool_names::STORAGE_INSERT_CONTENT_AT_LINE,
    FILE_DIFF_EVENT_FUNCTION_NAME,
];

fn count_lines(text: &str) -> i64 {
    if text.is_empty() {
        return 0;
    }
    text.split('\n').count() as i64
}

/// Helper: aggregate a (function_name, args_json, result_json) row into the file map.
pub fn aggregate_file_change(
    file_map: &mut HashMap<String, FileChangeInfo>,
    function_name: &str,
    args_json: &str,
    result_json: &str,
) {
    // The two JSON columns originated from `serde_json::Value` writes,
    // so a parse failure here means DB corruption or schema drift. We
    // still default to `Null` so the file-change aggregation pipeline
    // doesn't fail the whole session load on one corrupt row, but a
    // warn surfaces the issue in logs instead of silently dropping the
    // file from the per-session "files changed" list.
    let args: serde_json::Value = match serde_json::from_str(args_json) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                "[file_changes] failed to parse args_json for function {:?}: {} (raw: {:?})",
                function_name,
                err,
                args_json
            );
            serde_json::Value::Null
        }
    };
    let result: serde_json::Value = match serde_json::from_str(result_json) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                "[file_changes] failed to parse result_json for function {:?}: {} (raw: {:?})",
                function_name,
                err,
                result_json
            );
            serde_json::Value::Null
        }
    };

    // apply_patch: extract file paths from the patch text itself
    if function_name == tool_names::APPLY_PATCH {
        if let Some(patch_text) = args.get("patch_text").and_then(|v| v.as_str()) {
            for line in patch_text.lines() {
                let trimmed = line.trim();
                let (path, status) = if let Some(p) = trimmed.strip_prefix("*** Add File:") {
                    (p.trim(), "A")
                } else if let Some(p) = trimmed.strip_prefix("*** Update File:") {
                    (p.trim(), "M")
                } else if let Some(p) = trimmed.strip_prefix("*** Delete File:") {
                    (p.trim(), "D")
                } else {
                    continue;
                };
                if path.is_empty() {
                    continue;
                }
                let file_name = path.rsplit('/').next().unwrap_or(path).to_string();
                let entry = file_map
                    .entry(path.to_string())
                    .or_insert_with(|| FileChangeInfo {
                        path: path.to_string(),
                        file_name,
                        status: status.to_string(),
                        additions: 0,
                        deletions: 0,
                        line_count: 0,
                    });
                entry.status = status.to_string();
            }
        }
        return;
    }

    let success = result.get("success").unwrap_or(&serde_json::Value::Null);
    let path = args
        .get("file_path")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("file_name").and_then(|v| v.as_str()))
        .or_else(|| args.get("path").and_then(|v| v.as_str()))
        .or_else(|| result.get("file_path").and_then(|v| v.as_str()))
        .or_else(|| result.get("path").and_then(|v| v.as_str()))
        .or_else(|| success.get("file_path").and_then(|v| v.as_str()))
        .or_else(|| success.get("path").and_then(|v| v.as_str()));

    let path = match path {
        Some(p) => p.to_string(),
        None => return,
    };

    let file_name = path.rsplit('/').next().unwrap_or(&path).to_string();

    // Compute additions/deletions from the best available source:
    // 1. result.lines_added / lines_removed (CLI agent structured result)
    // 2. result.old_copy / new_copy (if result is an object with these fields)
    // 3. args fields: new_string/content vs old_string (SDE Agent tools)
    let (additions, deletions) = if let (Some(add), Some(del)) = (
        result
            .get("lines_added")
            .or_else(|| result.get("linesAdded"))
            .or_else(|| success.get("lines_added"))
            .or_else(|| success.get("linesAdded"))
            .and_then(|v| v.as_i64()),
        result
            .get("lines_removed")
            .or_else(|| result.get("linesRemoved"))
            .or_else(|| success.get("lines_removed"))
            .or_else(|| success.get("linesRemoved"))
            .and_then(|v| v.as_i64()),
    ) {
        (add.max(0), del.max(0))
    } else if result.is_object()
        && (result.get("old_copy").is_some() || result.get("new_copy").is_some())
    {
        let old_copy = result
            .get("old_copy")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let new_copy = result
            .get("new_copy")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let old_lines = count_lines(old_copy);
        let new_lines = count_lines(new_copy);
        (
            (new_lines - old_lines).max(0),
            (old_lines - new_lines).max(0),
        )
    } else {
        // Generic fallback: inspect all known args field names
        let new_text = args
            .get("new_string")
            .and_then(|v| v.as_str())
            .or_else(|| args.get("content").and_then(|v| v.as_str()))
            .or_else(|| args.get("new_content").and_then(|v| v.as_str()))
            .or_else(|| args.get("insert_text").and_then(|v| v.as_str()))
            .or_else(|| args.get("file_text").and_then(|v| v.as_str()))
            .unwrap_or("");
        let old_text = args
            .get("old_string")
            .and_then(|v| v.as_str())
            .or_else(|| args.get("old_content").and_then(|v| v.as_str()))
            .unwrap_or("");
        let new_lines = count_lines(new_text);
        let old_lines = count_lines(old_text);
        (
            (new_lines - old_lines).max(0),
            (old_lines - new_lines).max(0),
        )
    };

    let has_old = args
        .get("old_string")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
        || result
            .get("old_copy")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty());
    let status = if function_name == tool_names::STORAGE_CREATE_FILE
        || function_name == tool_names::STORAGE_WRITE_FILE
        || !has_old
    {
        "A"
    } else {
        "M"
    };

    let entry = file_map
        .entry(path.clone())
        .or_insert_with(|| FileChangeInfo {
            path: path.clone(),
            file_name,
            status: status.to_string(),
            additions: 0,
            deletions: 0,
            line_count: 0,
        });
    entry.additions += additions;
    entry.deletions += deletions;
    if entry.status != "A" {
        entry.status = status.to_string();
    }
}

/// Compute file changes from session events in SQLite.
/// Queries both `events` (SDE Agent) and `code_session_chunks` (CLI agents).
pub fn get_file_changes(session_id: &str) -> SqliteResult<FileChangesResult> {
    let conn = get_connection()?;
    let mut file_map: HashMap<String, FileChangeInfo> = HashMap::new();

    // ── Source 1: events table (SDE Agent sessions) ──
    {
        let placeholders: Vec<String> = FILE_EDIT_FUNCTION_NAMES
            .iter()
            .enumerate()
            .map(|(idx, _)| format!("?{}", idx + 2))
            .collect();
        let in_clause = placeholders.join(", ");

        let sql = format!(
            "SELECT function_name, args_json, result_json
             FROM events
             WHERE session_id = ?1 AND function_name IN ({})
             ORDER BY COALESCE(history_sequence, 0) ASC, created_at ASC",
            in_clause
        );

        let mut stmt = conn.prepare(&sql)?;

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        param_values.push(Box::new(session_id.to_string()));
        for name in FILE_EDIT_FUNCTION_NAMES {
            param_values.push(Box::new(name.to_string()));
        }
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        // Silently dropping a row whose `args_json`/`result_json` failed
        // to read would make a corrupt event vanish from the
        // per-session "files changed" UI list while the event itself
        // stays in the DB. Surface the error so the file-change
        // aggregation can't silently under-report changes.
        let rows: Vec<(String, String, String)> = stmt
            .query_map(params_ref.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        for (function_name, args_json, result_json) in &rows {
            aggregate_file_change(&mut file_map, function_name, args_json, result_json);
        }
    }

    // ── Source 2: code_session_chunks table (CLI agent sessions) ──
    // CLI agents store the normalized tool type in `function` (e.g. "Edit", "Shell").
    // All CLI agent parsers normalize file-editing tools to "Edit", but we also
    // match "Write" and "Patch" defensively in case normalization changes.
    {
        let mut stmt = conn.prepare(
            "SELECT function, args_json, result_json
             FROM code_session_chunks
             WHERE session_id = ?1 AND function IN ('Edit', 'Write', 'Patch', 'Create')
             ORDER BY sequence ASC",
        )?;

        // Same fail-loud principle as the events branch above: dropping
        // a row whose JSON columns fail to read would silently
        // under-report file changes for CLI-agent sessions.
        let rows: Vec<(String, String, String)> = stmt
            .query_map([session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        for (function, args_json, result_json) in &rows {
            aggregate_file_change(&mut file_map, function, args_json, result_json);
        }
    }

    let mut files: Vec<FileChangeInfo> = file_map.into_values().collect();

    // Read actual line counts from disk
    for file in &mut files {
        if file.status != "D" {
            if let Ok(content) = std::fs::read_to_string(&file.path) {
                file.line_count = content.lines().count() as i64;
            }
        }
    }

    // Override additions/deletions using the per-session file-history
    // numstat: earliest captured bytes vs. live on-disk bytes, diffed
    // per file.
    let mut numstat_applied: HashSet<String> = HashSet::new();
    let workspace_path_opt =
        agent_core::persistence::session_snapshots::get_session_workspace_path(session_id)
            .ok()
            .flatten();
    if let Ok(numstat) = agent_core::tools::file_history::session_numstat(session_id) {
        let abs_stats: HashMap<String, (u64, u64)> = numstat.into_iter().collect();
        if files.is_empty() {
            files.extend(abs_stats.iter().map(|(path, (add, del))| {
                let file_name = std::path::Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(path)
                    .to_string();
                let line_count = std::fs::read_to_string(path)
                    .map(|content| content.lines().count() as i64)
                    .unwrap_or(0);
                FileChangeInfo {
                    path: path.clone(),
                    file_name,
                    status: if *del == 0 { "A" } else { "M" }.to_string(),
                    additions: *add as i64,
                    deletions: *del as i64,
                    line_count,
                }
            }));
            numstat_applied.extend(abs_stats.keys().cloned());
        }
        for file in &mut files {
            let abs_candidate = if std::path::Path::new(&file.path).is_absolute() {
                file.path.clone()
            } else if let Some(ref project) = workspace_path_opt {
                std::path::Path::new(project)
                    .join(&file.path)
                    .to_string_lossy()
                    .to_string()
            } else {
                file.path.clone()
            };
            if let Some(&(add, del)) = abs_stats.get(&abs_candidate) {
                file.additions = add as i64;
                file.deletions = del as i64;
                numstat_applied.insert(file.path.clone());
            } else if let Some(&(add, del)) = abs_stats.get(&file.path) {
                file.additions = add as i64;
                file.deletions = del as i64;
                numstat_applied.insert(file.path.clone());
            }
        }
    }

    // Fallback 1: for "A"/"D" files not matched by numstat, use line_count
    for file in &mut files {
        if numstat_applied.contains(&file.path) {
            continue;
        }
        match file.status.as_str() {
            "A" => {
                file.additions = file.line_count;
                file.deletions = 0;
            }
            "D" => {
                file.additions = 0;
            }
            _ => {}
        }
    }

    // Fallback 2: for "M" files not matched by shadow-git numstat,
    // try the project's own git repo (`git diff HEAD --numstat`)
    let unresolved_m: Vec<String> = files
        .iter()
        .filter(|f| !numstat_applied.contains(&f.path) && f.status == "M")
        .map(|f| f.path.clone())
        .collect();

    if !unresolved_m.is_empty() {
        if let Some(first_dir) = std::path::Path::new(&unresolved_m[0]).parent() {
            if let Ok(top_output) = git::git_command().and_then(|mut command| {
                command
                    .args(["rev-parse", "--show-toplevel"])
                    .current_dir(first_dir)
                    .output()
                    .map_err(|err| err.to_string())
            }) {
                if top_output.status.success() {
                    let workspace_root = String::from_utf8_lossy(&top_output.stdout)
                        .trim()
                        .to_string();
                    if let Ok(diff_output) = git::git_command().and_then(|mut command| {
                        command
                            .args([
                                "-c",
                                "core.quotepath=false",
                                "diff",
                                "HEAD",
                                "--no-ext-diff",
                                "--numstat",
                            ])
                            .current_dir(&workspace_root)
                            .output()
                            .map_err(|err| err.to_string())
                    }) {
                        if diff_output.status.success() {
                            let workspace_root_path = std::path::Path::new(&workspace_root);
                            let git_stat: HashMap<String, (i64, i64)> =
                                String::from_utf8_lossy(&diff_output.stdout)
                                    .lines()
                                    .filter_map(|line| {
                                        let parts: Vec<&str> = line.split('\t').collect();
                                        if parts.len() < 3 {
                                            return None;
                                        }
                                        let add = parts[0].parse::<i64>().unwrap_or(0);
                                        let del = parts[1].parse::<i64>().unwrap_or(0);
                                        let abs = workspace_root_path
                                            .join(parts[2])
                                            .to_string_lossy()
                                            .to_string();
                                        Some((abs, (add, del)))
                                    })
                                    .collect();

                            for file in &mut files {
                                if !unresolved_m.contains(&file.path) {
                                    continue;
                                }
                                if let Some(&(add, del)) = git_stat.get(&file.path) {
                                    file.additions = add;
                                    file.deletions = del;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Remove files with no effective changes (e.g. discarded by user)
    files.retain(|f| {
        if f.additions == 0 && f.deletions == 0 && f.status == "M" {
            return false;
        }
        if f.status == "A" && !std::path::Path::new(&f.path).exists() {
            return false;
        }
        true
    });

    let total_additions: i64 = files.iter().map(|f| f.additions).sum();
    let total_deletions: i64 = files.iter().map(|f| f.deletions).sum();

    let mut added = 0i64;
    let mut modified = 0i64;
    let mut deleted = 0i64;
    for f in &files {
        match f.status.as_str() {
            "A" => added += 1,
            "D" => deleted += 1,
            _ => modified += 1,
        }
    }

    Ok(FileChangesResult {
        files,
        total_additions,
        total_deletions,
        stats: FileChangesStats {
            added,
            modified,
            deleted,
        },
    })
}
