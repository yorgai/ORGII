//! Aggregation & Summary Queries
//!
//! All read queries for the coding tracker. Operates on `coding_heartbeats`,
//! `coding_daily_summary`, and `coding_sessions` tables.
//!
//! Date filtering uses range predicates (`timestamp >= ?1 AND timestamp < ?2`)
//! instead of `DATE(timestamp)` so the `idx_coding_hb_timestamp` index is used.

use rusqlite::params;

use super::types::{
    CodingSession, DailySummary, FileHotspot, HeatmapCell, IdeUsageStat, LanguageStat, StreakInfo,
};
use database::db::get_connection;

fn day_start_timestamp(date: &str) -> String {
    format!("{date}T00:00:00")
}

fn next_day_start_timestamp(date: &str) -> String {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return format!("{date}T23:59:59");
    }
    let year: i32 = parts[0].parse().unwrap_or(2025);
    let month: u32 = parts[1].parse().unwrap_or(1);
    let day: u32 = parts[2].parse().unwrap_or(1);
    match chrono::NaiveDate::from_ymd_opt(year, month, day) {
        Some(d) => {
            let next = d + chrono::Duration::days(1);
            format!("{}T00:00:00", next.format("%Y-%m-%d"))
        }
        None => format!("{date}T23:59:59"),
    }
}

// ============================================
// Daily Summaries
// ============================================

/// Get aggregated daily summaries from heartbeats for a date range.
pub fn get_daily_summaries(start_date: &str, end_date: &str) -> Result<Vec<DailySummary>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT
                DATE(timestamp) as day,
                workspace_path,
                language,
                COUNT(DISTINCT CAST(strftime('%s', timestamp) / 120 AS INTEGER)) * 120 as total_seconds,
                SUM(CASE WHEN event_type IN ('file_edit','file_create','file_delete') THEN 1 ELSE 0 END) as file_edits,
                SUM(lines_added) as lines_added,
                SUM(lines_removed) as lines_removed,
                SUM(CASE WHEN event_type = 'terminal_command' THEN 1 ELSE 0 END) as terminal_cmds,
                SUM(CASE WHEN event_type = 'agent_action' THEN 1 ELSE 0 END) as agent_actions,
                COUNT(DISTINCT file_path) as files_touched,
                source
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY day, workspace_path, language, source
             ORDER BY day DESC",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi], |row| {
            Ok(DailySummary {
                date: row.get(0)?,
                workspace_path: row.get(1)?,
                language: row.get(2)?,
                total_seconds: row.get(3)?,
                file_edits: row.get(4)?,
                lines_added: row.get(5)?,
                lines_removed: row.get(6)?,
                terminal_cmds: row.get(7)?,
                agent_actions: row.get(8)?,
                files_touched: row.get(9)?,
                primary_source: row.get(10)?,
            })
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let results: Vec<_> = rows.filter_map(Result::ok).collect();
    Ok(results)
}

// ============================================
// Language Distribution
// ============================================

pub fn get_language_distribution(
    start_date: &str,
    end_date: &str,
) -> Result<Vec<LanguageStat>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT
                COALESCE(language, 'Unknown') as lang,
                COUNT(DISTINCT CAST(strftime('%s', timestamp) / 120 AS INTEGER)) * 120 as total_seconds,
                COUNT(*) as file_edits,
                SUM(lines_added) as lines_added,
                SUM(lines_removed) as lines_removed
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
               AND event_type IN ('file_edit','file_create','file_delete')
               AND language IS NOT NULL
             GROUP BY lang
             ORDER BY total_seconds DESC",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi], |row| {
            Ok(LanguageStat {
                language: row.get(0)?,
                total_seconds: row.get(1)?,
                file_edits: row.get(2)?,
                lines_added: row.get(3)?,
                lines_removed: row.get(4)?,
            })
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let results: Vec<_> = rows.filter_map(Result::ok).collect();
    Ok(results)
}

// ============================================
// Hourly Heatmap
// ============================================

/// Returns activity count by (hour_of_day, day_of_week) for a heatmap.
/// hour: 0-23, day_of_week: 0 (Sunday) - 6 (Saturday).
pub fn get_hourly_heatmap(start_date: &str, end_date: &str) -> Result<Vec<HeatmapCell>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT
                CAST(strftime('%H', timestamp) AS INTEGER) as hour,
                CAST(strftime('%w', timestamp) AS INTEGER) as day_of_week,
                COUNT(*) as cnt
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY hour, day_of_week
             ORDER BY day_of_week, hour",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi], |row| {
            Ok(HeatmapCell {
                hour: row.get(0)?,
                day_of_week: row.get(1)?,
                count: row.get(2)?,
            })
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let results: Vec<_> = rows.filter_map(Result::ok).collect();
    Ok(results)
}

// ============================================
// IDE Usage Distribution
// ============================================

pub fn get_ide_distribution(start_date: &str, end_date: &str) -> Result<Vec<IdeUsageStat>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT
                source,
                COUNT(DISTINCT CAST(strftime('%s', timestamp) / 120 AS INTEGER)) * 120 as total_seconds,
                SUM(CASE WHEN event_type IN ('file_edit','file_create','file_delete') THEN 1 ELSE 0 END) as file_edits,
                COUNT(*) as heartbeat_count
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY source
             ORDER BY total_seconds DESC",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi], |row| {
            Ok(IdeUsageStat {
                source: row.get(0)?,
                total_seconds: row.get(1)?,
                file_edits: row.get(2)?,
                heartbeat_count: row.get(3)?,
            })
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let results: Vec<_> = rows.filter_map(Result::ok).collect();
    Ok(results)
}

// ============================================
// Coding Streaks
// ============================================

/// Compute current streak (consecutive days ending today or yesterday)
/// and longest-ever streak.
pub fn get_coding_streaks() -> Result<StreakInfo, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;

    // Get all distinct active dates, ordered descending
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT DATE(timestamp) as day
             FROM coding_heartbeats
             ORDER BY day DESC",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let dates: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|err| format!("Query failed: {}", err))?
        .filter_map(|row| row.ok())
        .collect();

    if dates.is_empty() {
        return Ok(StreakInfo {
            current_streak: 0,
            longest_streak: 0,
            last_active_date: None,
        });
    }

    let last_active = dates[0].clone();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let yesterday = (chrono::Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    // Parse all dates
    let parsed_dates: Vec<chrono::NaiveDate> = dates
        .iter()
        .filter_map(|ds| chrono::NaiveDate::parse_from_str(ds, "%Y-%m-%d").ok())
        .collect();

    if parsed_dates.is_empty() {
        return Ok(StreakInfo {
            current_streak: 0,
            longest_streak: 0,
            last_active_date: Some(last_active),
        });
    }

    // Current streak: count consecutive days from most recent
    let mut current_streak: i64 = 0;
    let is_active_today_or_yesterday = last_active == today || last_active == yesterday;

    if is_active_today_or_yesterday {
        current_streak = 1;
        for window in parsed_dates.windows(2) {
            let diff = window[0].signed_duration_since(window[1]).num_days();
            if diff == 1 {
                current_streak += 1;
            } else {
                break;
            }
        }
    }

    // Longest streak
    let mut longest_streak: i64 = 1;
    let mut current_run: i64 = 1;
    for window in parsed_dates.windows(2) {
        let diff = window[0].signed_duration_since(window[1]).num_days();
        if diff == 1 {
            current_run += 1;
            if current_run > longest_streak {
                longest_streak = current_run;
            }
        } else {
            current_run = 1;
        }
    }

    Ok(StreakInfo {
        current_streak,
        longest_streak,
        last_active_date: Some(last_active),
    })
}

// ============================================
// Session Count
// ============================================

/// Count coding sessions within a date range.
pub fn get_session_count(start_date: &str, end_date: &str) -> Result<i64, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    conn.query_row(
        "SELECT COUNT(*) FROM coding_sessions
         WHERE start_time >= ?1 AND start_time < ?2",
        params![ts_lo, ts_hi],
        |row| row.get(0),
    )
    .map_err(|err| format!("Query failed: {}", err))
}

// ============================================
// Session List
// ============================================

/// List coding sessions within a date range, newest first.
pub fn get_sessions(start_date: &str, end_date: &str) -> Result<Vec<CodingSession>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT id, start_time, end_time, workspace_path, source, duration_seconds, heartbeat_count
             FROM coding_sessions
             WHERE start_time >= ?1 AND start_time < ?2
             ORDER BY start_time DESC
             LIMIT 200",
        )
        .map_err(|err| format!("Prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi], |row| {
            Ok(CodingSession {
                id: row.get(0)?,
                start_time: row.get(1)?,
                end_time: row.get(2)?,
                workspace_path: row.get(3)?,
                source: row.get(4)?,
                duration_seconds: row.get(5)?,
                heartbeat_count: row.get(6)?,
            })
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|err| format!("Row error: {}", err))?);
    }
    Ok(results)
}

// ============================================
// File Hotspots
// ============================================

/// Top N most-edited files within a date range, ordered by edit count.
/// Returns hotspots paired with the workspace path they belong to.
pub fn get_file_hotspots_with_workspace(
    start_date: &str,
    end_date: &str,
    limit: i64,
) -> Result<Vec<(FileHotspot, Option<String>)>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(start_date);
    let ts_hi = next_day_start_timestamp(end_date);
    let mut stmt = conn
        .prepare(
            "SELECT
                file_path,
                COUNT(*) as edit_count,
                SUM(lines_added) as lines_added,
                SUM(lines_removed) as lines_removed,
                MAX(workspace_path) as workspace_path
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
               AND file_path IS NOT NULL
               AND event_type IN ('file_edit','file_create','file_delete')
             GROUP BY file_path
             ORDER BY edit_count DESC
             LIMIT ?3",
        )
        .map_err(|err| format!("Query prepare failed: {}", err))?;

    let rows = stmt
        .query_map(params![ts_lo, ts_hi, limit], |row| {
            Ok((
                FileHotspot {
                    file_path: row.get(0)?,
                    edit_count: row.get(1)?,
                    lines_added: row.get(2)?,
                    lines_removed: row.get(3)?,
                    commit_count: 0,
                },
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|err| format!("Query failed: {}", err))?;

    let results: Vec<_> = rows.filter_map(Result::ok).collect();
    Ok(results)
}

// ============================================
// Rollup: Compute daily summary from heartbeats
// ============================================

/// Rollup heartbeats for a given date into `coding_daily_summary`.
/// Uses INSERT OR REPLACE to be idempotent.
pub fn rollup_daily_summary(date: &str) -> Result<u64, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let ts_lo = day_start_timestamp(date);
    let ts_hi = next_day_start_timestamp(date);
    let affected = conn
        .execute(
            "INSERT OR REPLACE INTO coding_daily_summary
                (date, workspace_path, language, source, total_seconds, file_edits,
                 lines_added, lines_removed, terminal_cmds, agent_actions, files_touched)
             SELECT
                DATE(timestamp) as day,
                workspace_path,
                language,
                source,
                COUNT(DISTINCT CAST(strftime('%s', timestamp) / 120 AS INTEGER)) * 120,
                SUM(CASE WHEN event_type IN ('file_edit','file_create','file_delete') THEN 1 ELSE 0 END),
                SUM(lines_added),
                SUM(lines_removed),
                SUM(CASE WHEN event_type = 'terminal_command' THEN 1 ELSE 0 END),
                SUM(CASE WHEN event_type = 'agent_action' THEN 1 ELSE 0 END),
                COUNT(DISTINCT file_path)
             FROM coding_heartbeats
             WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY day, workspace_path, language, source",
            params![ts_lo, ts_hi],
        )
        .map_err(|err| format!("Rollup failed: {}", err))?;

    Ok(affected as u64)
}
