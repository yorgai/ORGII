//! Provenance Recording — captures which AST nodes an AI session produced.
//!
//! When an AI session edits a file, this module reads the file, finds overlapping
//! symbols via tree-sitter, hashes them, and inserts rows into `node_provenance`.

use chrono::Utc;
use rusqlite::params;
use std::fs;
use std::path::PathBuf;

use database::db::get_connection;
use search::code::commands::get_file_symbols;

use super::hashing::compute_node_hash;

/// Record provenance for a file region edited by an AI session.
///
/// Reads the file, finds symbols overlapping `[start_line, end_line]` (1-based),
/// and inserts a `node_provenance` row per symbol. If no symbol overlaps, a
/// generic "block" entry is stored so the edit is still tracked.
pub fn record_provenance(
    session_id: &str,
    file_path: &str,
    start_line: u32,
    end_line: u32,
) -> Result<(), String> {
    if start_line == 0 && end_line == 0 {
        return Ok(());
    }

    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read {}: {}", file_path, err))?;

    let file_line_count = content.lines().count().max(1) as u32;
    let end_line = end_line.min(file_line_count);

    if start_line > end_line {
        return Ok(());
    }

    let now = Utc::now().timestamp();
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;

    let symbols = get_file_symbols(file_path.to_string()).unwrap_or_default();

    let overlapping: Vec<_> = symbols
        .iter()
        .filter(|sym| {
            let sym_start = sym.line as u32;
            let sym_end = sym.end_line as u32;
            sym_start <= end_line && sym_end >= start_line
        })
        .collect();

    if overlapping.is_empty() {
        let node_hash = compute_node_hash(&content, start_line, end_line);
        conn.execute(
            "INSERT INTO node_provenance
                (session_id, file, function_name, node_type, node_hash, start_line, end_line, created_at)
             VALUES (?1, ?2, NULL, 'block', ?3, ?4, ?5, ?6)",
            params![session_id, file_path, node_hash, start_line, end_line, now],
        )
        .map_err(|err| format!("Insert provenance failed: {}", err))?;
    } else {
        for sym in &overlapping {
            let sym_start = sym.line as u32;
            let sym_end = sym.end_line as u32;
            let node_hash = compute_node_hash(&content, sym_start, sym_end);
            conn.execute(
                "INSERT INTO node_provenance
                    (session_id, file, function_name, node_type, node_hash, start_line, end_line, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    session_id,
                    file_path,
                    sym.name,
                    sym.kind,
                    node_hash,
                    sym_start,
                    sym_end,
                    now,
                ],
            )
            .map_err(|err| format!("Insert provenance failed: {}", err))?;
        }
    }

    Ok(())
}
