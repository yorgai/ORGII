//! Channel agent commands: message processing, workspace files, channel
//! probe, and IDE action bridge.

use tracing::{info, warn};

use crate::persistence::AgentResponse;
use crate::session::persistence as session_persistence;
use crate::state::AgentAppState;
use crate::tools::impls::web::control_orgii::ActionBridgeResult;

#[allow(clippy::too_many_arguments)]
pub async fn channel_process_message(
    state: tauri::State<'_, AgentAppState>,
    content: String,
    session_id: Option<String>,
    model: Option<String>,
    account_id: Option<String>,
    active_repo_path: Option<String>,
    active_branch: Option<String>,
    active_repo_name: Option<String>,
    images: Option<Vec<String>>,
) -> Result<AgentResponse, String> {
    info!(
        "[channel_process_message] session_id={:?}, model={:?}, account_id={:?}, repo={:?}",
        session_id, model, account_id, active_repo_path
    );
    let session_key = session_id.unwrap_or_else(|| "tauri:direct".to_string());
    info!("[channel_process_message] session_key={}", session_key);

    // Model override is threaded per-request into `init_session`; we do NOT
    // mutate any shared state. Account changes do still require invalidation
    // so the next turn re-picks the provider. The comparison baseline is
    // THIS session's runtime account — never a global (an unrelated
    // session's switch must not affect us, and ours must not affect them).
    {
        let runtime_account = match state.get_session(&session_key).await {
            Some(session) => session
                .get_runtime()
                .await
                .and_then(|r| r.account_id.clone()),
            None => None,
        };
        let account_changed = if let Some(ref new_account_id) = account_id {
            runtime_account.as_deref() != Some(new_account_id.as_str())
        } else {
            false
        };

        if account_changed {
            state.invalidate_session(&session_key).await;
            if let Some(ref new_account_id) = account_id {
                session_persistence::update_account_id(&session_key, new_account_id).map_err(
                    |err| format!("[channel] Failed to persist account switch: {}", err),
                )?;
                crate::lifecycle::emit_session_account_switched(
                    state.app_handle.as_ref(),
                    &session_key,
                    runtime_account.as_deref(),
                    new_account_id,
                    model.as_deref(),
                );
            }
        }
        if let Some(ref new_model) = model {
            session_persistence::update_model(&session_key, new_model)
                .map_err(|err| format!("[channel] Failed to persist model switch: {}", err))?;
        }
    }

    // Effective model: the caller-supplied override takes precedence;
    // otherwise the session's agent definition resolves it at
    // `init_session` time.
    let requested_model_override = model.clone();

    // Account chain mirrors `resolve_session_identity`: override → this
    // session's runtime → DB row. No global fallback.
    let effective_account_id = if account_id.is_some() {
        account_id
    } else {
        let runtime_account = match state.get_session(&session_key).await {
            Some(session) => session
                .get_runtime()
                .await
                .and_then(|r| r.account_id.clone()),
            None => None,
        };
        if runtime_account.is_some() {
            runtime_account
        } else {
            let sk = session_key.clone();
            tokio::task::spawn_blocking(move || {
                session_persistence::get_session(&sk)
                    .map_err(|err| format!("[channel] DB error loading account_id: {}", err))
                    .map(|opt| opt.and_then(|s| s.account_id))
            })
            .await
            .map_err(|err| format!("[channel] Task panic loading account_id: {}", err))??
        }
    };

    let ide_context = if active_repo_path.is_some() || active_branch.is_some() {
        Some(crate::session::IdeContext {
            repo_path: active_repo_path,
            git_branch: active_branch,
            repo_name: active_repo_name,
            workspace_folders: Vec::new(),
            ..Default::default()
        })
    } else {
        None
    };

    let launch_spec = crate::init::launch_spec::AgentLaunchSpec::registered_session(
        &state,
        &session_key,
        app_paths::personal_workspace(),
        effective_account_id.clone(),
        requested_model_override.clone(),
        None,
    )
    .await?;
    let runtime = crate::init::init_session(&state, launch_spec).await?;
    let effective_model = runtime.model.clone();

    let session_arc = state
        .get_session(&session_key)
        .await
        .ok_or_else(|| format!("Session {} not found after init", session_key))?;

    let input = crate::session::TurnInput {
        content: content.clone(),
        display_text: None,
        agent_mode: None,
        images,
        ide_context,
        is_resume: false,
        channel: None,
        chat_id: None,
        turn_id: None,
        // Channel/admin synthetic turns (debug tooling) mint their own id.
        turn_intent_id: uuid::Uuid::new_v4().to_string(),
    };

    const CALLER_TIMEOUT_SECS: u64 = 180;
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(CALLER_TIMEOUT_SECS),
        crate::session::process_message(session_arc, input, state.app_handle.clone()),
    )
    .await
    .map_err(|_| format!("Request timed out after {}s", CALLER_TIMEOUT_SECS))?
    .map(|r| r.content)?;

    Ok(AgentResponse {
        content: response,
        session_id: session_key,
        model: effective_model,
    })
}

#[tauri::command]
pub async fn agent_probe_channel(
    channel_type: String,
    credentials: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let result = crate::channels::probe::probe_channel(&channel_type, &credentials).await;
    serde_json::to_value(&result).map_err(|err| format!("Serialize error: {}", err))
}

#[tauri::command]
pub async fn agent_ade_action_result(
    state: tauri::State<'_, AgentAppState>,
    correlation_id: String,
    success: bool,
    message: String,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    let resolved = state.action_bridge.resolve(
        &correlation_id,
        ActionBridgeResult {
            success,
            message,
            data,
        },
    );
    if !resolved {
        warn!(
            "[channel_ade_action_result] No pending request for correlation_id: {}",
            correlation_id
        );
    }
    Ok(())
}
