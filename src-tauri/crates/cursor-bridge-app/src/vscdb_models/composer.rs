//! Per-composer data queries: model, last-updated timestamp, unified mode.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tracing::{debug, info};

use super::db_path::{real_user_db, COMPOSER_DATA_KEY_PREFIX, PROBE_DB_PATH};

/// Read the model name a specific composer was last using.
///
/// Cursor mirrors its in-memory `modelConfig` object onto the
/// `composerData:<uuid>` row in `cursorDiskKV` whenever a chat turn
/// completes. The blob's `modelConfig.modelName` field is the
/// canonical model id (matches the `name` field on
/// [`ModelEntry`]) — exactly what the picker needs to render the
/// "currently selected" label and what `set_model_for_composer`
/// expects.
///
/// Lookup order matches [`read_models_from_disk`]:
///   1. Probe DB at [`PROBE_DB_PATH`] — same instance the live CDP
///      path talks to, so disk and live agree.
///   2. Real Cursor DB under `~/Library/Application Support/...` —
///      first-run fallback when the probe DB hasn't been seeded yet.
///
/// Returns `Ok(None)` when:
/// - neither DB exists yet (Cursor not installed)
/// - the composer row exists but has no `modelConfig` field
///   (older Cursor builds, or composers created before model
///   selection was persisted)
///
/// Surfaces `Err` only for genuine SQLite/JSON failures so the caller
/// can distinguish "no model recorded" (degrade gracefully) from
/// "DB corrupted" (show an error).
pub fn read_composer_model_from_disk(composer_id: &str) -> Result<Option<String>, String> {
    if composer_id.trim().is_empty() {
        return Err("composer_id must not be empty".to_string());
    }

    let probe = Path::new(PROBE_DB_PATH);
    if probe.exists() {
        if let Some(model) = read_composer_model_at(probe, composer_id)? {
            info!(
                composer_id,
                model_name = %model,
                "read composer model from probe state.vscdb",
            );
            return Ok(Some(model));
        }
    }

    let real = real_user_db();
    if real.exists() {
        if let Some(model) = read_composer_model_at(&real, composer_id)? {
            info!(
                composer_id,
                model_name = %model,
                "read composer model from real Cursor state.vscdb",
            );
            return Ok(Some(model));
        }
    }

    debug!(composer_id, "no modelConfig recorded for composer");
    Ok(None)
}

pub(super) fn read_composer_model_at(
    db_path: &Path,
    composer_id: &str,
) -> Result<Option<String>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let key = format!("{COMPOSER_DATA_KEY_PREFIX}{composer_id}");
    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        debug!(
            path = %db_path.display(),
            key = %key,
            "composer row missing — composer may live in another DB",
        );
        return Ok(None);
    };

    // Targeted parse: we only care about `modelConfig.modelName`. A
    // narrow shape keeps us forward-compatible — every other field
    // Cursor adds or renames is silently ignored.
    let parsed: ComposerDataBlob =
        serde_json::from_str(&json_text).map_err(|err| format!("parse {key} blob: {err}"))?;
    Ok(parsed
        .model_config
        .and_then(|mc| mc.model_name)
        .filter(|s| !s.is_empty()))
}

/// Read the per-composer "something changed" timestamp.
///
/// Returns `Ok(None)` when:
/// - the composer row is missing (Cursor hasn't flushed it yet)
/// - the row exists but has no `lastUpdatedAt` /
///   `conversationCheckpointLastUpdatedAt` (older Cursor builds)
/// - neither the probe nor real Cursor DB exists
///
/// Picks the **max** of `lastUpdatedAt` and
/// `conversationCheckpointLastUpdatedAt` so the poller wakes up on
/// any state mutation, not just the one Cursor happened to write
/// last. Always returns the real Cursor DB's value when both DBs
/// have the row — the probe never sees the user's real composers.
pub fn read_composer_last_updated_at(composer_id: &str) -> Result<Option<i64>, String> {
    if composer_id.trim().is_empty() {
        return Err("composer_id must not be empty".to_string());
    }

    // Probe Cursor first; it's the instance that just wrote a new
    // bubble after `cursor_bridge_send`. The real Cursor DB is
    // a fallback for composers the user opened in their main Cursor.
    let probe = Path::new(PROBE_DB_PATH);
    if probe.exists() {
        if let Some(ts) = read_composer_last_updated_at_at(probe, composer_id)? {
            return Ok(Some(ts));
        }
    }

    let real = real_user_db();
    if real.exists() {
        if let Some(ts) = read_composer_last_updated_at_at(&real, composer_id)? {
            return Ok(Some(ts));
        }
    }

    Ok(None)
}

pub(super) fn read_composer_last_updated_at_at(
    db_path: &Path,
    composer_id: &str,
) -> Result<Option<i64>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let key = format!("{COMPOSER_DATA_KEY_PREFIX}{composer_id}");
    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        return Ok(None);
    };

    let parsed: ComposerDataBlob =
        serde_json::from_str(&json_text).map_err(|err| format!("parse {key} blob: {err}"))?;

    Ok(
        match (parsed.last_updated_at, parsed.checkpoint_last_updated_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        },
    )
}

/// Read the per-composer unified-mode value from disk.
///
/// Returns `Ok(None)` when:
/// - the composer row is missing (Cursor hasn't flushed it yet),
/// - the row exists but has no `unifiedMode` field (older Cursor
///   builds, or composers created before the unified-mode picker
///   shipped),
/// - neither the probe nor real Cursor DB exists.
///
/// Surfaces `Err` only on real SQLite/JSON failures so the caller
/// can distinguish "no recorded mode" (degrade gracefully — fall
/// back to the global default `agent`) from "DB corrupted".
///
/// Same probe-then-real lookup order as `read_composer_model_from_disk`:
/// the probe Cursor is the instance our `cursor_bridge_send`
/// just wrote bubbles to, so its row is the most recent; the real
/// Cursor DB is the fallback for composers the user opened in their
/// main installation.
pub fn read_composer_unified_mode_from_disk(composer_id: &str) -> Result<Option<String>, String> {
    if composer_id.trim().is_empty() {
        return Err("composer_id must not be empty".to_string());
    }

    let probe = Path::new(PROBE_DB_PATH);
    if probe.exists() {
        if let Some(mode) = read_composer_unified_mode_at(probe, composer_id)? {
            info!(
                composer_id,
                mode = %mode,
                "read composer unifiedMode from probe state.vscdb",
            );
            return Ok(Some(mode));
        }
    }

    let real = real_user_db();
    if real.exists() {
        if let Some(mode) = read_composer_unified_mode_at(&real, composer_id)? {
            info!(
                composer_id,
                mode = %mode,
                "read composer unifiedMode from real Cursor state.vscdb",
            );
            return Ok(Some(mode));
        }
    }

    debug!(composer_id, "no unifiedMode recorded for composer");
    Ok(None)
}

pub(super) fn read_composer_unified_mode_at(
    db_path: &Path,
    composer_id: &str,
) -> Result<Option<String>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let key = format!("{COMPOSER_DATA_KEY_PREFIX}{composer_id}");
    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&key],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        return Ok(None);
    };

    let parsed: ComposerDataBlob =
        serde_json::from_str(&json_text).map_err(|err| format!("parse {key} blob: {err}"))?;

    Ok(parsed.unified_mode.filter(|s| !s.is_empty()))
}

#[derive(Debug, Deserialize)]
pub(super) struct ComposerDataBlob {
    #[serde(default, rename = "modelConfig")]
    model_config: Option<ComposerModelConfig>,
    /// Wall-clock ms-epoch Cursor stamps every time the composer's
    /// state changes (new bubble appended, model switched, status
    /// flipped). Cheap freshness signal — comparing two snapshots
    /// of this field tells the poller whether to reload chunks.
    #[serde(default, rename = "lastUpdatedAt")]
    last_updated_at: Option<i64>,
    /// Set when Cursor flushes a conversation checkpoint (i.e. the
    /// LLM finished a turn). Always >= `lastUpdatedAt`; we take the
    /// max of the two so a new bubble arriving mid-turn isn't
    /// missed when only `lastUpdatedAt` advanced and we observed
    /// the row at exactly that instant.
    #[serde(default, rename = "conversationCheckpointLastUpdatedAt")]
    checkpoint_last_updated_at: Option<i64>,
    /// The composer's currently-selected unified mode (Cursor's
    /// internal name for what the picker calls Agent / Plan / Debug
    /// / Ask / Multitask / Project). Stored per-composer so the
    /// pill can reflect the same mode the user picked the last time
    /// they touched this chat.
    #[serde(default, rename = "unifiedMode")]
    unified_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ComposerModelConfig {
    #[serde(default, rename = "modelName")]
    model_name: Option<String>,
}
