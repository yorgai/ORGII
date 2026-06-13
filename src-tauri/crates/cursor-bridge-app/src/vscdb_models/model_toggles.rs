//! User model show/hide toggles and the global default composer model.

use std::path::Path;

use cursor_bridge::ModelEntry;
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use tracing::{debug, info};

use super::db_path::{real_user_db, APPLICATION_USER_KEY, PROBE_DB_PATH};
use super::model_catalog::has_raw_model_catalog;

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
        tracing::debug!(
            before = before,
            after = models.len(),
            disabled = toggles.override_disabled.len(),
            enabled = toggles.override_enabled.len(),
            "applied user model toggles",
        );
    }
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
pub(super) struct AiSettingsBlob {
    #[serde(rename = "modelOverrideEnabled", default)]
    pub(super) model_override_enabled: Vec<String>,
    #[serde(rename = "modelOverrideDisabled", default)]
    pub(super) model_override_disabled: Vec<String>,
    /// Per-surface global default model picks. Cursor stores one row
    /// per surface (`composer`, `cmd-k`, `background-composer`, …);
    /// we only need `composer` because that's what a brand-new chat
    /// inherits when the user opens the picker without selecting
    /// anything. The literal `"default"` is a real model entry in
    /// `availableDefaultModels2` (renders as "Auto"), so we surface
    /// it as-is and let the picker translate.
    #[serde(rename = "modelConfig", default)]
    pub(super) model_config: Option<AiSettingsModelConfig>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub(super) struct AiSettingsModelConfig {
    #[serde(default)]
    pub(super) composer: Option<AiSettingsSurfaceConfig>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub(super) struct AiSettingsSurfaceConfig {
    #[serde(rename = "modelName", default)]
    pub(super) model_name: Option<String>,
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

pub(super) fn read_model_toggles_from_disk_candidates(
    paths: &[&Path],
) -> Result<ModelToggles, String> {
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

pub(super) fn read_model_toggles_at(
    db_path: &Path,
) -> Result<Option<(ModelToggles, bool)>, String> {
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

    let parsed: super::model_catalog::ApplicationUserBlob = serde_json::from_str(&json_text)
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

pub(super) fn read_global_default_composer_model_at(
    db_path: &Path,
) -> Result<Option<String>, String> {
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

    let parsed: super::model_catalog::ApplicationUserBlob = serde_json::from_str(&json_text)
        .map_err(|err| format!("parse {APPLICATION_USER_KEY} blob: {err}"))?;
    Ok(parsed
        .ai_settings
        .and_then(|s| s.model_config)
        .and_then(|mc| mc.composer)
        .and_then(|c| c.model_name)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()))
}
