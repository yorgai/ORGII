//! Offline-fallback reader for Cursor's available-model list.
//!
//! When the probe Cursor isn't running we still want the model picker
//! to show *something* — the user just opened our app, the picker
//! shouldn't be blank for the 5–10 s it takes the probe to spawn.
//!
//! Cursor mirrors its `applicationUserPersistentStorage` reactive
//! cell (which holds `availableDefaultModels2`) to a JSON blob in
//! `state.vscdb`'s `ItemTable` under a single canonical key. Reading
//! that blob is a synchronous SQLite SELECT; no Cursor process needed.
//!
//! ## What we read
//!
//! | Source | Key |
//! | ----- | ----- |
//! | Probe DB (preferred — same instance as the live CDP path) | `/tmp/orgii-cursor-probe-data/User/globalStorage/state.vscdb` |
//! | User's real Cursor (fallback — when the probe hasn't been seeded yet) | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
//!
//! Both locations use the *same* row key:
//! `src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser`
//!
//! That blob's `availableDefaultModels2` field is the same array
//! `modelConfigService.getAvailableDefaultModels()` reads at runtime,
//! minus the entitlement filtering. So this path can return *more*
//! models than the live one (e.g. `op-4.6-relay`, `kimi-k2.5`,
//! `claude-opus-4-7` show up here even when the user's plan doesn't
//! include them). The frontend deduplicates by `name`.
//!
//! ## Why we don't write
//!
//! Writing to Cursor's persistent storage from outside its process
//! would race against Cursor's own reactive flush. We strictly read
//! here and use the live CDP path (`set_model_for_composer`) for
//! mutations.

use std::path::{Path, PathBuf};

use cursor_bridge::{ModelCapabilities, ModelEntry};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tracing::{debug, info, warn};

/// Drop entries the user has hidden in Cursor's settings UI. Mutates
/// `models` in place to keep the call sites minimal — both live (CDP)
/// and offline (vscdb) paths run this at the end of `list_models` so
/// the picker matches what Cursor's own model picker would show.
///
/// Filter rule (see [`AiSettingsBlob`] for the spec): if the model's
/// `name` *or* any of its `aliases` is in `override_disabled`, hide
/// it; if any matches `override_enabled`, show it; otherwise fall
/// back to `defaultOn`. The alias check matters because Cursor
/// occasionally renames the canonical id (e.g. `gpt-5-codex` →
/// `gpt-5.3-codex`) and the toggle list keeps the older id.
pub fn apply_model_toggles(models: &mut Vec<ModelEntry>, toggles: &ModelToggles) {
    let before = models.len();
    models.retain(|model| {
        let names =
            std::iter::once(model.name.as_str()).chain(model.aliases.iter().map(String::as_str));
        toggles.is_visible(names, model.default_on)
    });
    if models.len() != before {
        debug!(
            before = before,
            after = models.len(),
            disabled = toggles.override_disabled.len(),
            enabled = toggles.override_enabled.len(),
            "applied user model toggles",
        );
    }
}

/// Row key Cursor writes the application-user reactive blob under.
const APPLICATION_USER_KEY: &str =
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";

/// Where the probe instance keeps its state. Mirrored from
/// `lifecycle::PROBE_DATA_DIR` so they don't drift; if the lifecycle
/// constant is changed both consts must move together (compile-time
/// guaranteed by the test below).
const PROBE_DB_PATH: &str = "/tmp/orgii-cursor-probe-data/User/globalStorage/state.vscdb";

/// Per-composer DKV row prefix. Concatenate with a UUID to get the
/// full key (`composerData:<uuid>`). The row's value is a JSON blob
/// holding everything Cursor remembers about that composer; we read
/// `modelConfig.modelName` to surface the session's last-used model.
const COMPOSER_DATA_KEY_PREFIX: &str = "composerData:";
const DEFAULT_MODEL_NAME: &str = "default";

/// Read Cursor's available-model list straight from `state.vscdb`.
///
/// Tries the probe DB first (it's the same instance that the live
/// CDP path would talk to, so disagreements are minimized). Falls
/// back to the user's real Cursor when the probe DB is missing or
/// has no model catalog yet.
///
/// Returns an empty vec (NOT an error) when neither DB exists yet;
/// that's the legitimate "Cursor not installed" state.
pub fn read_models_from_disk() -> Result<Vec<ModelEntry>, String> {
    let real = real_user_db();
    read_models_from_disk_candidates(&[Path::new(PROBE_DB_PATH), real.as_path()])
}

fn read_models_from_disk_candidates(paths: &[&Path]) -> Result<Vec<ModelEntry>, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }
        info!(path = %path.display(), "reading models from state.vscdb");
        let models = read_models_at(path)?;
        if has_model_catalog(&models) {
            return Ok(models);
        }
        debug!(
            path = %path.display(),
            count = models.len(),
            "state.vscdb has no complete model catalog; trying next candidate",
        );
    }

    warn!("no state.vscdb candidate contained a complete model catalog");
    Ok(Vec::new())
}

pub(crate) fn has_model_catalog(models: &[ModelEntry]) -> bool {
    models.iter().any(|model| model.name != DEFAULT_MODEL_NAME)
}

fn real_user_db() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/_unknown".to_string());
    PathBuf::from(home).join("Library/Application Support/Cursor/User/globalStorage/state.vscdb")
}

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

fn read_composer_model_at(db_path: &Path, composer_id: &str) -> Result<Option<String>, String> {
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

#[derive(Debug, Deserialize)]
struct ComposerDataBlob {
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

fn read_composer_last_updated_at_at(
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

fn read_composer_unified_mode_at(
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

fn read_models_at(db_path: &Path) -> Result<Vec<ModelEntry>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [APPLICATION_USER_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        warn!(
            path = %db_path.display(),
            key = APPLICATION_USER_KEY,
            "applicationUser blob missing — Cursor hasn't flushed the reactive cell yet"
        );
        return Ok(Vec::new());
    };
    debug!(bytes = json_text.len(), "loaded applicationUser blob");

    let parsed: ApplicationUserBlob = serde_json::from_str(&json_text)
        .map_err(|err| format!("parse {APPLICATION_USER_KEY} blob: {err}"))?;

    let raw = parsed.available_default_models2.unwrap_or_default();
    let count = raw.len();
    let projected: Vec<_> = raw.into_iter().map(project_raw_model).collect();
    debug!(
        raw_count = count,
        projected_count = projected.len(),
        "projected applicationUser models"
    );
    Ok(projected)
}

/// JSON shape of the row Cursor stores under `APPLICATION_USER_KEY`.
/// We read two fields: `availableDefaultModels2` (the catalog) and
/// `aiSettings` (where the user's per-model show/hide toggles live).
/// Everything else in this blob is unrelated user prefs we don't
/// care about, so `serde(default)` lets us survive schema drift.
#[derive(Debug, Deserialize)]
struct ApplicationUserBlob {
    #[serde(rename = "availableDefaultModels2", default)]
    available_default_models2: Option<Vec<RawModel>>,
    #[serde(rename = "aiSettings", default)]
    ai_settings: Option<AiSettingsBlob>,
}

/// Per-user toggles Cursor's settings UI writes to
/// `applicationUserPersistentStorage.aiSettings`.
///
/// The picker's effective "is this model shown?" rule is:
///
/// - If the model's `name` is in `modelOverrideDisabled` → user
///   explicitly hid it. Drop it.
/// - Otherwise, if it's in `modelOverrideEnabled` → user explicitly
///   surfaced it. Show it (overrides a `defaultOn = false` flag from
///   the server).
/// - Otherwise → fall back to the model's own `defaultOn`.
///
/// `modelOverrideDisabled` always wins, including over
/// `modelOverrideEnabled`, so a user can disable a model they
/// previously enabled and have it stay hidden.
#[derive(Debug, Deserialize, Default, Clone)]
struct AiSettingsBlob {
    #[serde(rename = "modelOverrideEnabled", default)]
    model_override_enabled: Vec<String>,
    #[serde(rename = "modelOverrideDisabled", default)]
    model_override_disabled: Vec<String>,
    /// Per-surface global default model picks. Cursor stores one row
    /// per surface (`composer`, `cmd-k`, `background-composer`, …);
    /// we only need `composer` because that's what a brand-new chat
    /// inherits when the user opens the picker without selecting
    /// anything. The literal `"default"` is a real model entry in
    /// `availableDefaultModels2` (renders as "Auto"), so we surface
    /// it as-is and let the picker translate.
    #[serde(rename = "modelConfig", default)]
    model_config: Option<AiSettingsModelConfig>,
}

#[derive(Debug, Deserialize, Default, Clone)]
struct AiSettingsModelConfig {
    #[serde(default)]
    composer: Option<AiSettingsSurfaceConfig>,
}

#[derive(Debug, Deserialize, Default, Clone)]
struct AiSettingsSurfaceConfig {
    #[serde(rename = "modelName", default)]
    model_name: Option<String>,
}

/// Effective per-user model show/hide toggles read from Cursor's
/// `applicationUserPersistentStorage.aiSettings`.
///
/// Public mirror of [`AiSettingsBlob`] with the same semantics — the
/// crate boundary keeps the on-disk schema private so we can rename
/// the JSON keys without churning callers.
#[derive(Debug, Default, Clone)]
pub struct ModelToggles {
    /// Models the user explicitly *surfaced* via Cursor settings —
    /// shown even when the catalog entry has `defaultOn = false`.
    pub override_enabled: Vec<String>,
    /// Models the user explicitly *hid* via Cursor settings —
    /// dropped from the picker even when `defaultOn = true`.
    pub override_disabled: Vec<String>,
}

impl ModelToggles {
    /// Apply the toggle policy described on [`AiSettingsBlob`] to
    /// decide whether `model_name` (with its server-side `defaultOn`
    /// flag) belongs in the picker.
    ///
    /// `name_aliases` should include the canonical name plus any
    /// `idAliases` / `legacySlugs` Cursor knows for the model — the
    /// settings UI writes whichever id was current when the user
    /// flipped the toggle, so a stale alias in the toggle list still
    /// has to match the live model.
    pub fn is_visible<'a>(
        &self,
        names: impl IntoIterator<Item = &'a str>,
        default_on: bool,
    ) -> bool {
        let names: Vec<&str> = names.into_iter().collect();
        if names
            .iter()
            .any(|n| self.override_disabled.iter().any(|d| d == *n))
        {
            return false;
        }
        if names
            .iter()
            .any(|n| self.override_enabled.iter().any(|e| e == *n))
        {
            return true;
        }
        default_on
    }
}

/// Read the user's per-model show/hide toggles from `state.vscdb`.
///
/// Same DB-pick policy as [`read_models_from_disk`]: probe instance
/// first (so live and offline reads agree on which Cursor we're
/// talking about), real Cursor DB second.
///
/// Returns `Ok(ModelToggles::default())` (an empty toggle set) when
/// neither DB exists yet — that's the legitimate "Cursor not
/// installed" state, and the empty-toggles case correctly degrades
/// to "show every model with `defaultOn = true`", which is what a
/// fresh Cursor install would do anyway.
pub fn read_model_toggles_from_disk() -> Result<ModelToggles, String> {
    let real = real_user_db();
    read_model_toggles_from_disk_candidates(&[Path::new(PROBE_DB_PATH), real.as_path()])
}

fn read_model_toggles_from_disk_candidates(paths: &[&Path]) -> Result<ModelToggles, String> {
    for path in paths {
        if !path.exists() {
            continue;
        }
        let Some((toggles, has_catalog)) = read_model_toggles_at(path)? else {
            continue;
        };
        if has_catalog {
            return Ok(toggles);
        }
        debug!(
            path = %path.display(),
            "state.vscdb has toggles but no complete model catalog; trying next candidate",
        );
    }

    Ok(ModelToggles::default())
}

fn read_model_toggles_at(db_path: &Path) -> Result<Option<(ModelToggles, bool)>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [APPLICATION_USER_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        return Ok(None);
    };

    let parsed: ApplicationUserBlob = serde_json::from_str(&json_text)
        .map_err(|err| format!("parse {APPLICATION_USER_KEY} blob: {err}"))?;
    let has_catalog = parsed
        .available_default_models2
        .as_deref()
        .is_some_and(has_raw_model_catalog);
    let settings = parsed.ai_settings.unwrap_or_default();
    debug!(
        path = %db_path.display(),
        enabled = settings.model_override_enabled.len(),
        disabled = settings.model_override_disabled.len(),
        has_catalog,
        "read aiSettings model toggles",
    );
    Ok(Some((
        ModelToggles {
            override_enabled: settings.model_override_enabled,
            override_disabled: settings.model_override_disabled,
        },
        has_catalog,
    )))
}

/// Read the user's *global* default model for the composer surface
/// from `applicationUser.aiSettings.modelConfig.composer.modelName`.
///
/// This is the model a brand-new Cursor chat inherits — what the
/// user last picked from the global model picker, not a per-composer
/// override. The picker pill in ORGII uses it to seed the displayed
/// label for the SessionCreator (no composer yet) and as a final
/// fallback when a per-composer model isn't recorded.
///
/// DB pick policy mirrors [`read_models_from_disk`] — probe instance
/// first, real Cursor DB second. Returns `Ok(None)` when neither DB
/// exists, the row is missing, or `modelName` is empty/whitespace.
/// The literal `"default"` is preserved as-is — that's a real entry
/// in `availableDefaultModels2` whose `clientDisplayName` is "Auto",
/// so the picker resolves the label naturally.
pub fn read_global_default_composer_model_from_disk() -> Result<Option<String>, String> {
    let probe = Path::new(PROBE_DB_PATH);
    if probe.exists() {
        if let Some(model) = read_global_default_composer_model_at(probe)? {
            info!(model_name = %model, "read global default composer model from probe state.vscdb");
            return Ok(Some(model));
        }
    }

    let real = real_user_db();
    if real.exists() {
        if let Some(model) = read_global_default_composer_model_at(&real)? {
            info!(model_name = %model, "read global default composer model from real Cursor state.vscdb");
            return Ok(Some(model));
        }
    }

    debug!("no global default composer model recorded");
    Ok(None)
}

fn read_global_default_composer_model_at(db_path: &Path) -> Result<Option<String>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("open {}: {err}", db_path.display()))?;

    let blob: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [APPLICATION_USER_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let Some(json_text) = blob else {
        return Ok(None);
    };

    let parsed: ApplicationUserBlob = serde_json::from_str(&json_text)
        .map_err(|err| format!("parse {APPLICATION_USER_KEY} blob: {err}"))?;
    Ok(parsed
        .ai_settings
        .and_then(|s| s.model_config)
        .and_then(|mc| mc.composer)
        .and_then(|c| c.model_name)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()))
}

fn has_raw_model_catalog(models: &[RawModel]) -> bool {
    models.iter().any(|model| model.name != DEFAULT_MODEL_NAME)
}

/// Cursor's per-model JSON shape. Unstable across releases — we
/// only deserialize the fields we project, with `serde(default)`
/// everywhere so a missing field is never an error. If Cursor adds
/// a new capability we want to surface it manually here; if it
/// removes one we surface `false` and the picker degrades gracefully.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawModel {
    name: String,
    #[serde(default)]
    server_model_name: Option<String>,
    #[serde(default)]
    client_display_name: Option<String>,
    #[serde(default, rename = "inputboxShortModelName")]
    inputbox_short_model_name: Option<String>,
    #[serde(default)]
    vendor: Option<RawVendor>,
    /// Top-level vendor slug (e.g. `"cursor"`, `"anthropic"`). Used as
    /// the last fallback when `vendor.{displayName, name, id}` are all
    /// missing or unhelpful.
    #[serde(default)]
    vendor_name: Option<String>,
    /// Some Cursor builds wrap this in a `{ value }` signal; on disk
    /// it's usually a plain int. We accept both via the manual
    /// projection below.
    #[serde(default)]
    degradation_status: Option<serde_json::Value>,
    #[serde(default)]
    default_on: bool,
    #[serde(default)]
    supports_agent: bool,
    #[serde(default)]
    supports_thinking: bool,
    #[serde(default)]
    supports_images: bool,
    #[serde(default)]
    supports_max_mode: bool,
    #[serde(default)]
    supports_non_max_mode: bool,
    #[serde(default)]
    supports_plan_mode: bool,
    #[serde(default)]
    supports_sandboxing: bool,
    #[serde(default)]
    supports_cmd_k: bool,
    #[serde(default)]
    id_aliases: Vec<String>,
    #[serde(default)]
    legacy_slugs: Vec<String>,
}

/// Cursor stores `vendor.id` as either a string slug (older builds:
/// `"anthropic"`) or an integer (current builds: `6`). We accept any
/// JSON scalar and normalize to a display string in `project_raw_model`.
///
/// `serde(rename_all = "camelCase")` is required: Cursor writes
/// `displayName` (camelCase) but the field is named `display_name`
/// (Rust snake_case convention). Without this attribute the
/// `displayName` key silently misses, falls through to the integer
/// `id` fallback, and ships `"6"` instead of `"Cursor"` for synthetic
/// rows like `default` / `premium` that lack a top-level `vendorName`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVendor {
    #[serde(default)]
    id: Option<serde_json::Value>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

/// Coerce a JSON scalar (`"foo"`, `6`, `3.14`) to a display string.
/// Returns `None` for arrays, objects, booleans, and nulls — those
/// shapes never appear in `vendor.id` in any Cursor build we've seen
/// and silently dropping them surfaces schema drift in logs instead of
/// papering over it with a misleading "true" / "[object]" label.
fn json_scalar_to_optional_string(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn project_raw_model(raw: RawModel) -> ModelEntry {
    let mut aliases = Vec::with_capacity(raw.id_aliases.len() + raw.legacy_slugs.len());
    aliases.extend(raw.id_aliases);
    aliases.extend(raw.legacy_slugs);

    // Vendor priority — prefer the lowercase brand slug because the
    // frontend uses it directly for icon lookup (matches our
    // `IconProvider` keys: `"anthropic"`, `"openai"`, `"google"`, …).
    //   1. top-level `vendorName`        (slug — canonical brand id)
    //   2. nested `vendor.displayName`   (capitalized — `"Anthropic"`)
    //   3. nested `vendor.name`          (older Cursor builds)
    //   4. nested `vendor.id`            (slug or integer; integer
    //      becomes a numeric string — last resort, better than
    //      dropping the model)
    let vendor = raw.vendor_name.or_else(|| {
        raw.vendor.and_then(|v| {
            v.display_name
                .or(v.name)
                .or_else(|| v.id.and_then(json_scalar_to_optional_string))
        })
    });

    let degradation_status = match raw.degradation_status {
        Some(serde_json::Value::Number(n)) => n.as_i64(),
        Some(serde_json::Value::Object(map)) => {
            // Reactive signal shape: `{ value: <int> }`.
            map.get("value").and_then(|v| v.as_i64())
        }
        _ => None,
    };

    ModelEntry {
        name: raw.name,
        server_model_name: raw.server_model_name,
        client_display_name: raw.client_display_name,
        inputbox_short_name: raw.inputbox_short_model_name,
        vendor,
        degradation_status,
        default_on: raw.default_on,
        capabilities: ModelCapabilities {
            agent: raw.supports_agent,
            thinking: raw.supports_thinking,
            images: raw.supports_images,
            max_mode: raw.supports_max_mode,
            non_max_mode: raw.supports_non_max_mode,
            plan_mode: raw.supports_plan_mode,
            sandbox: raw.supports_sandboxing,
            cmd_k: raw.supports_cmd_k,
        },
        aliases,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use tempfile::tempdir;

    fn make_db(tmp: &Path, blob: &str) -> PathBuf {
        make_named_db(tmp, "state.vscdb", blob)
    }

    fn make_named_db(tmp: &Path, file_name: &str, blob: &str) -> PathBuf {
        let path = tmp.join(file_name);
        let conn = Connection::open(&path).expect("open test db");
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .expect("create table");
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            params![APPLICATION_USER_KEY, blob],
        )
        .expect("insert blob");
        path
    }

    #[test]
    fn parses_minimal_blob() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [
                {
                    "name": "claude-opus-4-6",
                    "serverModelName": "claude-opus-4-6",
                    "clientDisplayName": "Opus 4.6",
                    "vendor": { "id": "anthropic" },
                    "supportsAgent": true,
                    "supportsThinking": true,
                    "supportsImages": true,
                    "idAliases": ["opus", "opus-4.6"],
                    "legacySlugs": ["claude-4.6-opus-low"],
                }
            ]
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let models = read_models_at(&path).expect("read");
        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.name, "claude-opus-4-6");
        assert_eq!(m.client_display_name.as_deref(), Some("Opus 4.6"));
        assert_eq!(m.vendor.as_deref(), Some("anthropic"));
        assert!(m.capabilities.agent);
        assert!(m.capabilities.thinking);
        assert!(m.capabilities.images);
        assert!(!m.capabilities.cmd_k);
        // Aliases combine id + legacy slugs in that order.
        assert_eq!(
            m.aliases,
            vec![
                "opus".to_string(),
                "opus-4.6".to_string(),
                "claude-4.6-opus-low".to_string(),
            ]
        );
    }

    /// Cursor 3.2+ (the build we ship against) writes `vendor.id`
    /// as an *integer* (e.g. `6` for the "Cursor" brand) rather than
    /// a string slug. A naïve `Option<String>` deserializer rejects
    /// the whole blob with `invalid type: integer, expected a string`.
    /// This guards against that regression.
    #[test]
    fn integer_vendor_id_does_not_break_parse() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [
                {
                    "name": "composer-2",
                    "vendorName": "cursor",
                    "vendor": { "id": 6, "displayName": "Cursor" },
                    "supportsAgent": true,
                }
            ]
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let models = read_models_at(&path).expect("read");
        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.name, "composer-2");
        // `vendorName` (the canonical brand slug) wins over the
        // capitalized `vendor.displayName`, so the frontend can use
        // it directly for icon lookup.
        assert_eq!(m.vendor.as_deref(), Some("cursor"));
    }

    /// Falls back to `vendor.displayName` when `vendorName` is absent
    /// — the case for the synthetic `default` and `premium` rows in
    /// the live blob that have no top-level `vendorName`.
    #[test]
    fn falls_back_to_vendor_display_name() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [
                {
                    "name": "default",
                    "vendor": { "id": 6, "displayName": "Cursor" },
                }
            ]
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let models = read_models_at(&path).expect("read");
        assert_eq!(models[0].vendor.as_deref(), Some("Cursor"));
    }

    #[test]
    fn missing_field_is_empty_list() {
        let tmp = tempdir().expect("tempdir");
        // Blob exists but no `availableDefaultModels2` field.
        let blob = "{}";
        let path = make_db(tmp.path(), blob);
        let models = read_models_at(&path).expect("read");
        assert!(models.is_empty());
    }

    #[test]
    fn missing_db_returns_empty() {
        let models =
            read_models_from_disk_candidates(&[Path::new("/tmp/no-such-cursor-db-orgii-test-123")])
                .expect("read");
        assert!(models.is_empty());
    }

    #[test]
    fn empty_probe_db_falls_back_to_real_cursor_db() {
        let tmp = tempdir().expect("tempdir");
        let empty_blob = "{}";
        let empty_probe = make_named_db(tmp.path(), "probe.vscdb", empty_blob);
        let real_blob = serde_json::json!({
            "availableDefaultModels2": [
                {
                    "name": "claude-sonnet-4.5",
                    "clientDisplayName": "Sonnet 4.5",
                    "defaultOn": true,
                    "vendorName": "anthropic"
                }
            ]
        })
        .to_string();
        let real = make_named_db(tmp.path(), "real.vscdb", &real_blob);

        let models = read_models_from_disk_candidates(&[&empty_probe, &real]).expect("read");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "claude-sonnet-4.5");
    }

    #[test]
    fn auto_only_probe_db_falls_back_to_real_cursor_db() {
        let tmp = tempdir().expect("tempdir");
        let probe_blob = serde_json::json!({
            "availableDefaultModels2": [
                { "name": "default", "clientDisplayName": "Auto", "defaultOn": true }
            ],
        })
        .to_string();
        let probe = make_named_db(tmp.path(), "probe.vscdb", &probe_blob);
        let real_blob = serde_json::json!({
            "availableDefaultModels2": [
                { "name": "default", "clientDisplayName": "Auto", "defaultOn": true },
                { "name": "claude-sonnet-4-6", "clientDisplayName": "Sonnet 4.6", "defaultOn": true }
            ],
        })
        .to_string();
        let real = make_named_db(tmp.path(), "real.vscdb", &real_blob);

        let models = read_models_from_disk_candidates(&[&probe, &real]).expect("read");
        let names: Vec<_> = models.iter().map(|model| model.name.as_str()).collect();

        assert_eq!(names, vec!["default", "claude-sonnet-4-6"]);
    }

    fn make_composer_db(tmp: &Path, composer_id: &str, blob: &str) -> PathBuf {
        let path = tmp.join("composer.vscdb");
        let conn = Connection::open(&path).expect("open test db");
        conn.execute(
            "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .expect("create table");
        let key = format!("{COMPOSER_DATA_KEY_PREFIX}{composer_id}");
        conn.execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)",
            params![key, blob],
        )
        .expect("insert blob");
        path
    }

    #[test]
    fn reads_composer_model_name() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "composerId": "abc-123",
            "modelConfig": {
                "modelName": "claude-sonnet-4.5",
                "maxMode": false,
            }
        })
        .to_string();
        let path = make_composer_db(tmp.path(), "abc-123", &blob);
        let model = read_composer_model_at(&path, "abc-123").expect("ok");
        assert_eq!(model.as_deref(), Some("claude-sonnet-4.5"));
    }

    #[test]
    fn missing_model_config_returns_none() {
        let tmp = tempdir().expect("tempdir");
        // Composer row exists but has no `modelConfig` (older builds).
        let blob = serde_json::json!({ "composerId": "abc-123" }).to_string();
        let path = make_composer_db(tmp.path(), "abc-123", &blob);
        let model = read_composer_model_at(&path, "abc-123").expect("ok");
        assert!(model.is_none());
    }

    #[test]
    fn missing_model_name_returns_none() {
        let tmp = tempdir().expect("tempdir");
        // `modelConfig` present but its `modelName` is empty — treat
        // the same as "not recorded" so the caller falls back to the
        // global default instead of showing an empty pill.
        let blob = serde_json::json!({
            "modelConfig": { "modelName": "", "maxMode": true }
        })
        .to_string();
        let path = make_composer_db(tmp.path(), "abc-123", &blob);
        let model = read_composer_model_at(&path, "abc-123").expect("ok");
        assert!(model.is_none());
    }

    #[test]
    fn missing_composer_row_returns_none() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({}).to_string();
        let path = make_composer_db(tmp.path(), "abc-123", &blob);
        // Query a different composer id — row absent.
        let model = read_composer_model_at(&path, "different-id").expect("ok");
        assert!(model.is_none());
    }

    #[test]
    fn empty_composer_id_is_rejected() {
        let err = read_composer_model_from_disk("").unwrap_err();
        assert!(err.contains("composer_id"));
    }

    #[test]
    fn last_updated_at_picks_max_of_both_fields() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "lastUpdatedAt": 1000_i64,
            "conversationCheckpointLastUpdatedAt": 2000_i64,
        })
        .to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let ts = read_composer_last_updated_at_at(&path, "abc").expect("ok");
        assert_eq!(ts, Some(2000));
    }

    #[test]
    fn last_updated_at_falls_back_to_single_field() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({ "lastUpdatedAt": 7777_i64 }).to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let ts = read_composer_last_updated_at_at(&path, "abc").expect("ok");
        assert_eq!(ts, Some(7777));
    }

    #[test]
    fn last_updated_at_missing_returns_none() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({ "composerId": "abc" }).to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let ts = read_composer_last_updated_at_at(&path, "abc").expect("ok");
        assert!(ts.is_none());
    }

    #[test]
    fn reads_composer_unified_mode() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "composerId": "abc",
            "unifiedMode": "plan",
            "forceMode": "edit",
        })
        .to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let mode = read_composer_unified_mode_at(&path, "abc").expect("ok");
        assert_eq!(mode.as_deref(), Some("plan"));
    }

    #[test]
    fn unified_mode_missing_returns_none() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({ "composerId": "abc" }).to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let mode = read_composer_unified_mode_at(&path, "abc").expect("ok");
        assert!(mode.is_none());
    }

    #[test]
    fn unified_mode_empty_string_returns_none() {
        let tmp = tempdir().expect("tempdir");
        // Treat an empty string the same as a missing field — we
        // never want the pill to render a blank mode label.
        let blob = serde_json::json!({ "unifiedMode": "" }).to_string();
        let path = make_composer_db(tmp.path(), "abc", &blob);
        let mode = read_composer_unified_mode_at(&path, "abc").expect("ok");
        assert!(mode.is_none());
    }

    #[test]
    fn unified_mode_empty_composer_id_is_rejected() {
        let err = read_composer_unified_mode_from_disk("").unwrap_err();
        assert!(err.contains("composer_id"));
    }

    fn entry(name: &str, default_on: bool, aliases: &[&str]) -> ModelEntry {
        ModelEntry {
            name: name.to_string(),
            server_model_name: None,
            client_display_name: None,
            inputbox_short_name: None,
            vendor: None,
            degradation_status: None,
            default_on,
            capabilities: ModelCapabilities::default(),
            aliases: aliases.iter().map(|a| a.to_string()).collect(),
        }
    }

    #[test]
    fn toggles_drop_explicitly_disabled_models() {
        let toggles = ModelToggles {
            override_enabled: vec![],
            override_disabled: vec!["claude-opus-4-6".to_string()],
        };
        let mut models = vec![
            entry("claude-opus-4-6", true, &[]),
            entry("claude-sonnet-4-6", true, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "claude-sonnet-4-6");
    }

    #[test]
    fn toggles_surface_explicitly_enabled_default_off_models() {
        let toggles = ModelToggles {
            override_enabled: vec!["op-4.6-relay".to_string()],
            override_disabled: vec![],
        };
        let mut models = vec![
            entry("default", true, &[]),
            entry("op-4.6-relay", false, &[]),
            entry("hidden-model", false, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["default", "op-4.6-relay"]);
    }

    #[test]
    fn disabled_wins_over_enabled() {
        // Sanity guard: if both lists name the same model the user
        // wanted it hidden — `modelOverrideDisabled` is the more
        // recent toggle write in Cursor's settings UI.
        let toggles = ModelToggles {
            override_enabled: vec!["gpt-5.5".to_string()],
            override_disabled: vec!["gpt-5.5".to_string()],
        };
        let mut models = vec![entry("gpt-5.5", true, &[])];
        apply_model_toggles(&mut models, &toggles);
        assert!(models.is_empty());
    }

    #[test]
    fn toggles_match_via_aliases() {
        // Cursor renamed `gpt-5-codex` → `gpt-5.3-codex` between
        // builds; the toggle list still records the old id. Make
        // sure the alias check catches it.
        let toggles = ModelToggles {
            override_enabled: vec![],
            override_disabled: vec!["gpt-5-codex".to_string()],
        };
        let mut models = vec![entry(
            "gpt-5.3-codex",
            true,
            &["gpt-5-codex", "codex-legacy"],
        )];
        apply_model_toggles(&mut models, &toggles);
        assert!(models.is_empty(), "alias hit should hide the model");
    }

    #[test]
    fn empty_toggles_keep_default_on_visibility() {
        let toggles = ModelToggles::default();
        let mut models = vec![
            entry("on-by-default", true, &[]),
            entry("off-by-default", false, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["on-by-default"]);
    }

    #[test]
    fn reads_ai_settings_toggles_from_blob() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [],
            "aiSettings": {
                "modelOverrideEnabled": ["op-4.6-relay", "o5.5-high"],
                "modelOverrideDisabled": ["claude-opus-4-6"],
            }
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let toggles = read_model_toggles_at(&path).expect("read").expect("some").0;
        assert_eq!(
            toggles.override_enabled,
            vec!["op-4.6-relay".to_string(), "o5.5-high".to_string()]
        );
        assert_eq!(
            toggles.override_disabled,
            vec!["claude-opus-4-6".to_string()]
        );
    }

    #[test]
    fn toggles_follow_complete_catalog_candidate() {
        let tmp = tempdir().expect("tempdir");
        let probe_blob = serde_json::json!({
            "availableDefaultModels2": [
                { "name": "default", "defaultOn": true }
            ],
            "aiSettings": {
                "modelOverrideEnabled": []
            }
        })
        .to_string();
        let probe = make_named_db(tmp.path(), "probe.vscdb", &probe_blob);
        let real_blob = serde_json::json!({
            "availableDefaultModels2": [
                { "name": "default", "defaultOn": true },
                { "name": "op-4.6-relay", "defaultOn": false }
            ],
            "aiSettings": {
                "modelOverrideEnabled": ["op-4.6-relay"]
            }
        })
        .to_string();
        let real = make_named_db(tmp.path(), "real.vscdb", &real_blob);

        let toggles = read_model_toggles_from_disk_candidates(&[&probe, &real]).expect("read");

        assert_eq!(toggles.override_enabled, vec!["op-4.6-relay".to_string()]);
    }

    #[test]
    fn reads_global_default_composer_model() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [],
            "aiSettings": {
                "modelConfig": {
                    "composer": { "modelName": "op-4.6-relay" },
                    "cmd-k":   { "modelName": "default" },
                }
            }
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let model = read_global_default_composer_model_at(&path)
            .expect("ok")
            .expect("some");
        assert_eq!(model, "op-4.6-relay");
    }

    #[test]
    fn global_default_preserves_auto_sentinel() {
        // `"default"` is a real entry in `availableDefaultModels2`
        // (its `clientDisplayName` is "Auto"), so the picker resolves
        // it to a friendly label downstream — we must not strip it.
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "aiSettings": {
                "modelConfig": { "composer": { "modelName": "default" } }
            }
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let model = read_global_default_composer_model_at(&path)
            .expect("ok")
            .expect("some");
        assert_eq!(model, "default");
    }

    #[test]
    fn global_default_missing_branches_return_none() {
        let tmp = tempdir().expect("tempdir");

        // Missing `aiSettings` entirely.
        let path = make_db(
            tmp.path(),
            &serde_json::json!({ "availableDefaultModels2": [] }).to_string(),
        );
        assert!(read_global_default_composer_model_at(&path)
            .expect("ok")
            .is_none());

        // `aiSettings` present but no `modelConfig`.
        let tmp2 = tempdir().expect("tempdir");
        let path2 = make_db(
            tmp2.path(),
            &serde_json::json!({ "aiSettings": { "modelOverrideEnabled": [] } }).to_string(),
        );
        assert!(read_global_default_composer_model_at(&path2)
            .expect("ok")
            .is_none());

        // `modelConfig.composer` present but `modelName` is empty —
        // treat as "user hasn't picked anything yet".
        let tmp3 = tempdir().expect("tempdir");
        let path3 = make_db(
            tmp3.path(),
            &serde_json::json!({
                "aiSettings": { "modelConfig": { "composer": { "modelName": "  " } } }
            })
            .to_string(),
        );
        assert!(read_global_default_composer_model_at(&path3)
            .expect("ok")
            .is_none());
    }

    #[test]
    fn missing_ai_settings_returns_empty_toggles() {
        let tmp = tempdir().expect("tempdir");
        // `applicationUser` blob exists but has no `aiSettings` —
        // older Cursor builds, or a fresh install before the user
        // touched any model toggle. Surface as empty (no filtering).
        let blob = serde_json::json!({ "availableDefaultModels2": [] }).to_string();
        let path = make_db(tmp.path(), &blob);
        let toggles = read_model_toggles_at(&path).expect("read").expect("some").0;
        assert!(toggles.override_enabled.is_empty());
        assert!(toggles.override_disabled.is_empty());
    }

    #[test]
    fn apply_model_toggles_handles_empty_input() {
        // Sanity: filter must be a no-op on an empty list. The live
        // CDP path can briefly return `[]` while Cursor is still
        // loading its catalog; we want no panic, no allocation churn.
        let toggles = ModelToggles {
            override_enabled: vec!["foo".into()],
            override_disabled: vec!["bar".into()],
        };
        let mut models: Vec<ModelEntry> = vec![];
        apply_model_toggles(&mut models, &toggles);
        assert!(models.is_empty());
    }

    #[test]
    fn apply_model_toggles_ignores_stale_toggle_names() {
        // Cursor doesn't clean `aiSettings.modelOverride{Enabled,
        // Disabled}` when a model is retired from the catalog — the
        // stale id can sit on the toggle list indefinitely. Our
        // filter must shrug those off rather than mis-filtering an
        // unrelated model that happens to have a similar prefix.
        let toggles = ModelToggles {
            override_enabled: vec!["nonexistent-model".to_string()],
            override_disabled: vec!["also-gone".to_string()],
        };
        let mut models = vec![
            entry("claude-sonnet-4-6", true, &[]),
            entry("composer-2", true, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["claude-sonnet-4-6", "composer-2"]);
    }

    #[test]
    fn apply_model_toggles_preserves_order() {
        // The picker UI relies on backend ordering — Cursor sorts
        // its catalog by `namedModelSectionIndex` and we surface
        // that order verbatim. `Vec::retain` is order-preserving
        // (documented stdlib contract); pin the behavior so a
        // future refactor to e.g. `iter().filter().collect()` into
        // an unordered set is caught here.
        let toggles = ModelToggles {
            override_enabled: vec![],
            override_disabled: vec!["mid".to_string()],
        };
        let mut models = vec![
            entry("first", true, &[]),
            entry("mid", true, &[]),
            entry("last", true, &[]),
            entry("after-last", true, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["first", "last", "after-last"]);
    }

    #[test]
    fn application_user_row_missing_returns_none() {
        // `read_model_toggles_at` returns `Ok(None)` when the
        // `applicationUser` row is absent (DB exists but Cursor
        // hasn't flushed the reactive cell yet — first launch state).
        // The multi-DB fallback in `read_model_toggles_from_disk`
        // depends on this so it can move on to the next candidate.
        let tmp = tempdir().expect("tempdir");
        let path = tmp.path().join("state.vscdb");
        let conn = Connection::open(&path).expect("open test db");
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .expect("create table");
        // Insert *some* row so the DB isn't empty, but not the
        // applicationUser row we're looking for.
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            params!["unrelated.key", "{}"],
        )
        .expect("insert unrelated");
        let result = read_model_toggles_at(&path).expect("read");
        assert!(
            result.is_none(),
            "missing row must be Ok(None), not Ok(Some(empty))"
        );
    }

    #[test]
    fn partial_ai_settings_treats_missing_lists_as_empty() {
        // Guards the `serde(default)` annotations on
        // `AiSettingsBlob`. If someone removes them the parse will
        // fail with `missing field` and the toggle read silently
        // fails for every user whose settings happen to omit the
        // field — exactly the regression this catches.
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "aiSettings": {
                "modelOverrideEnabled": ["op-4.6-relay"],
                // modelOverrideDisabled deliberately omitted
            }
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);
        let toggles = read_model_toggles_at(&path).expect("read").expect("some").0;
        assert_eq!(toggles.override_enabled, vec!["op-4.6-relay".to_string()]);
        assert!(toggles.override_disabled.is_empty());
    }

    #[test]
    fn is_visible_pins_three_branch_logic() {
        // Direct unit test of the public method. The branches are
        // already exercised through `apply_model_toggles_*` but the
        // method is part of the crate's public surface, so pinning
        // it directly catches a refactor that accidentally inverts
        // a check or short-circuits early.
        let toggles = ModelToggles {
            override_enabled: vec!["enabled-only".to_string()],
            override_disabled: vec!["disabled-only".to_string()],
        };
        // Branch 1: in disabled list → hidden regardless of default_on.
        assert!(!toggles.is_visible(["disabled-only"], true));
        assert!(!toggles.is_visible(["disabled-only"], false));
        // Branch 2: in enabled list → visible regardless of default_on.
        assert!(toggles.is_visible(["enabled-only"], false));
        assert!(toggles.is_visible(["enabled-only"], true));
        // Branch 3: not in either → defer to default_on.
        assert!(toggles.is_visible(["unrelated"], true));
        assert!(!toggles.is_visible(["unrelated"], false));
    }

    #[test]
    fn default_off_with_explicit_disable_stays_hidden() {
        // No-op redundant case — a model that's off-by-default and
        // also explicitly disabled. Filter should still drop it
        // (not accidentally "double-negative"-resurrect it).
        let toggles = ModelToggles {
            override_enabled: vec![],
            override_disabled: vec!["already-off".to_string()],
        };
        let mut models = vec![entry("already-off", false, &[])];
        apply_model_toggles(&mut models, &toggles);
        assert!(models.is_empty());
    }

    #[test]
    fn enabled_alias_match_surfaces_default_off_model() {
        // Mirror of `toggles_match_via_aliases` for the enable path.
        // Cursor's settings UI writes the toggle under whichever id
        // was current at the time. If the model later gets a new
        // canonical name, the alias check has to resolve the older
        // id against the new entry, otherwise the user-enabled
        // model silently disappears from the picker after a Cursor
        // upgrade.
        let toggles = ModelToggles {
            override_enabled: vec!["op-relay".to_string()],
            override_disabled: vec![],
        };
        let mut models = vec![entry(
            "op-4.6-relay",
            false,
            &["op-relay", "op-relay-legacy"],
        )];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["op-4.6-relay"],
            "alias hit on enabled list should surface a default-off model",
        );
    }

    #[test]
    fn duplicate_toggle_entries_are_idempotent() {
        // Defensive: Cursor *probably* won't write duplicates but
        // the file is a JSON list with no uniqueness constraint, so
        // a corrupt write or merge-on-sync could end up with the
        // same id twice. Filter must behave the same as if it were
        // listed once.
        let toggles = ModelToggles {
            override_enabled: vec!["x".to_string(), "x".to_string()],
            override_disabled: vec!["y".to_string(), "y".to_string(), "y".to_string()],
        };
        let mut models = vec![
            entry("x", false, &[]),
            entry("y", true, &[]),
            entry("z", true, &[]),
        ];
        apply_model_toggles(&mut models, &toggles);
        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec!["x", "z"]);
    }

    #[test]
    fn malformed_application_user_blob_surfaces_parse_error() {
        // The `applicationUser` row is opaque JSON Cursor can change
        // freely. We swallow shape drift for unknown fields via
        // `serde(default)`, but actual JSON syntax errors must
        // bubble up — silently returning empty toggles would mask
        // a real DB corruption from the operator.
        let tmp = tempdir().expect("tempdir");
        let path = make_db(tmp.path(), "{not valid json");
        let err = read_model_toggles_at(&path).unwrap_err();
        assert!(err.contains("parse"), "expected a parse error, got: {err}",);
    }

    /// Integration test: read the catalog and the toggles from the
    /// same DB blob and combine them. This is the exact pipeline
    /// `cursor_bridge_list_models` runs on the disk path —
    /// the unit tests above each cover one piece, but only this
    /// test pins the wiring (do we read from the same blob? do we
    /// apply the filter to the read list, not a stale copy?).
    #[test]
    fn disk_pipeline_combines_catalog_and_toggles() {
        let tmp = tempdir().expect("tempdir");
        let blob = serde_json::json!({
            "availableDefaultModels2": [
                { "name": "default", "defaultOn": true },
                { "name": "claude-sonnet-4-6", "defaultOn": true },
                { "name": "claude-opus-4-6", "defaultOn": true },
                { "name": "op-4.6-relay", "defaultOn": false },
                { "name": "off-and-not-enabled", "defaultOn": false },
            ],
            "aiSettings": {
                "modelOverrideEnabled": ["op-4.6-relay"],
                "modelOverrideDisabled": ["claude-opus-4-6"],
            }
        })
        .to_string();
        let path = make_db(tmp.path(), &blob);

        let mut models = read_models_at(&path).expect("read models");
        let toggles = read_model_toggles_at(&path)
            .expect("read toggles")
            .expect("some")
            .0;
        apply_model_toggles(&mut models, &toggles);

        let names: Vec<_> = models.iter().map(|m| m.name.as_str()).collect();
        // - "default", "claude-sonnet-4-6": default_on=true, no toggle → keep.
        // - "claude-opus-4-6": default_on=true, in disabled list → drop.
        // - "op-4.6-relay": default_on=false, in enabled list → keep.
        // - "off-and-not-enabled": default_on=false, no toggle → drop.
        // Order: same as catalog order.
        assert_eq!(names, vec!["default", "claude-sonnet-4-6", "op-4.6-relay"],);
    }
}
