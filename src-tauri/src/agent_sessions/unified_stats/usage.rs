//! Usage history query — single SQL UNION ALL across code_sessions + agent_sessions.
//!
//! Returns `UsageRecord` rows ready for the Dev Record > Sessions tab.
//! All filtering (date range, provider) happens at the SQL level so the
//! frontend receives only the rows it needs.

use rusqlite::params;

use database::db::get_connection;

use super::types::{UsageFilter, UsageRecord};

/// Query both code_sessions and agent_sessions, returning unified usage rows.
///
/// The UNION ALL query runs on a single connection because both tables live in
/// the same `sessions.db` file.
pub fn query_usage_list(filter: Option<&UsageFilter>) -> Result<Vec<UsageRecord>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {err}"))?;

    let start_date = filter.and_then(|f| f.start_date.as_deref());
    let end_date = filter.and_then(|f| f.end_date.as_deref());
    let provider = filter.and_then(|f| f.provider.as_deref());

    let sql = r#"
        SELECT
            cs.session_id,
            COALESCE(cs.name, '') as name,
            CASE COALESCE(cs.key_source, 'own_key')
                WHEN 'own_key' THEN 'local'
                ELSE 'pooling'
            END as source,
            COALESCE(cs.cli_agent_type, cs.platform, 'unknown') as provider,
            COALESCE(cs.model, 'auto') as model,
            COALESCE((SELECT SUM(total_tokens) FROM session_token_usage WHERE session_id = cs.session_id), 0) as tokens,
            0.0 as cost,
            cs.status,
            cs.created_at
        FROM code_sessions cs
        WHERE (?1 IS NULL OR date(cs.created_at) >= ?1)
          AND (?2 IS NULL OR date(cs.created_at) <= ?2)
          AND (?3 IS NULL OR COALESCE(cs.cli_agent_type, cs.platform, 'unknown') = ?3)

        UNION ALL

        SELECT
            s.session_id,
            COALESCE(s.name, COALESCE(s.user_input, '')) as name,
            'local' as source,
            CASE s.session_type
                WHEN 'sde' THEN 'sde_agent'
                WHEN 'os'  THEN 'os_agent'
                ELSE s.session_type
            END as provider,
            COALESCE(s.model, 'auto') as model,
            COALESCE((SELECT SUM(total_tokens) FROM session_token_usage WHERE session_id = s.session_id), 0) as tokens,
            0.0 as cost,
            s.status,
            s.created_at
        FROM agent_sessions s
        WHERE (?1 IS NULL OR date(s.created_at) >= ?1)
          AND (?2 IS NULL OR date(s.created_at) <= ?2)
          AND (?3 IS NULL OR CASE s.session_type
                WHEN 'sde' THEN 'sde_agent'
                WHEN 'os'  THEN 'os_agent'
                ELSE s.session_type
            END = ?3)

        ORDER BY created_at DESC
    "#;

    let mut stmt = conn
        .prepare(sql)
        .map_err(|err| format!("SQL prepare error: {err}"))?;

    let rows = stmt
        .query_map(params![start_date, end_date, provider], |row| {
            Ok(UsageRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                source: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                tokens: row.get(5)?,
                cost: row.get(6)?,
                status: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|err| format!("SQL query error: {err}"))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|err| format!("Row read error: {err}"))?);
    }

    Ok(results)
}
