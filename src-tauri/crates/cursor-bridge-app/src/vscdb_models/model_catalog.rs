//! Read Cursor's available-model catalog from `state.vscdb`.

use std::path::Path;

use cursor_bridge::{ModelCapabilities, ModelEntry};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tracing::{debug, info, warn};

use super::db_path::{real_user_db, APPLICATION_USER_KEY, DEFAULT_MODEL_NAME, PROBE_DB_PATH};

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

pub(super) fn read_models_from_disk_candidates(paths: &[&Path]) -> Result<Vec<ModelEntry>, String> {
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

pub fn has_model_catalog(models: &[ModelEntry]) -> bool {
    models.iter().any(|model| model.name != DEFAULT_MODEL_NAME)
}

pub(super) fn has_raw_model_catalog(models: &[RawModel]) -> bool {
    models.iter().any(|model| model.name != DEFAULT_MODEL_NAME)
}

pub(super) fn read_models_at(db_path: &Path) -> Result<Vec<ModelEntry>, String> {
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
pub(super) struct ApplicationUserBlob {
    #[serde(rename = "availableDefaultModels2", default)]
    pub(super) available_default_models2: Option<Vec<RawModel>>,
    #[serde(rename = "aiSettings", default)]
    pub(super) ai_settings: Option<super::model_toggles::AiSettingsBlob>,
}

/// Cursor's per-model JSON shape. Unstable across releases — we
/// only deserialize the fields we project, with `serde(default)`
/// everywhere so a missing field is never an error. If Cursor adds
/// a new capability we want to surface it manually here; if it
/// removes one we surface `false` and the picker degrades gracefully.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawModel {
    pub(super) name: String,
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
