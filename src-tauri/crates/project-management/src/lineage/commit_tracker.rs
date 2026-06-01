//! Commit Tracker — links git commits to AI-originated provenance entries.
//!
//! When a commit is created, this module retrieves the commit diff and matches
//! changed line ranges against `node_provenance` rows. Matches are recorded in
//! `commit_lineage`.

use chrono::Utc;
use rusqlite::params;
use std::path::Path;

use super::git_bridge;
use database::db::get_connection;

/// Match a commit's changed regions against existing provenance entries.
///
/// Returns the number of provenance rows linked to this commit.
pub fn match_commit(repo_path: &Path, commit_sha: &str) -> Result<u32, String> {
    let diff_result = git_bridge::get_commit_diff(repo_path, commit_sha)?;

    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let now = Utc::now().timestamp();
    let mut matched_count: u32 = 0;

    for file_diff in &diff_result.files {
        if file_diff.binary {
            continue;
        }
        for hunk in &file_diff.hunks {
            let hunk_start = hunk.new_start;
            let hunk_end = hunk
                .new_start
                .saturating_add(hunk.new_lines)
                .saturating_sub(1);

            // Find provenance rows whose line ranges overlap this hunk
            let mut stmt = conn
                .prepare_cached(
                    "SELECT id, file FROM node_provenance
                     WHERE file = ?1 AND start_line <= ?2 AND end_line >= ?3",
                )
                .map_err(|err| format!("Prepare failed: {}", err))?;

            let matches: Vec<(i64, String)> = stmt
                .query_map(params![file_diff.file_path, hunk_end, hunk_start], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|err| format!("Query failed: {}", err))?
                .filter_map(|r| r.ok())
                .collect();

            for (provenance_id, file) in &matches {
                conn.execute(
                    "INSERT OR IGNORE INTO commit_lineage
                        (provenance_id, commit_id, file, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![provenance_id, commit_sha, file, now],
                )
                .map_err(|err| format!("Insert lineage failed: {}", err))?;
                matched_count += 1;
            }
        }
    }

    if matched_count > 0 {
        log::info!(
            "[lineage] Linked {} provenance entries to commit {}",
            matched_count,
            &commit_sha[..8.min(commit_sha.len())]
        );
    }

    Ok(matched_count)
}
