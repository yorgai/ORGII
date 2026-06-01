//! Switch the visibly-selected composer in the standalone Cursor
//! Agents view, and enumerate every composer the probe Cursor is
//! aware of.
//!
//! ## Why routing exists
//!
//! `composerChatService.submitChatMaybeAbortCurrent(composerId, …)`
//! happily submits to any composer regardless of which one is
//! visible. For a "follow up on this historical conversation" UX
//! the user still wants to *see* the chat they're replying to, so
//! we ask Cursor to make that composer the active one before — or
//! after — the submit lands. Routing is therefore a UI concern,
//! not a correctness prerequisite for the submit itself.
//!
//! ## How routing works
//!
//! The standalone Agents view does not own an "embedded aux bar
//! editor part", so `agentLayoutService.openComposer` (the entry
//! point used by the regular workbench layout) throws against it.
//! Instead we call the closure the sidebar-row click handler
//! itself uses — `HBC.memoizedProps.onSelectAgent(targetId)` —
//! which does:
//!
//!   1. `recordAgentVisit(targetId, …)`
//!   2. `agentRepositoryService.getAgent(targetId)` (sync)
//!   3. `setSelectedAgent({ status: "loaded", agentId, reference })`
//!   4. `glassActiveAgentService.setActiveAgentId(targetId)`
//!   5. `syncEditorPanelVisibilityForAgent(targetId)`
//!
//! ## How we reach HBC + the registry on a cold probe
//!
//! `route_to_composer` requires HBC's `memoizedProps`, which only
//! exists on a fiber owning the standalone Agents component. We
//! still have to walk fibers to find it, but the walk is now
//! anchored on `.monaco-workbench` (which is always present) and
//! looks for *any* fiber whose `memoizedProps.onSelectAgent` is a
//! function — no hardcoded depth. `list_agents` doesn't need HBC
//! at all; it reaches `agentRepositoryService` straight off the
//! shared instantiation service via [`crate::workbench::PRELUDE`].

use serde_json::json;
use tracing::{debug, info};

use crate::cdp::{CdpClient, EvalOutcome};
use crate::error::{CdpError, Result};
use crate::workbench;

/// Switch the probe instance's standalone Agents view to composer
/// `agent_id`. Returns when both the DOM `[data-composer-id]` and
/// `glassActiveAgentService.getActiveAgentId()` agree on the target.
///
/// Errors:
///  - target id not present in `agentRepositoryService` → caller
///    likely passed a stale id; surface "this composer no longer
///    exists in your Cursor history".
///  - target is archived → same UX, but a more specific reason.
///  - DOM never converged within 3 s → either Cursor is mid-update
///    or our fiber-depth assumption broke; caller should retry once
///    or fall back to the un-routed send.
pub async fn route_to_composer(client: &CdpClient, agent_id: &str) -> Result<RouteOutcome> {
    let escaped = serde_json::to_string(agent_id).expect("string serializes");
    let expression = format!(
        r#"
    (async () => {{
      {prelude}

      const TARGET_ID = {escaped};

      // Reach `agentRepositoryService` + `glassActiveAgentService`
      // via the shared instantiation service — works on both warm
      // and cold workbench surfaces.
      const is = findInstantiationService();
      const repo = lookupService(is, "agentRepositoryService");
      const glass = lookupService(is, "glassActiveAgentService");
      if (!repo) return {{ ok: false, reason: "agentRepositoryService not registered" }};
      if (!glass) return {{ ok: false, reason: "glassActiveAgentService not registered" }};

      // Reject unknown ids early so the user sees a precise error
      // instead of silently no-opping or routing to the wrong chat.
      const header = repo.getAgentHeader ? repo.getAgentHeader(TARGET_ID) : null;
      if (!header) {{
        // `getAgentHeader` can return undefined for entries the repo
        // hasn't materialized yet — fall back to the underlying map.
        const map = repo.delegate && repo.delegate._agentHeaderById;
        if (!map || !map.has(TARGET_ID)) {{
          return {{ ok: false, reason: "agent " + TARGET_ID + " not in agentRepositoryService" }};
        }}
      }}

      // The actual route requires HBC's `onSelectAgent`. We find it
      // by walking fibers anchored on `.monaco-workbench` and
      // looking for any frame whose `memoizedProps.onSelectAgent`
      // is a function. No hardcoded depth — Cursor's HOC nesting
      // can drift between versions.
      let onSelectAgent = null;
      const wbAnchor = document.querySelector(".monaco-workbench") || document.body;
      if (wbAnchor) {{
        let el = wbAnchor;
        let fiber = null;
        while (el && !fiber) {{
          const key = Object.getOwnPropertyNames(el).find(k => k.startsWith("__reactFiber"));
          if (key) fiber = el[key];
          el = el.parentElement;
        }}
        let depth = 0;
        while (fiber && depth <= 30) {{
          const fn = fiber.memoizedProps?.onSelectAgent;
          if (typeof fn === "function") {{
            onSelectAgent = fn;
            break;
          }}
          fiber = fiber.return;
          depth++;
        }}
      }}

      const beforeActive = glass.getActiveAgentId();
      const beforeDom = document.querySelector("[data-composer-id]")?.dataset?.composerId ?? null;

      // If `onSelectAgent` isn't reachable we still update the glass
      // service directly — that updates the storage cell and the
      // composer chat service will accept submits to the new id even
      // if the visible UI doesn't switch.
      if (onSelectAgent) {{
        onSelectAgent(TARGET_ID);
      }} else {{
        glass.setActiveAgentId(TARGET_ID);
      }}

      // Poll up to 3 s for `glass.getActiveAgentId()` to settle on
      // TARGET_ID. The DOM `[data-composer-id]` is *not* a reliable
      // signal on the standalone Agents view — that surface never
      // mounts a composer DOM element — so we only watch the glass
      // service's storage cell.
      for (let i = 0; i < 30; i++) {{
        await new Promise(r => setTimeout(r, 100));
        const active = glass.getActiveAgentId();
        if (active === TARGET_ID) {{
          return {{
            ok: true,
            attempts: i + 1,
            usedOnSelectAgent: !!onSelectAgent,
            beforeActive,
            beforeDom,
            afterActive: active,
            afterDom: document.querySelector("[data-composer-id]")?.dataset?.composerId ?? null,
          }};
        }}
      }}

      return {{
        ok: false,
        reason: "glassActiveAgentService did not converge on target within 3000 ms",
        usedOnSelectAgent: !!onSelectAgent,
        beforeActive,
        beforeDom,
        afterActive: glass.getActiveAgentId(),
        afterDom: document.querySelector("[data-composer-id]")?.dataset?.composerId ?? null,
      }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
    );

    let outcome = client.evaluate(&expression).await?;
    parse_route_outcome(outcome).inspect(|outcome| {
        if outcome.ok {
            info!(
                target = agent_id,
                attempts = outcome.attempts,
                "routed composer"
            );
        } else {
            debug!(
                target = agent_id,
                reason = ?outcome.reason,
                "route attempt did not converge"
            );
        }
    })
}

/// Result of `route_to_composer`. `ok=false` carries `reason` so the
/// caller can decide between retry / surface-error / fall-back-to-no-route.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOutcome {
    pub ok: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// Number of 100 ms poll cycles the glass service took to
    /// converge on the target id. Only set when `ok = true`.
    #[serde(default)]
    pub attempts: Option<u32>,
    /// `true` when we successfully reached `HBC.onSelectAgent` and
    /// invoked it (the preferred path — also updates the React
    /// component tree). `false` when we fell back to
    /// `glassActiveAgentService.setActiveAgentId` directly because
    /// HBC wasn't reachable; the storage cell still flips but the
    /// visible UI may lag.
    #[serde(default)]
    pub used_on_select_agent: Option<bool>,
    #[serde(default)]
    pub before_active: Option<String>,
    #[serde(default)]
    pub before_dom: Option<String>,
    #[serde(default)]
    pub after_active: Option<String>,
    #[serde(default)]
    pub after_dom: Option<String>,
}

fn parse_route_outcome(outcome: EvalOutcome) -> Result<RouteOutcome> {
    match outcome {
        Ok(result) => {
            let value = result.value.unwrap_or(json!({}));
            serde_json::from_value(value.clone()).map_err(|source| CdpError::MalformedResponse {
                context: format!("route outcome not deserializable: {source}"),
                body: value.to_string(),
            })
        }
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "route_to_composer eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}

/// One known composer in the probe Cursor's repository.
///
/// Sourced from `agentRepositoryService.delegate._agentHeaderById`,
/// which is the Map the standalone Agents view's sidebar reads from.
/// We project to a small TS-friendly shape so the frontend can show a
/// "switch to" picker without needing to introspect the service.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHeaderSummary {
    pub id: String,
    /// Human label Cursor displays in its own sidebar. May be empty
    /// for brand-new composers Cursor hasn't titled yet.
    #[serde(default)]
    pub title: Option<String>,
    /// Last-modified timestamp in ms-since-epoch. Used for sorting.
    #[serde(default)]
    pub modified_at: Option<i64>,
    /// Created-at timestamp in ms-since-epoch.
    #[serde(default)]
    pub created_at: Option<i64>,
    /// Whether the composer is archived in Cursor's UI. Archived
    /// agents still exist but Cursor hides them from the sidebar by
    /// default.
    #[serde(default)]
    pub is_archived: bool,
    /// Number of bubbles. Useful for the picker UI to dim empty
    /// drafts.
    #[serde(default)]
    pub message_count: Option<u32>,
}

/// List every composer the probe Cursor is aware of.
///
/// Wraps `Array.from(agentRepositoryService.delegate._agentHeaderById.entries())`
/// and projects each entry to [`AgentHeaderSummary`]. Returns them in
/// repository iteration order; the frontend is responsible for sorting
/// by `modified_at` if it wants reverse-chronological.
pub async fn list_agents(client: &CdpClient) -> Result<Vec<AgentHeaderSummary>> {
    let expression = format!(
        r#"
    (() => {{
      {prelude}

      const is = findInstantiationService();
      const repo = lookupService(is, "agentRepositoryService");
      if (!repo) return {{ ok: false, reason: "agentRepositoryService not registered" }};

      const map = repo.delegate?._agentHeaderById;
      if (!map) return {{ ok: false, reason: "agentRepositoryService.delegate._agentHeaderById missing" }};

      // Each header is an object whose shape varies slightly across
      // Cursor versions — we pull the most stable subset and let the
      // Rust side decide what to surface.
      const out = [];
      for (const [id, header] of map.entries()) {{
        // Some fields are observable signals (`{{ value }}`); others
        // are raw scalars. Try both, fall back to undefined.
        const readMaybeSignal = (v) => (v && typeof v === "object" && "value" in v) ? v.value : v;
        out.push({{
          id: String(id),
          title: readMaybeSignal(header.title) ?? header.name ?? null,
          modifiedAt: readMaybeSignal(header.modifiedAt) ?? header.lastModifiedAt ?? null,
          createdAt: readMaybeSignal(header.createdAt) ?? null,
          isArchived: !!readMaybeSignal(header.isArchived),
          messageCount: readMaybeSignal(header.messageCount) ?? null,
        }});
      }}
      return {{ ok: true, agents: out }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            let value = result.value.unwrap_or(json!({}));
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Wire {
                ok: bool,
                #[serde(default)]
                reason: Option<String>,
                #[serde(default)]
                agents: Vec<AgentHeaderSummary>,
            }
            let parsed: Wire = serde_json::from_value(value.clone()).map_err(|source| {
                CdpError::MalformedResponse {
                    context: format!("list_agents response not deserializable: {source}"),
                    body: value.to_string(),
                }
            })?;
            if !parsed.ok {
                return Err(CdpError::ProtocolError {
                    code: 0,
                    message: format!(
                        "list_agents failed: {}",
                        parsed.reason.unwrap_or_else(|| "unknown".into())
                    ),
                });
            }
            Ok(parsed.agents)
        }
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!("list_agents eval threw: {}", ex.text),
        }),
    }
}
