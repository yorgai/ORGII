//! Read + write Cursor's per-composer **unified mode** (Agent / Plan
//! / Debug / Ask / Multitask / Project).
//!
//! ## What "unified mode" means
//!
//! Cursor's chat surfaces share one mode picker — the dropdown next to
//! the model pill that says **Agent / Plan / Debug / Ask / Multitask
//! / Project**. The selected entry controls which tools the model can
//! call, whether edits auto-apply, and which background "auto-fix"
//! flows kick in. Internally Cursor calls this `unifiedMode` and
//! stores it per-composer in `composerData:<uuid>.unifiedMode`.
//!
//! ## How Cursor exposes the picker
//!
//! There's a dedicated `composerModesService` (registered in the same
//! `instantiationService` registry as `modelConfigService`) with two
//! methods we need:
//!
//! - `getAllModes()` — returns the list of `{id, name, actionId,
//!   icon, description, ...}` descriptors. The set is ordered the
//!   same way the picker shows them.
//! - `setComposerUnifiedMode(handle, modeId)` — flips the active
//!   mode for a specific composer handle. This is the same call
//!   Cursor's own UI fires when the user picks a mode.
//!
//! The `background` mode is hidden from the picker by Cursor's own
//! UI (`getAllModes().filter(m => m.id !== "background")`), so we
//! mirror that filter here.
//!
//! ## Why we re-project rather than passing through verbatim
//!
//! Same reason as `models.rs`: the runtime descriptor objects pull
//! in observable wrappers, function references, and version-specific
//! shape variation. We project to a small stable [`ModeEntry`] keyed
//! on what the picker UI actually needs.

use serde_json::json;
use tracing::debug;

use crate::cdp::CdpClient;
use crate::error::{CdpError, Result};
use crate::workbench;

/// One entry in the Cursor mode picker.
///
/// - `id`: canonical mode id Cursor uses internally (`"agent"`,
///   `"plan"`, `"debug"`, `"chat"`, `"multitask"`, `"project"`).
///   Stable across UI label tweaks; this is what we pass to
///   `setComposerUnifiedMode`.
/// - `name`: human label as it appears in Cursor's dropdown.
///   Note Cursor displays `id == "chat"` as **"Ask"** — we surface
///   whatever Cursor's own descriptor says.
/// - `description`: one-line subtitle shown under the name.
/// - `icon`: Cursor's internal codicon id (`"infinity"`, `"todos"`,
///   `"bug"`, etc.). We keep it as a hint for the UI even though our
///   own picker uses lucide icons keyed on `id`.
/// - `action_id`: VS Code command id Cursor's keybindings target
///   (e.g. `"composerMode.agent"`). Kept for potential future
///   "open the same mode keybinding the user configured" flows.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub action_id: Option<String>,
}

/// Read Cursor's available unified-mode list from the live probe
/// instance.
///
/// Returns whatever `composerModesService.getAllModes()` produces
/// *right now*, projected to [`ModeEntry`]. We drop the
/// `"background"` entry to mirror Cursor's own picker filter — that
/// mode is reachable through the cloud-runs surface, not the
/// per-composer dropdown.
pub async fn list_modes(client: &CdpClient) -> Result<Vec<ModeEntry>> {
    let expression = format!(
        r#"
    (() => {{
      {prelude}
      const is = findInstantiationService();
      const cms = lookupService(is, "composerModesService");
      if (!cms) throw new Error("composerModesService not registered");
      const arr = cms.getAllModes();
      if (!Array.isArray(arr)) throw new Error("getAllModes did not return an array");

      // Project to a stable shape and drop "background" — Cursor's UI
      // hides it from the per-composer picker (it's a cloud-run mode,
      // not a chat mode), and we want our picker to match exactly.
      return arr
        .filter(m => m && typeof m.id === "string" && m.id !== "background")
        .map(m => ({{
          id: String(m.id),
          name: typeof m.name === "string" ? m.name : String(m.id),
          description: typeof m.description === "string" ? m.description : null,
          icon: typeof m.icon === "string" ? m.icon : null,
          actionId: typeof m.actionId === "string" ? m.actionId : null,
        }}));
    }})()
    "#,
        prelude = workbench::PRELUDE
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            let value = result.value.unwrap_or(json!([]));
            let parsed: Vec<ModeEntry> =
                serde_json::from_value(value.clone()).map_err(|source| {
                    CdpError::MalformedResponse {
                        context: format!("list_modes response not deserializable: {source}"),
                        body: value.to_string(),
                    }
                })?;
            debug!(count = parsed.len(), "list_modes from CDP");
            Ok(parsed)
        }
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "list_modes eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}

/// Set the unified mode for `composer_id` in the probe Cursor.
///
/// Mirrors `models::set_model_for_composer` — we look up the
/// composer handle via `composerDataService.getComposerHandleById`
/// and call `composerModesService.setComposerUnifiedMode(handle,
/// modeId)`, which is the same path Cursor's own picker fires.
///
/// **Validation.** We reject mode ids that aren't in the live
/// `getAllModes()` list — passing an unknown id silently no-ops
/// inside Cursor (worse: with version drift it could trip an
/// assertion deeper in the stack), so we'd rather surface a clean
/// error than leave the user staring at an unchanged picker.
///
/// **Why per-composer, not global.** Unlike the model picker, mode
/// is *always* per-composer — there's no global "default mode"
/// surface to fall through to. If we can't resolve the handle for
/// `composer_id` we surface the failure rather than silently
/// applying the change to the active composer (which might be a
/// different chat than the user expected).
pub async fn set_mode_for_composer(
    client: &CdpClient,
    composer_id: &str,
    mode_id: &str,
) -> Result<()> {
    let escaped_mode = serde_json::to_string(mode_id).expect("string serializes");
    let escaped_composer = serde_json::to_string(composer_id).expect("string serializes");
    let expression = format!(
        r#"
    (() => {{
      {prelude}
      const is = findInstantiationService();
      const cms = lookupService(is, "composerModesService");
      if (!cms) throw new Error("composerModesService not registered");

      // Validate against the live mode list — passing an unknown id
      // silently no-ops inside Cursor.
      const modes = cms.getAllModes();
      const known = Array.isArray(modes) && modes.some(m => m && m.id === {mode});
      if (!known) throw new Error("mode " + {mode} + " not in getAllModes()");

      const cds = lookupService(is, "composerDataService");
      if (!cds || typeof cds.getComposerHandleById !== "function") {{
        throw new Error("composerDataService.getComposerHandleById not available");
      }}
      const handle = cds.getComposerHandleById({composer});
      if (!handle) throw new Error("no composer handle for id " + {composer});

      if (typeof cms.setComposerUnifiedMode !== "function") {{
        throw new Error("setComposerUnifiedMode not on composerModesService");
      }}
      cms.setComposerUnifiedMode(handle, {mode});
      return {{ ok: true }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
        mode = escaped_mode,
        composer = escaped_composer,
    );

    match client.evaluate(&expression).await? {
        Ok(_) => Ok(()),
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "set_mode_for_composer eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}
