//! Workspace-scoped session initialization.

use std::sync::Arc;
use tracing::{info, warn};

use crate::session::persistence as unified_persistence;
use crate::state::{AgentAppState, SessionRuntime};
use core_types::key_source::KeySource;

/// Initialize a workspace-scoped session's runtime using the unified init path.
///
/// Agent resolve contract (design doc §11.4): coding sessions resolve against the session's
/// `AgentDefinition` (typically `builtin:sde`) merged with app-level
/// `IntegrationsConfig`. The workspace path is carried as a per-session
/// workspace override — there is no per-project `agent-config.json`
/// overlay anymore (the old layered-merge path was retired).
///
/// This also eagerly `upsert`s the session metadata into
/// `agent_sessions` with `session_type='sde'` and the correct
/// `workspace_path`, so the row is fully populated before any later
/// `message_pipeline` fallback branch (which can only synthesize a
/// generic OS-typed row with an empty `workspace_path`) ever sees this
/// session id.
pub async fn init_workspace_session(
    state: &AgentAppState,
    session_id: &str,
    model: &str,
    account_id: Option<&str>,
    workspace_path: &std::path::Path,
) -> Result<Arc<SessionRuntime>, String> {
    let launch_spec = crate::init::launch_spec::AgentLaunchSpec::workspace_session(
        state,
        session_id,
        model,
        account_id,
        workspace_path,
    )
    .await?;

    let runtime = crate::init::init_session(state, launch_spec).await?;

    // Eagerly persist an `agent_sessions` row so the later fallback path in
    // `message_pipeline::process_message` does not have to invent one (and
    // clobber `session_type` / `workspace_path` in the process).
    //
    // Running sessions that already have a row are a no-op update — the
    // `upsert_session` `ON CONFLICT DO UPDATE` branch refreshes
    // `updated_at` without disturbing existing status, channel, chat_id,
    // or parent linkage.
    let sid = session_id.to_string();
    let model_owned = model.to_string();
    let account_owned = account_id.map(str::to_string);
    let workspace_owned = workspace_path.to_string_lossy().to_string();
    if let Err(err) = tokio::task::spawn_blocking(move || {
        let existing = unified_persistence::get_session(&sid)?;
        let now = chrono::Utc::now().to_rfc3339();
        let record = match existing {
            // Already tracked — only refresh a few mutable fields so we
            // don't overwrite channel / chat_id / parent metadata that a
            // previous dispatch established.
            Some(mut existing) => {
                existing.model = Some(model_owned);
                if existing.account_id.is_none() {
                    existing.account_id = account_owned;
                }
                let needs_workspace = existing
                    .workspace_path
                    .as_deref()
                    .map(str::is_empty)
                    .unwrap_or(true);
                if needs_workspace {
                    existing.workspace_path = Some(workspace_owned);
                }
                // Ensure `session_type` is correct. Do not rewrite gateway
                // or existing explicitly-typed rows.
                if existing.session_type.is_empty()
                    || existing.session_type == unified_persistence::session_type::DESKTOP
                {
                    existing.session_type = unified_persistence::session_type::CODING.to_string();
                }
                existing.updated_at = now;
                existing
            }
            None => unified_persistence::UnifiedSessionRecord {
                session_id: sid.clone(),
                name: format!("SDE: {}", workspace_owned),
                status: super::SessionStatus::Running.as_str().to_string(),
                model: Some(model_owned),
                account_id: account_owned,
                session_type: unified_persistence::session_type::CODING.to_string(),
                workspace_path: Some(workspace_owned),
                created_at: now.clone(),
                updated_at: now,
                // Cold-start fallback: this branch fires when an SDE
                // session is being initialized but no `agent_sessions` row
                // exists yet (e.g. E2E test endpoints that pre-seed the
                // workspace then call `init_workspace_session` directly,
                // bypassing the Tauri `session_launch` path). The
                // production launch path always writes the row first via
                // `create_session_impl` (which carries a typed
                // `key_source` from the frontend) and then hits the
                // `Some(existing)` branch above where the upsert preserves
                // the original key_source via the `ON CONFLICT … =
                // agent_sessions.key_source` clause. Anything reaching
                // this `None` branch is therefore not a billing-bearing
                // session today; default explicitly to `OwnKey` so the
                // intent is visible rather than hiding behind
                // `..Default::default()`.
                key_source: KeySource::OwnKey,
                ..Default::default()
            },
        };
        unified_persistence::upsert_session(&record)
    })
    .await
    .map_err(|err| err.to_string())?
    {
        // Persistence failure is not fatal to the runtime — the
        // in-memory session still works for this turn, and the fallback
        // in `message_pipeline` will try again on the next message.
        warn!(
            "[project_init] eager upsert for `{}` failed: {}",
            session_id, err
        );
    } else {
        info!(
            "[project_init] eager upsert for `{}` @ `{}` (session_type={})",
            session_id,
            workspace_path.display(),
            unified_persistence::session_type::CODING,
        );
    }

    Ok(runtime)
}
