//! Tauri command handlers for Cursor IDE control.
//!
//! The frontend's `cursor_bridge_*` invokes land here. Each
//! command runs the heavy work on the tokio runtime — `lifecycle`
//! shells out to `rsync` and `open`, and `client` opens a CDP
//! WebSocket. The webview thread is never blocked.
//!
//! The commands are intentionally thin: the actual logic lives in the
//! sibling modules so unit tests don't need a Tauri runtime.

use std::time::Duration;

use cursor_bridge::{AgentHeaderSummary, ModeEntry, ModelEntry, RouteOutcome};
use tracing::{debug, info, warn};

use super::client::{
    connect_and_create_then_send, connect_and_list_agents, connect_and_list_models,
    connect_and_list_modes, connect_and_route, connect_and_send, connect_and_set_mode,
    connect_and_set_model,
};
use super::lifecycle;
use super::vscdb_models;

/// Default port the probe instance binds to. Frontend can override
/// per-call but we want a single source of truth across both layers
/// to avoid drift.
pub const DEFAULT_REMOTE_DEBUG_PORT: u16 = 9230;

/// What `cursor_bridge_send` returns: the composer id the prompt
/// landed on, plus the routing outcome (when the caller passed
/// `target_agent_id`).
///
/// The composer id comes straight from Cursor's
/// `composerChatService` — we know exactly which row in `state.vscdb`
/// the prompt is associated with the moment the call returns. No
/// state.vscdb diff dance, no DOM polling.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    /// Composer id the prompt was submitted against. Either the
    /// `target_agent_id` the caller pinned, or whichever composer
    /// `composerDataService.selectedComposerId` resolved to.
    pub composer_id: String,
    /// Length of the submitted prompt in code-units. Mainly useful
    /// for sanity-checking that escaping/encoding round-tripped.
    pub text_length: u64,
    /// Outcome of the optional pre-send routing step. `None` for
    /// headless sends and for calls without `target_agent_id`. When
    /// `Some`, the inner `ok` flag tells the UI whether Cursor's UI
    /// managed to switch to the requested composer; the prompt itself
    /// always lands on the targeted composer regardless of routing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<RouteOutcome>,
}

#[tauri::command]
pub async fn cursor_bridge_ensure_running(
    port: Option<u16>,
) -> Result<lifecycle::EnsureRunningStatus, String> {
    lifecycle::ensure_running(port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT)).await
}

#[tauri::command]
pub async fn cursor_bridge_ensure_real_cursor_running(
    port: Option<u16>,
) -> Result<lifecycle::EnsureRunningStatus, String> {
    lifecycle::ensure_real_cursor_running(port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT)).await
}

#[tauri::command]
pub async fn cursor_bridge_restart_real_cursor_with_debug_port(
    port: Option<u16>,
) -> Result<lifecycle::EnsureRunningStatus, String> {
    lifecycle::restart_real_cursor_with_debug_port(port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT)).await
}

#[tauri::command]
pub async fn cursor_bridge_status(port: Option<u16>) -> Result<Option<String>, String> {
    lifecycle::current_status(port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT)).await
}

/// Inspect the current Cursor process landscape and report which
/// [`AttachMode`] would apply if we tried to ensure-running right
/// now. Pure status — never spawns, never seeds. The frontend uses
/// this for the "your real Cursor / isolated probe" indicator and to
/// decide whether to surface the "restart Cursor with debug port"
/// hint before the user clicks "Send".
#[tauri::command]
pub async fn cursor_bridge_attach_mode(port: Option<u16>) -> lifecycle::AttachMode {
    lifecycle::detect_cursor_mode(port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT)).await
}

/// Send a chat message to the live controllable Cursor instance.
///
/// `text` is the prompt. `port` defaults to
/// [`DEFAULT_REMOTE_DEBUG_PORT`]. `target_id` pins a specific
/// renderer page when set; today there is only one workbench Page so
/// the parameter is effectively reserved for future multi-window use.
///
/// `target_agent_id`, when set, submits to that exact composer id.
/// The hidden workbench's active composer is only switched first when
/// `route_visible` is true; normal ORGII follow-ups leave Cursor's UI
/// selection untouched. When `None`, the prompt lands on whatever
/// composer Cursor has selected.
#[tauri::command]
pub async fn cursor_bridge_send(
    text: String,
    port: Option<u16>,
    target_id: Option<String>,
    target_agent_id: Option<String>,
    route_visible: Option<bool>,
) -> Result<SendResult, String> {
    if text.trim().is_empty() {
        return Err("text must not be empty".to_string());
    }

    let port = port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT);

    let bundle = connect_and_send(
        "127.0.0.1",
        port,
        target_id.as_deref(),
        &text,
        target_agent_id.as_deref(),
        route_visible.unwrap_or(false),
    )
    .await
    .map_err(|err| {
        warn!(
            target_agent_id = target_agent_id.as_deref().unwrap_or("<none>"),
            port,
            error = %err,
            "cursor_bridge_send failed"
        );
        err
    })?;

    Ok(SendResult {
        composer_id: bundle.send.composer_id,
        text_length: bundle.send.text_length,
        route: bundle.route,
    })
}

/// Switch the probe Cursor's active composer to `agent_id` without
/// sending anything. Returns the lib-level [`RouteOutcome`] verbatim
/// — `ok` indicates the DOM converged on the target, `reason`
/// carries the failure mode otherwise.
///
/// Useful for "open this conversation in Cursor" affordances where
/// we don't have a prompt to send yet.
#[tauri::command]
pub async fn cursor_bridge_route(
    agent_id: String,
    port: Option<u16>,
    target_id: Option<String>,
) -> Result<RouteOutcome, String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    connect_and_route(
        "127.0.0.1",
        port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT),
        target_id.as_deref(),
        &agent_id,
    )
    .await
}

/// Enumerate every composer the probe Cursor knows about.
///
/// Returns the projected `AgentHeaderSummary` list straight from
/// `agentRepositoryService.delegate._agentHeaderById` in repository
/// iteration order. Frontend is responsible for sorting by
/// `modifiedAt` if it wants reverse-chronological display.
#[tauri::command]
pub async fn cursor_bridge_list_agents(
    port: Option<u16>,
    target_id: Option<String>,
) -> Result<Vec<AgentHeaderSummary>, String> {
    connect_and_list_agents(
        "127.0.0.1",
        port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT),
        target_id.as_deref(),
    )
    .await
}

/// What `cursor_bridge_list_models` returns.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsResult {
    /// The model list. Ordered: live (CDP) entries first, with any
    /// disk-only entries (entitlement-gated) appended after — the
    /// frontend can split them into "available" vs "potentially
    /// available" sections if needed.
    pub models: Vec<ModelEntry>,
    /// Where the list came from. `"live"` means the probe Cursor
    /// answered the CDP eval; `"disk"` means we fell back to
    /// `state.vscdb`. The UI can show a "(cached)" badge in disk
    /// mode.
    pub source: ModelSource,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSource {
    Live,
    Disk,
    Empty,
}

/// Read Cursor's available-model list.
///
/// Order of preference:
///   1. Live CDP via `modelConfigService.getAvailableDefaultModels()`.
///      Reflects entitlement filtering and server pushes; this is
///      what the user sees in their own Cursor picker.
///   2. Offline `state.vscdb` blob. Used as a fallback when the
///      probe Cursor isn't running yet, so the picker isn't blank
///      while the probe spawns.
///
/// `prefer_disk`, when true, skips the live path entirely. Useful
/// when the caller already knows the probe isn't running and wants
/// to avoid a 3 s discovery timeout.
///
/// **User-toggle filtering.** Both branches run the result through
/// [`vscdb_models::apply_model_toggles`], which reads the user's
/// `aiSettings.modelOverride{Enabled,Disabled}` lists from the
/// `applicationUser` blob and drops models the user has hidden in
/// Cursor's settings UI. Cursor's own `getAvailableDefaultModels()`
/// returns the **catalog** (entitlement-filtered but not user-pref
/// filtered), so without this step our picker would surface models
/// the user explicitly disabled — which is the bug this fixes.
#[tauri::command]
pub async fn cursor_bridge_list_models(
    port: Option<u16>,
    target_id: Option<String>,
    prefer_disk: Option<bool>,
) -> Result<ListModelsResult, String> {
    let prefer_disk = prefer_disk.unwrap_or(false);
    let resolved_port = port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT);
    info!(
        port = resolved_port,
        prefer_disk, "cursor_bridge_list_models invoked"
    );

    // Read the user's per-model show/hide toggles up-front so the
    // same filter applies to both branches below. Toggle reads are
    // a single SELECT against the same `applicationUser` blob the
    // disk path reads, so this is essentially free; falling back to
    // an empty toggle set on read failure is correct (it just means
    // "no filtering").
    let toggles = vscdb_models::read_model_toggles_from_disk().unwrap_or_else(|err| {
        warn!(error = %err, "read_model_toggles_from_disk failed; proceeding without filtering");
        vscdb_models::ModelToggles::default()
    });

    if !prefer_disk {
        // Cap the live attempt at 4s so a wedged WebSocket can never
        // strand the picker on the loading spinner. Any failure here
        // is non-fatal — we always fall through to the disk reader.
        let live_attempt = tokio::time::timeout(
            Duration::from_secs(4),
            connect_and_list_models("127.0.0.1", resolved_port, target_id.as_deref()),
        )
        .await;

        match live_attempt {
            Ok(Ok(mut models)) if vscdb_models::has_model_catalog(&models) => {
                vscdb_models::apply_model_toggles(&mut models, &toggles);
                info!(count = models.len(), "list_models served from live CDP");
                return Ok(ListModelsResult {
                    models,
                    source: ModelSource::Live,
                });
            }
            Ok(Ok(models)) => {
                debug!(
                    count = models.len(),
                    "live CDP returned no complete model catalog — falling back to disk",
                );
            }
            Ok(Err(err)) => {
                debug!(error = %err, "live CDP attempt failed — falling back to disk");
            }
            Err(_) => {
                warn!("live CDP attempt timed out after 4s — falling back to disk");
            }
        }
    }

    match vscdb_models::read_models_from_disk() {
        Ok(mut disk) => {
            // Determine the source label *before* filtering, so
            // "user disabled every model" doesn't get reported as
            // `Empty` (== "Cursor not installed") — the data came
            // from disk, the picker just happens to be empty after
            // applying user toggles.
            let source = if disk.is_empty() {
                ModelSource::Empty
            } else {
                ModelSource::Disk
            };
            vscdb_models::apply_model_toggles(&mut disk, &toggles);
            info!(
                count = disk.len(),
                ?source,
                "list_models served from state.vscdb"
            );
            Ok(ListModelsResult {
                models: disk,
                source,
            })
        }
        Err(err) => {
            warn!(error = %err, "vscdb_models::read_models_from_disk failed");
            Err(err)
        }
    }
}

/// Cheap freshness probe for the focused composer.
///
/// Returns the max of `lastUpdatedAt` and
/// `conversationCheckpointLastUpdatedAt` from
/// `composerData:<composer_id>` in `cursorDiskKV` (whichever DB has
/// the row — probe instance first, real Cursor second).
///
/// The frontend banner polls this at 1–4 s intervals while a
/// `cursoride-*` session is focused; only when the timestamp
/// advances does it trigger a full chunk reload through
/// `ensureCursorIdeEventsInStore`. That keeps the steady-state cost
/// at ~1 SQLite SELECT per second instead of re-parsing every
/// bubble for the open composer on every tick.
///
/// `Ok(None)` is the legitimate "no recorded timestamp" state — the
/// caller should treat it as "no change since last poll" rather than
/// an error.
#[tauri::command]
pub async fn cursor_bridge_composer_last_updated_at(
    agent_id: String,
) -> Result<Option<i64>, String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    vscdb_models::read_composer_last_updated_at(&agent_id)
}

/// Look up the model `agent_id` was last using, straight off
/// `state.vscdb`.
///
/// Cheap synchronous read — no CDP round-trip, no probe needed. The
/// frontend uses this on banner mount so the picker pill reflects
/// the session's actual last-used model instead of the generic
/// "Model: default" placeholder.
///
/// Returns `Ok(None)` when the composer row has no recorded
/// `modelConfig` (older Cursor builds, or composers that never
/// completed a turn). Errors only on real DB/JSON failures.
#[tauri::command]
pub async fn cursor_bridge_get_composer_model(agent_id: String) -> Result<Option<String>, String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    vscdb_models::read_composer_model_from_disk(&agent_id)
}

/// Read the user's *global* default composer model from
/// `state.vscdb` (pill seeding).
///
/// Mirrors the field Cursor stamps under
/// `applicationUser.aiSettings.modelConfig.composer.modelName`,
/// i.e. the model a brand-new chat inherits when the user opens
/// Cursor without selecting anything. The frontend uses this as
/// the **fallback seed** for the model pill in two cases:
///
///   1. SessionCreator path — no composer exists yet, but we still
///      want the pill to show the model that the new chat will
///      actually launch with instead of a generic "Default Model"
///      placeholder.
///   2. In-session path — the per-composer
///      `read_composer_model_from_disk` returned `None` (composer
///      created but never completed a turn, or older Cursor build).
///
/// Returns `Ok(None)` when the row is missing or the field is empty;
/// the literal `"default"` is preserved as-is — it's a real entry
/// in `availableDefaultModels2` whose label is "Auto", and the pill
/// renders that label naturally via the model-list lookup.
#[tauri::command]
pub async fn cursor_bridge_get_default_model() -> Result<Option<String>, String> {
    vscdb_models::read_global_default_composer_model_from_disk()
}

/// What `cursor_bridge_new_composer` returns.
///
/// `composer_id` is the persistent id Cursor allocated — comes
/// straight from `composerService.createComposer`'s return value
/// (no DOM polling, no `state.vscdb` diff). Always present on
/// success; absence means the create itself failed and the call
/// returned `Err`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComposerResult {
    /// Composer id Cursor allocated for the new chat. Authoritative
    /// — comes straight from `composerService.createComposer`'s
    /// return value, no DOM polling or `state.vscdb` diff involved.
    pub composer_id: String,
    /// Echo of the `unifiedMode` we asked Cursor to boot the new
    /// composer into (e.g. `"agent"`, `"plan"`). `None` when the
    /// caller didn't pin a mode.
    pub unified_mode: Option<String>,
    /// Length of the seed prompt we submitted, in code-units.
    pub text_length: u64,
}

/// Open a brand-new Cursor composer and seed it with `text`
/// — "start a Cursor IDE session from ORGII's creator".
///
/// Sequence:
///   1. `lifecycle::ensure_real_cursor_running()` — starts or reuses
///      the real Cursor DB owner without raising its window.
///   2. `connect_and_create_then_send()`:
///      - `composerService.createComposer({partialState:{unifiedMode}})`
///        creates the row in `state.vscdb` and returns the new id.
///      - `composerChatService.submitChatMaybeAbortCurrent(id, text)`
///        submits the seed prompt against that exact id.
///   3. (optional) `connect_and_set_model()` — switch the new
///      composer's model. Must run *after* the create because
///      Cursor's per-composer model setter is keyed on the composer
///      id, which only exists after step 2.
///
/// Both `model_name` and `mode_id` are optional. `mode_id` (one of
/// Cursor's `composerModesService` ids — `"agent"`, `"plan"`,
/// `"ask"`, …) is applied at creation time via `partialState.unifiedMode`,
/// so the new chat boots into the requested mode without a follow-up
/// switch round-trip. `model_name` falls back to a no-op if the
/// per-composer model setter fails — the user still gets the new
/// chat with Cursor's current default.
#[tauri::command]
pub async fn cursor_bridge_new_composer(
    text: String,
    port: Option<u16>,
    target_id: Option<String>,
    model_name: Option<String>,
    mode_id: Option<String>,
) -> Result<NewComposerResult, String> {
    if text.trim().is_empty() {
        return Err("text must not be empty".to_string());
    }
    if let Some(model) = model_name.as_deref() {
        if model.trim().is_empty() {
            return Err("model_name must not be empty when provided".to_string());
        }
    }
    if let Some(mode) = mode_id.as_deref() {
        if mode.trim().is_empty() {
            return Err("mode_id must not be empty when provided".to_string());
        }
    }

    let port = port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT);

    lifecycle::ensure_real_cursor_running(port).await?;

    let (new_outcome, send_outcome) = connect_and_create_then_send(
        "127.0.0.1",
        port,
        target_id.as_deref(),
        &text,
        mode_id.as_deref(),
    )
    .await?;

    // Now that the composer exists with a known id, we can apply
    // the per-composer model. Failing here is non-fatal: the
    // resulting chat just inherits Cursor's current default model,
    // which is the same UX as "user opened a new chat in Cursor
    // directly".
    if let Some(model) = model_name.as_deref() {
        debug!(
            model,
            composer_id = %new_outcome.composer_id,
            "applying model after new-composer create"
        );
        if let Err(err) = connect_and_set_model(
            "127.0.0.1",
            port,
            target_id.as_deref(),
            &new_outcome.composer_id,
            model,
        )
        .await
        {
            warn!(error = %err, "set_model after new-composer failed; continuing with default");
        }
    }

    info!(
        composer_id = %new_outcome.composer_id,
        unified_mode = ?new_outcome.unified_mode,
        text_len = send_outcome.text_length,
        "new composer create+send complete"
    );

    Ok(NewComposerResult {
        composer_id: new_outcome.composer_id,
        unified_mode: new_outcome.unified_mode,
        text_length: send_outcome.text_length,
    })
}

/// Set the model used for the next prompt on `agent_id` in the probe
/// Cursor.
///
/// The implementation prefers the per-composer route
/// (`setModelConfigForComposer` against a synthesized handle) and
/// falls back to the global `setSpecificModel("composer", …)` when
/// the per-composer handle isn't reachable. Either way, the next
/// prompt we type via `cursor_bridge_send` picks up the new
/// model.
#[tauri::command]
pub async fn cursor_bridge_set_model(
    agent_id: String,
    model_name: String,
    port: Option<u16>,
    target_id: Option<String>,
) -> Result<(), String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    if model_name.trim().is_empty() {
        return Err("model_name must not be empty".to_string());
    }
    connect_and_set_model(
        "127.0.0.1",
        port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT),
        target_id.as_deref(),
        &agent_id,
        &model_name,
    )
    .await
}

/// What `cursor_bridge_list_modes` returns.
///
/// Same shape as `ListModelsResult`: live/disk source flag plus the
/// projected entries. We keep the source field so the frontend can
/// surface a "(cached)" badge identical to the model picker, and so
/// debugging "why is the picker empty?" doesn't require a separate
/// log dive.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModesResult {
    pub modes: Vec<ModeEntry>,
    pub source: ModeSource,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModeSource {
    Live,
    /// Bundled fallback. Cursor's mode set is small (six entries)
    /// and stable across versions, so when the live CDP path fails
    /// we serve a hard-coded copy rather than asking the user to
    /// wait for the probe to start.
    Bundled,
}

/// Read Cursor's unified-mode picker (Agent / Plan / Debug / Ask /
/// Multitask / Project).
///
/// Order of preference:
///   1. **Live CDP**: `composerModesService.getAllModes()` against
///      the running probe. Always returns the same set the user
///      would see if they opened Cursor's own picker.
///   2. **Bundled fallback**: a hard-coded copy of Cursor's six
///      built-in modes. Cursor's mode set is stable across
///      versions and the picker is much less feature-flag-driven
///      than the model list, so a static fallback is safe and
///      keeps the picker usable while the probe is starting.
///
/// Background mode is filtered out to mirror Cursor's own picker
/// (which hides it from the per-composer dropdown).
#[tauri::command]
pub async fn cursor_bridge_list_modes(
    port: Option<u16>,
    target_id: Option<String>,
) -> Result<ListModesResult, String> {
    let resolved_port = port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT);
    info!(port = resolved_port, "cursor_bridge_list_modes invoked");

    // Cap the live attempt at 4s — same budget as `list_models`. A
    // wedged WebSocket can never strand the picker on the loading
    // spinner because we always fall through to the bundled set.
    let live_attempt = tokio::time::timeout(
        Duration::from_secs(4),
        connect_and_list_modes("127.0.0.1", resolved_port, target_id.as_deref()),
    )
    .await;

    match live_attempt {
        Ok(Ok(modes)) if !modes.is_empty() => {
            info!(count = modes.len(), "list_modes served from live CDP");
            return Ok(ListModesResult {
                modes,
                source: ModeSource::Live,
            });
        }
        Ok(Ok(_)) => {
            debug!("live CDP returned empty mode list — falling back to bundled");
        }
        Ok(Err(err)) => {
            debug!(error = %err, "live CDP attempt failed — falling back to bundled");
        }
        Err(_) => {
            warn!("live CDP attempt timed out after 4s — falling back to bundled");
        }
    }

    Ok(ListModesResult {
        modes: bundled_modes(),
        source: ModeSource::Bundled,
    })
}

/// Hard-coded copy of Cursor's per-composer mode picker, used when
/// the live CDP path is unreachable.
///
/// Mirrors Cursor's own descriptors verbatim — the only difference
/// is `background` is dropped (it's a cloud-runs surface, not a
/// per-composer mode).
fn bundled_modes() -> Vec<ModeEntry> {
    fn entry(id: &str, name: &str, desc: &str, icon: &str) -> ModeEntry {
        ModeEntry {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(desc.to_string()),
            icon: Some(icon.to_string()),
            action_id: Some(format!("composerMode.{id}")),
        }
    }
    vec![
        entry(
            "agent",
            "Agent",
            "Plan, search, make edits, run commands",
            "infinity",
        ),
        entry(
            "plan",
            "Plan",
            "Create detailed plans for accomplishing tasks",
            "todos",
        ),
        entry(
            "debug",
            "Debug",
            "Systematically diagnose and fix bugs using runtime traces",
            "bug",
        ),
        entry(
            "multitask",
            "Multitask",
            "Run and coordinate multiple tasks in parallel",
            "circles",
        ),
        // Cursor surfaces this as "Ask" in the picker even though the
        // canonical id is `chat`. Match the live label exactly so the
        // bundled-vs-live UX is indistinguishable.
        entry(
            "chat",
            "Ask",
            "Ask Cursor questions about your codebase",
            "chat",
        ),
        entry(
            "project",
            "Project",
            "Special conversation mode for project-level discussions",
            "folder",
        ),
    ]
}

/// Read the per-composer unified mode straight off `state.vscdb`.
///
/// Cheap synchronous read — no CDP round-trip, no probe needed. The
/// frontend uses this on banner mount so the mode pill reflects the
/// session's actual last-used mode (Agent / Plan / Debug / …)
/// instead of always defaulting to Agent.
///
/// Returns `Ok(None)` when the composer row has no recorded
/// `unifiedMode` (older Cursor builds, or composers created before
/// the unified-mode picker shipped). Errors only on real DB/JSON
/// failures.
#[tauri::command]
pub async fn cursor_bridge_get_composer_mode(agent_id: String) -> Result<Option<String>, String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    vscdb_models::read_composer_unified_mode_from_disk(&agent_id)
}

/// Switch the unified mode for `agent_id` in the probe Cursor.
///
/// Mirrors `cursor_bridge_set_model` — composer-targeted via
/// `composerModesService.setComposerUnifiedMode` against a handle
/// resolved through `composerDataService.getComposerHandleById`.
/// Unknown mode ids surface as `Err` (the lib validates against the
/// live `getAllModes()` list before applying), so the frontend can
/// react instead of silently no-opping.
///
/// Unlike the model setter there is **no global fallback**. Mode is
/// always per-composer in Cursor; if the handle lookup fails we
/// surface the failure rather than risk applying the change to the
/// wrong chat.
#[tauri::command]
pub async fn cursor_bridge_set_mode(
    agent_id: String,
    mode_id: String,
    port: Option<u16>,
    target_id: Option<String>,
) -> Result<(), String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id must not be empty".to_string());
    }
    if mode_id.trim().is_empty() {
        return Err("mode_id must not be empty".to_string());
    }
    connect_and_set_mode(
        "127.0.0.1",
        port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT),
        target_id.as_deref(),
        &agent_id,
        &mode_id,
    )
    .await
}
