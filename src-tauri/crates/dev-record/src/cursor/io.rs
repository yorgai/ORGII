//! Low-level SQLite access against Cursor's `state.vscdb`.
//!
//! All functions are `pub(super)` — internal to `cursor_db_history` only.
//! The connection is opened read-only and dropped between calls so we never
//! block Cursor from writing.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{params_from_iter, Connection, OpenFlags};

use super::models::{OrderedBubble, RawBubble, RawComposerForOrder, RawComposerHeader};

const SQLITE_IN_QUERY_CHUNK_SIZE: usize = 500;

/// Open Cursor's global `state.vscdb` read-only.
///
/// Returns `None` if the file does not exist (Cursor not installed / not yet
/// launched) or cannot be opened.
pub(super) fn open_cursor_db() -> Option<Connection> {
    let path = cursor_db_path()?;
    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

pub(super) fn cursor_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let path = home
        .join("Library")
        .join("Application Support")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "linux")]
    let path = home
        .join(".config")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "windows")]
    let path = home
        .join("AppData")
        .join("Roaming")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    if path.exists() {
        Some(path)
    } else {
        None
    }
}

pub(super) fn load_bubble_order(
    conn: &Connection,
    composer_id: &str,
) -> Result<Vec<RawComposerHeader>, String> {
    Ok(load_composer_for_order(conn, composer_id)?.full_conversation_headers_only)
}

pub(super) fn load_composer_for_order(
    conn: &Connection,
    composer_id: &str,
) -> Result<RawComposerForOrder, String> {
    let key = format!("composerData:{}", composer_id);
    let json_str: String = match conn.query_row(
        "SELECT value FROM cursorDiskKV WHERE key = ?1",
        [&key],
        |row| row.get(0),
    ) {
        Ok(val) => val,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(RawComposerForOrder::default()),
        Err(err) => return Err(format!("Failed to read composer {}: {}", composer_id, err)),
    };

    serde_json::from_str(&json_str)
        .map_err(|err| format!("Failed to parse composer {}: {}", composer_id, err))
}

pub(super) fn load_bubbles_by_id(
    conn: &Connection,
    composer_id: &str,
    order: &[RawComposerHeader],
) -> Result<Vec<OrderedBubble>, String> {
    let keyed_headers: Vec<(&RawComposerHeader, String)> = order
        .iter()
        .filter(|header| !header.bubble_id.is_empty())
        .map(|header| {
            (
                header,
                format!("bubbleId:{}:{}", composer_id, header.bubble_id),
            )
        })
        .collect();
    if keyed_headers.is_empty() {
        return Ok(vec![]);
    }

    let mut values_by_key = HashMap::with_capacity(keyed_headers.len());
    for chunk in keyed_headers.chunks(SQLITE_IN_QUERY_CHUNK_SIZE) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT key, value FROM cursorDiskKV WHERE key IN ({})",
            placeholders
        );
        let keys = chunk
            .iter()
            .map(|(_, key)| key.as_str())
            .collect::<Vec<_>>();
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| format!("Failed to prepare bubble query: {}", err))?;
        let rows = stmt
            .query_map(params_from_iter(keys), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| format!("Failed to read bubbles: {}", err))?;

        for row in rows {
            let (key, value) = row.map_err(|err| format!("Failed to read bubble row: {}", err))?;
            values_by_key.insert(key, value);
        }
    }

    let mut out = Vec::with_capacity(keyed_headers.len());
    for (header, key) in keyed_headers {
        let Some(json_str) = values_by_key.get(&key) else {
            continue;
        };

        match serde_json::from_str::<RawBubble>(json_str) {
            Ok(raw) => out.push(OrderedBubble {
                bubble_id: header.bubble_id.clone(),
                bubble_type: header.bubble_type,
                raw,
            }),
            // Lenient parsing: if Cursor changes a bubble's shape, skip that
            // single bubble rather than failing the whole session.
            Err(_) => continue,
        }
    }

    Ok(out)
}

/// Look up a `composer.content.{hash}` blob and return its raw text body,
/// or `None` if the key is missing. Cursor stores edit before/after file
/// content under these keys; the value is the file body as a plain string,
/// not JSON.
pub(super) fn load_content_blob(conn: &Connection, content_id: &str) -> Option<String> {
    if !content_id.starts_with("composer.content.") {
        return None;
    }
    conn.query_row(
        "SELECT value FROM cursorDiskKV WHERE key = ?1",
        [content_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
}
