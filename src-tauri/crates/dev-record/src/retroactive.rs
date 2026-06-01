//! Retroactive Activity Backfill
//!
//! On startup (or when a new repo is registered), scans git history for commits
//! made during the offline gap and creates synthetic heartbeats. Cross-references
//! IDE databases to attribute commits to the correct editor.
//!
//! Flow per repo:
//! 1. Get last heartbeat timestamp from DB
//! 2. Scan IDE databases for activity during the gap
//! 3. Run `git log --since=<gap_start>` for commits
//! 4. Attribute each commit to an IDE using ide_attribution
//! 5. Insert synthetic heartbeats with retroactive flag

use std::path::{Path, PathBuf};

use rusqlite::params;

use super::collector;
use super::ide_attribution;
use super::types::{ActivitySource, EventType, Heartbeat};
use database::db::get_connection;

// ============================================
// Constants
// ============================================

const DEFAULT_LOOKBACK_DAYS: i64 = 7;
const MAX_COMMITS_PER_REPO: usize = 500;
const MAX_FILES_PER_COMMIT: usize = 100;

// ============================================
// Types
// ============================================

#[derive(Debug)]
struct OfflineCommit {
    sha: String,
    timestamp: String,
    files: Vec<CommitFile>,
}

#[derive(Debug)]
struct CommitFile {
    path: String,
    additions: i32,
    deletions: i32,
}

// ============================================
// Public API
// ============================================

/// Backfill offline activity for all registered repos.
/// Should be called after repo hydration, in a background thread.
pub fn backfill_offline_activity() {
    let repos = match get_registered_repos() {
        Ok(repos) => repos,
        Err(err) => {
            eprintln!("[retroactive] Failed to get repos: {}", err);
            return;
        }
    };

    if repos.is_empty() {
        return;
    }

    println!(
        "[retroactive] Scanning {} repo(s) for offline activity...",
        repos.len()
    );

    for (repo_id, repo_path) in &repos {
        if let Err(err) = backfill_repo(repo_id, repo_path) {
            eprintln!("[retroactive] Failed to backfill repo {}: {}", repo_id, err);
        }
    }

    // Clean up old sessions with 'retroactive' as source (legacy bug)
    cleanup_legacy_retroactive_sessions();

    // Create sessions from heartbeats that don't have sessions yet
    backfill_sessions_from_heartbeats();

    println!("[retroactive] Backfill complete");
}

/// Backfill a single repo. Called when a new repo is registered after startup.
pub fn backfill_single_repo(repo_id: &str, repo_path: &Path) {
    if let Err(err) = backfill_repo(repo_id, repo_path) {
        eprintln!("[retroactive] Failed to backfill repo {}: {}", repo_id, err);
    }
}

// ============================================
// Internal Logic
// ============================================

fn backfill_repo(repo_id: &str, repo_path: &Path) -> Result<(), String> {
    let gap_start = get_last_heartbeat_time(repo_id)?;

    let gap_start_str = match &gap_start {
        Some(ts) => ts.clone(),
        None => {
            let default = chrono::Utc::now()
                .checked_sub_signed(chrono::Duration::days(DEFAULT_LOOKBACK_DAYS))
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
                .ok_or("Failed to compute default lookback")?;
            default
        }
    };

    // Scan IDE databases for activity during the gap
    let ide_windows = ide_attribution::scan_ide_activity(&gap_start_str);

    // Scan git log for commits since gap_start
    let commits = scan_commits_since(repo_path, &gap_start_str)?;

    if commits.is_empty() {
        return Ok(());
    }

    let repo_path_str = repo_path.to_string_lossy().to_string();
    let mut inserted = 0usize;

    // Collect per-commit sources for session attribution
    let mut commit_sources: Vec<ActivitySource> = Vec::with_capacity(commits.len());

    for commit in &commits {
        let source =
            ide_attribution::attribute_commit(&commit.timestamp, &repo_path_str, &ide_windows);
        commit_sources.push(source);

        let base_ts = parse_commit_timestamp(&commit.timestamp);

        for (file_idx, file) in commit.files.iter().enumerate() {
            let language = collector::detect_language(&file.path);
            let file_timestamp = match base_ts {
                Some(ts) => {
                    let offset = chrono::Duration::seconds((file_idx as i64) * 120);
                    (ts + offset).format("%Y-%m-%dT%H:%M:%S%:z").to_string()
                }
                None => commit.timestamp.clone(),
            };

            let heartbeat = Heartbeat {
                timestamp: file_timestamp,
                workspace_path: Some(repo_id.to_string()),
                file_path: Some(file.path.clone()),
                language,
                source,
                event_type: EventType::FileEdit,
                lines_added: file.additions,
                lines_removed: file.deletions,
                metadata_json: Some(format!(
                    "{{\"retroactive\":true,\"commit\":\"{sha}\"}}",
                    sha = &commit.sha[..commit.sha.len().min(8)]
                )),
            };

            if let Err(err) = insert_retroactive_heartbeat(&heartbeat) {
                eprintln!("[retroactive] Insert failed: {}", err);
            } else {
                inserted += 1;
            }
        }
    }

    let sessions_created = create_retroactive_sessions(&commits, &commit_sources, repo_id)?;

    if inserted > 0 {
        println!(
            "[retroactive] Backfilled {} heartbeats, {} sessions for {} ({} commits, {} IDE(s))",
            inserted,
            sessions_created,
            repo_id,
            commits.len(),
            ide_windows.len()
        );
    }

    Ok(())
}

fn get_last_heartbeat_time(workspace_path: &str) -> Result<Option<String>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let result: Option<String> = conn
        .query_row(
            "SELECT MAX(timestamp) FROM coding_heartbeats WHERE workspace_path = ?1",
            params![workspace_path],
            |row| row.get(0),
        )
        .map_err(|err| format!("Query failed: {}", err))?;
    Ok(result)
}

/// Insert a heartbeat directly, bypassing the collector's dedup/rate-limiting
/// (retroactive data shouldn't be subject to real-time throttling).
fn insert_retroactive_heartbeat(heartbeat: &Heartbeat) -> Result<(), String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;

    // Check for duplicate: same timestamp + file path + workspace path
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM coding_heartbeats
                WHERE timestamp = ?1 AND file_path = ?2 AND workspace_path = ?3
            )",
            params![
                heartbeat.timestamp,
                heartbeat.file_path,
                heartbeat.workspace_path,
            ],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if exists {
        return Ok(());
    }

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

// ============================================
// Git Log Parsing
// ============================================

fn scan_commits_since(repo_path: &Path, since: &str) -> Result<Vec<OfflineCommit>, String> {
    let output = git::util::run_git(
        repo_path,
        &[
            "log",
            &format!("--since={}", since),
            "--format=%H%x1f%aI%x1f%s",
            "--numstat",
            "--no-merges",
            &format!("-{}", MAX_COMMITS_PER_REPO),
        ],
    )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_git_log_output(&stdout)
}

/// Parse `git log --format="%H%x1f%aI%x1f%s" --numstat` output.
///
/// Format:
/// ```text
/// <sha>\x1f<timestamp>\x1f<subject>
/// 10\t5\tpath/to/file.rs
/// 3\t1\tpath/to/other.ts
///
/// <sha>\x1f<timestamp>\x1f<subject>
/// ...
/// ```
fn parse_git_log_output(output: &str) -> Result<Vec<OfflineCommit>, String> {
    let mut commits = Vec::new();
    let mut current_commit: Option<OfflineCommit> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some(commit) = current_commit.take() {
                commits.push(commit);
            }
            continue;
        }

        // Check if this is a commit header line (contains \x1f separators)
        if trimmed.contains('\x1f') {
            // Save previous commit if any
            if let Some(commit) = current_commit.take() {
                commits.push(commit);
            }

            let parts: Vec<&str> = trimmed.splitn(3, '\x1f').collect();
            if parts.len() >= 2 {
                current_commit = Some(OfflineCommit {
                    sha: parts[0].to_string(),
                    timestamp: parts[1].to_string(),
                    files: Vec::new(),
                });
            }
        } else if let Some(ref mut commit) = current_commit {
            // Parse numstat line: "additions\tdeletions\tfilepath"
            let parts: Vec<&str> = trimmed.splitn(3, '\t').collect();
            if parts.len() == 3 {
                // Binary files show "-" for additions/deletions
                let additions = parts[0].parse::<i32>().unwrap_or(0);
                let deletions = parts[1].parse::<i32>().unwrap_or(0);
                let path = parts[2].to_string();

                if commit.files.len() < MAX_FILES_PER_COMMIT {
                    commit.files.push(CommitFile {
                        path,
                        additions,
                        deletions,
                    });
                }
            }
        }
    }

    // Don't forget the last commit
    if let Some(commit) = current_commit {
        commits.push(commit);
    }

    Ok(commits)
}

// ============================================
// Session Creation for Retroactive Commits
// ============================================

const SESSION_GAP_SECS: i64 = 300;

/// Group commits by time gap (>5 min = new session) and create coding_sessions rows.
/// Uses attributed sources from the commit list to set the correct IDE source per session.
fn create_retroactive_sessions(
    commits: &[OfflineCommit],
    commit_sources: &[ActivitySource],
    workspace_path: &str,
) -> Result<usize, String> {
    if commits.is_empty() {
        return Ok(0);
    }

    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let mut sessions_created = 0usize;

    // Build (epoch, timestamp_str, source) sorted by time
    let mut sorted: Vec<(i64, &str, ActivitySource)> = commits
        .iter()
        .zip(commit_sources.iter())
        .filter_map(|(commit, source)| {
            parse_commit_timestamp(&commit.timestamp)
                .map(|dt| (dt.timestamp(), commit.timestamp.as_str(), *source))
        })
        .collect();
    sorted.sort_by_key(|(epoch, _, _)| *epoch);

    if sorted.is_empty() {
        return Ok(0);
    }

    let mut session_start = sorted[0].1;
    let mut session_end = sorted[0].1;
    let mut session_source = sorted[0].2;
    let mut prev_epoch = sorted[0].0;
    let mut heartbeat_count = 1i64;
    let mut source_counts = std::collections::HashMap::new();
    *source_counts.entry(sorted[0].2).or_insert(0u32) += 1;

    for &(epoch, ts_str, source) in &sorted[1..] {
        let gap = epoch - prev_epoch;
        if gap > SESSION_GAP_SECS {
            if insert_retroactive_session(
                &conn,
                session_start,
                session_end,
                workspace_path,
                &session_source,
                heartbeat_count,
            ) {
                sessions_created += 1;
            }
            session_start = ts_str;
            heartbeat_count = 0;
            source_counts.clear();
        }
        *source_counts.entry(source).or_insert(0u32) += 1;
        // Most common source in this session group
        session_source = *source_counts
            .iter()
            .max_by_key(|(_, count)| *count)
            .map(|(src, _)| src)
            .unwrap_or(&ActivitySource::Unknown);
        session_end = ts_str;
        prev_epoch = epoch;
        heartbeat_count += 1;
    }

    if insert_retroactive_session(
        &conn,
        session_start,
        session_end,
        workspace_path,
        &session_source,
        heartbeat_count,
    ) {
        sessions_created += 1;
    }

    Ok(sessions_created)
}

fn insert_retroactive_session(
    conn: &rusqlite::Connection,
    start_time: &str,
    end_time: &str,
    workspace_path: &str,
    source: &ActivitySource,
    heartbeat_count: i64,
) -> bool {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM coding_sessions WHERE start_time = ?1 AND workspace_path = ?2)",
            params![start_time, workspace_path],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if exists {
        return false;
    }

    conn.execute(
        "INSERT INTO coding_sessions (start_time, end_time, workspace_path, source, duration_seconds, heartbeat_count)
         VALUES (?1, ?2, ?3, ?4,
                 CAST((julianday(?2) - julianday(?1)) * 86400 AS INTEGER),
                 ?5)",
        params![start_time, end_time, workspace_path, source.to_string(), heartbeat_count],
    )
    .is_ok()
}

// ============================================
// Startup Cleanup & Session Backfill
// ============================================

/// Delete sessions with source='retroactive' (legacy bug) so they get recreated
/// with the correct attributed IDE source.
fn cleanup_legacy_retroactive_sessions() {
    let conn = match get_connection() {
        Ok(conn) => conn,
        Err(_) => return,
    };
    let deleted = conn
        .execute(
            "DELETE FROM coding_sessions WHERE source = 'retroactive'",
            [],
        )
        .unwrap_or(0);
    if deleted > 0 {
        println!(
            "[retroactive] Cleaned up {} legacy 'retroactive' sessions",
            deleted
        );
    }
}

/// Create coding_sessions from existing heartbeats that have no matching session.
/// Groups heartbeats by workspace path, ordered by timestamp, with 5-min gap detection.
fn backfill_sessions_from_heartbeats() {
    let conn = match get_connection() {
        Ok(conn) => conn,
        Err(_) => return,
    };

    let mut stmt = match conn.prepare(
        "SELECT hb.timestamp, hb.workspace_path, hb.source
         FROM coding_heartbeats hb
         LEFT JOIN coding_sessions s
             ON hb.workspace_path = s.workspace_path
             AND hb.timestamp BETWEEN s.start_time AND s.end_time
         WHERE s.id IS NULL
         ORDER BY hb.workspace_path, hb.timestamp",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return,
    };

    let rows: Vec<(String, Option<String>, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .ok()
        .map(|iter| iter.filter_map(|row| row.ok()).collect())
        .unwrap_or_default();

    if rows.is_empty() {
        return;
    }

    let mut sessions_created = 0usize;
    let mut session_start: Option<&str> = None;
    let mut session_end: &str = "";
    let mut current_workspace_path: Option<&str> = None;
    let mut prev_epoch: i64 = 0;
    let mut heartbeat_count: i64 = 0;
    let mut source_counts: std::collections::HashMap<String, u32> =
        std::collections::HashMap::new();

    for (idx, (timestamp, workspace_path, source)) in rows.iter().enumerate() {
        let workspace_path_str = workspace_path.as_deref().unwrap_or("");
        let epoch = parse_commit_timestamp(timestamp)
            .map(|dt| dt.timestamp())
            .unwrap_or(0);

        let workspace_changed = current_workspace_path != Some(workspace_path_str);
        let gap_exceeded = epoch - prev_epoch > SESSION_GAP_SECS;
        let is_last = idx == rows.len() - 1;

        if (workspace_changed || gap_exceeded) && session_start.is_some() {
            let best_source = source_counts
                .iter()
                .max_by_key(|(_, count)| *count)
                .map(|(src, _)| ActivitySource::from_str_value(src))
                .unwrap_or(ActivitySource::Unknown);
            if insert_retroactive_session(
                &conn,
                session_start.unwrap(),
                session_end,
                current_workspace_path.unwrap_or(""),
                &best_source,
                heartbeat_count,
            ) {
                sessions_created += 1;
            }
            session_start = None;
            source_counts.clear();
            heartbeat_count = 0;
        }

        if session_start.is_none() {
            session_start = Some(timestamp);
            current_workspace_path = Some(workspace_path_str);
        }

        session_end = timestamp;
        prev_epoch = epoch;
        heartbeat_count += 1;
        *source_counts.entry(source.clone()).or_insert(0) += 1;

        if is_last {
            if let Some(start) = session_start {
                let best_source = source_counts
                    .iter()
                    .max_by_key(|(_, count)| *count)
                    .map(|(src, _)| ActivitySource::from_str_value(src))
                    .unwrap_or(ActivitySource::Unknown);
                if insert_retroactive_session(
                    &conn,
                    start,
                    session_end,
                    current_workspace_path.unwrap_or(""),
                    &best_source,
                    heartbeat_count,
                ) {
                    sessions_created += 1;
                }
            }
        }
    }

    if sessions_created > 0 {
        println!(
            "[retroactive] Created {} sessions from {} orphaned heartbeats",
            sessions_created,
            rows.len()
        );
    }
}

// ============================================
// Timestamp Helpers
// ============================================

fn parse_commit_timestamp(ts: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .or_else(|| chrono::DateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%:z").ok())
}

// ============================================
// Repo Discovery
// ============================================

fn get_registered_repos() -> Result<Vec<(String, PathBuf)>, String> {
    // Use the repo DB directly — it has all persisted repos
    let repos = git::repos::repo_db::list_repos()?;
    Ok(repos
        .into_iter()
        .filter(|repo| Path::new(&repo.path).exists())
        .map(|repo| (repo.repo_id, PathBuf::from(repo.path)))
        .collect())
}
