//! Read + write Cursor's available LLM model list.
//!
//! ## Why this exists
//!
//! Cursor's catalog of available models changes frequently — the
//! server pushes new entries (e.g. `claude-opus-4-7`, `gpt-5.5`)
//! between user sessions, and capability flags (`supportsAgent`,
//! `supportsThinking`, `supportsMaxMode`, …) shift as Cursor rolls
//! features in and out. We don't want to ship a stale hardcoded list;
//! we want to read whatever the user's Cursor knows about *right now*.
//!
//! ## Where the list comes from
//!
//! Cursor's `modelConfigService.getAvailableDefaultModels()` is the
//! single source of truth for "what shows up in the Cursor model
//! picker". Disassembling its body reveals it just reads a reactive
//! storage cell:
//!
//! ```js
//! getAvailableDefaultModels() {
//!   const e = this.reactiveStorageService
//!     .applicationUserPersistentStorage
//!     .availableDefaultModels2 ?? [];
//!   return e.length === 0
//!     ? [...qze]                       // bundled fallback
//!     : (e.some(t => t.name === "default") ? e : [...e, ...qze]);
//! }
//! ```
//!
//! That cell is mirrored to disk in `state.vscdb`'s `ItemTable` under
//! the key
//! `src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser`,
//! so we have **two complementary read paths**:
//!
//! 1. **Live (this module)**: ask the running probe Cursor via CDP.
//!    Always returns the same list the user would see if they opened
//!    Cursor's own picker right now (post entitlement filtering).
//! 2. **Offline (in `cursor_bridge::vscdb_models`)**: read the
//!    on-disk JSON blob directly. Returns the *broader* set
//!    (entitlement-gated entries included), so the result can be a
//!    superset of the live list. Used as a fallback when the probe
//!    isn't running.
//!
//! ## Why we re-project rather than passing through verbatim
//!
//! Each model object in Cursor's runtime is ~50 fields deep, includes
//! observable signals (`{ value: … }` wrappers), function references,
//! and version-specific shape variation. Pretending to model that on
//! the TypeScript side would mean a brittle 1-to-1 mirror of an
//! internal API. We project to a small, stable shape
//! ([`ModelEntry`]) keyed on what the model picker UI actually needs.

use serde_json::json;
use tracing::debug;

use crate::cdp::CdpClient;
use crate::error::{CdpError, Result};
use crate::workbench;

/// One model entry as projected for our model picker.
///
/// Field meanings:
/// - `name`: canonical id Cursor uses internally (e.g.
///   `"claude-opus-4-6"`). Stable across UI label tweaks; this is
///   what we pass to `setSpecificModel`.
/// - `server_model_name`: what Cursor sends as the `model` field on
///   API requests. Usually equal to `name`; may differ when Cursor
///   has aliased a "client-friendly" id to a backend model.
/// - `client_display_name`: full label for the picker (e.g.
///   `"Opus 4.6"`).
/// - `inputbox_short_name`: compact label for the chat input pill
///   (e.g. `"Opus 4.6"` — usually identical to `client_display_name`
///   but Cursor occasionally truncates the longer one).
/// - `vendor`: brand string (e.g. `"anthropic"`, `"openai"`,
///   `"google"`, `"xai"`, `"cursor"`). Sourced from
///   `model.vendor.id ?? model.vendor.name`. May be empty.
/// - `degradation_status`: numeric flag from Cursor's server (0 =
///   healthy, non-zero = throttled/down). Surfaced so the UI can dim
///   degraded entries.
/// - `default_on`: whether Cursor enables this model by default in
///   the picker.
/// - `capabilities`: small TS-friendly subset of Cursor's per-model
///   `supports*` flags.
/// - `aliases`: every alternate id we've seen for this model
///   (Cursor's `idAliases` plus `legacySlugs`). Used for matching
///   user-typed model names against Cursor's catalog.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub name: String,
    #[serde(default)]
    pub server_model_name: Option<String>,
    #[serde(default)]
    pub client_display_name: Option<String>,
    #[serde(default)]
    pub inputbox_short_name: Option<String>,
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub degradation_status: Option<i64>,
    #[serde(default)]
    pub default_on: bool,
    #[serde(default)]
    pub capabilities: ModelCapabilities,
    #[serde(default)]
    pub aliases: Vec<String>,
}

/// Per-model capability flags. Mirrors the subset of Cursor's
/// `supports*` booleans that the model picker UI needs to decide
/// whether to show a model for a given context.
///
/// `agent` — model can drive Cursor agent (multi-tool loop). Picker
/// hides non-agent models when launching a chat with tools enabled.
/// `thinking` — model has a long-form reasoning mode (Opus thinking,
/// o-series). UI surfaces a "thinking" badge.
/// `images` — accepts image inputs. UI hides image-attachment options
/// for non-image models.
/// `max_mode` — supports Cursor's "Max" output budget toggle.
/// `non_max_mode` — supports the standard (non-Max) output budget.
/// `plan_mode` — supports Cursor's plan-only mode.
/// `sandbox` — accepts the sandbox-execution flag.
/// `cmd_k` — eligible for Cursor's Cmd-K inline edits.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    #[serde(default)]
    pub agent: bool,
    #[serde(default)]
    pub thinking: bool,
    #[serde(default)]
    pub images: bool,
    #[serde(default)]
    pub max_mode: bool,
    #[serde(default)]
    pub non_max_mode: bool,
    #[serde(default)]
    pub plan_mode: bool,
    #[serde(default)]
    pub sandbox: bool,
    #[serde(default)]
    pub cmd_k: bool,
}

/// Read Cursor's available-model list from the live probe instance.
///
/// Returns whatever `modelConfigService.getAvailableDefaultModels()`
/// produces *right now*, projected to [`ModelEntry`]. This is the
/// list the user would see if they opened Cursor's model picker
/// directly — entitlement filtering, server-pushed updates, and
/// degradation flags all reflect the current state.
pub async fn list_models(client: &CdpClient) -> Result<Vec<ModelEntry>> {
    let expression = format!(
        r#"
    (() => {{
      {prelude}
      const is = findInstantiationService();
      const mcs = lookupService(is, "modelConfigService");
      if (!mcs) throw new Error("modelConfigService not registered");
      const arr = mcs.getAvailableDefaultModels();
      if (!Array.isArray(arr)) throw new Error("getAvailableDefaultModels did not return an array");

      // Project each entry to the stable shape. We deliberately ignore
      // unknown fields — Cursor adds new ones every release and we'd
      // rather degrade gracefully than fail validation.
      const readMaybeSignal = (v) => (v && typeof v === "object" && "value" in v) ? v.value : v;
      const out = arr.map(m => {{
        const aliases = [];
        if (Array.isArray(m.idAliases)) for (const a of m.idAliases) if (typeof a === "string") aliases.push(a);
        if (Array.isArray(m.legacySlugs)) for (const a of m.legacySlugs) if (typeof a === "string") aliases.push(a);
        return {{
          name: String(m.name),
          serverModelName: typeof m.serverModelName === "string" ? m.serverModelName : null,
          clientDisplayName: typeof m.clientDisplayName === "string" ? m.clientDisplayName : null,
          inputboxShortName: typeof m.inputboxShortModelName === "string" ? m.inputboxShortModelName : null,
          vendor: m.vendor ? (m.vendor.id ?? m.vendor.name ?? null) : null,
          degradationStatus: typeof readMaybeSignal(m.degradationStatus) === "number"
            ? readMaybeSignal(m.degradationStatus)
            : null,
          defaultOn: !!m.defaultOn,
          capabilities: {{
            agent: !!m.supportsAgent,
            thinking: !!m.supportsThinking,
            images: !!m.supportsImages,
            maxMode: !!m.supportsMaxMode,
            nonMaxMode: !!m.supportsNonMaxMode,
            planMode: !!m.supportsPlanMode,
            sandbox: !!m.supportsSandboxing,
            cmdK: !!m.supportsCmdK,
          }},
          aliases,
        }};
      }});
      return out;
    }})()
    "#,
        prelude = workbench::PRELUDE
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            let value = result.value.unwrap_or(json!([]));
            let parsed: Vec<ModelEntry> =
                serde_json::from_value(value.clone()).map_err(|source| {
                    CdpError::MalformedResponse {
                        context: format!("list_models response not deserializable: {source}"),
                        body: value.to_string(),
                    }
                })?;
            debug!(count = parsed.len(), "list_models from CDP");
            Ok(parsed)
        }
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "list_models eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}

/// Set the model used for follow-up turns on `composer_id` in the
/// probe Cursor.
///
/// Two-tier strategy:
///   1. **Per-composer (preferred).** Resolve a composer handle via
///      `composerDataService.getComposerHandleById(composerId)` and
///      call `modelConfigService.setModelConfigForComposer(handle,
///      { modelName })`. This is the same path Cursor's own model
///      pill takes; it stamps the model on the composer's persistent
///      record so reopening the chat later still uses the picked
///      model. **Routing the UI to the composer first is not
///      required** — the data service resolves handles by id, not
///      by which composer is currently selected.
///   2. **Global composer scope (fallback).** If the handle lookup
///      fails for any reason (Cursor refactor, composer too freshly
///      created to have a handle yet, etc.) we fall through to
///      `modelConfigService.setSpecificModel("composer", modelName)`
///      which sets the *next* composer-scoped turn's model. The
///      next prompt picks it up regardless of which composer it
///      lands on, so the user still gets the model they picked even
///      if the per-composer write didn't take.
///
/// We validate `model_name` against the live `getAvailableDefaultModels()`
/// list before either write, so unknown ids surface as a clean error
/// instead of silently no-opping inside Cursor.
pub async fn set_model_for_composer(
    client: &CdpClient,
    composer_id: &str,
    model_name: &str,
) -> Result<()> {
    let escaped_model = serde_json::to_string(model_name).expect("string serializes");
    let escaped_composer = serde_json::to_string(composer_id).expect("string serializes");
    let expression = format!(
        r#"
    (() => {{
      {prelude}
      const is = findInstantiationService();
      const mcs = lookupService(is, "modelConfigService");
      if (!mcs) throw new Error("modelConfigService not registered");

      // Validate the model is actually in the picker — passing an
      // unknown name to setSpecificModel silently no-ops.
      const arr = mcs.getAvailableDefaultModels();
      const known = Array.isArray(arr) && arr.some(m =>
        m.name === {model} ||
        (Array.isArray(m.idAliases) && m.idAliases.includes({model})) ||
        (Array.isArray(m.legacySlugs) && m.legacySlugs.includes({model}))
      );
      if (!known) throw new Error("model " + {model} + " not in availableDefaultModels");

      // Prefer setModelConfigForComposer when we can synthesize a
      // handle from the data service (per-composer scope). Otherwise
      // fall back to the global composer scope.
      const composerId = {composer};
      let usedPerComposer = false;
      try {{
        const cds = lookupService(is, "composerDataService");
        if (cds && typeof cds.getComposerHandleById === "function") {{
          const handle = cds.getComposerHandleById(composerId);
          if (handle && typeof mcs.setModelConfigForComposer === "function") {{
            mcs.setModelConfigForComposer(handle, {{ modelName: {model} }});
            usedPerComposer = true;
          }}
        }}
      }} catch (_) {{ /* fall through to global */ }}

      if (!usedPerComposer) {{
        if (typeof mcs.setSpecificModel !== "function") {{
          throw new Error("setSpecificModel not on modelConfigService");
        }}
        mcs.setSpecificModel("composer", {model});
      }}
      return {{ ok: true, scope: usedPerComposer ? "composer-handle" : "composer-global" }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
        model = escaped_model,
        composer = escaped_composer,
    );

    match client.evaluate(&expression).await? {
        Ok(_) => Ok(()),
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "set_model_for_composer eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}
