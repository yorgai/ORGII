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

    // Model override is threaded per-request into `init_session`; we do NOT mutate any
    // shared state. Account changes do still require invalidation so the
    // next turn re-picks the provider.
    {
        let account_changed = if let Some(ref new_account_id) = account_id {
            let current = state.current_account_id.lock().await;
            current.as_deref() != Some(new_account_id.as_str())
        } else {
            false
        };

        if account_changed {
            state.invalidate_session(&session_key).await;
            state
                .running
                .store(false, std::sync::atomic::Ordering::Relaxed);
            if let Some(ref acc) = account_id {
                let mut current = state.current_account_id.lock().await;
                *current = Some(acc.clone());
            }
            if let Some(ref new_account_id) = account_id {
                session_persistence::update_account_id(&session_key, new_account_id).map_err(
                    |err| format!("[channel] Failed to persist account switch: {}", err),
                )?;
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

    let effective_account_id = if account_id.is_some() {
        account_id
    } else {
        let in_memory = state.current_account_id.lock().await.clone();
        if in_memory.is_some() {
            in_memory
        } else {
            let sk = session_key.clone();
            let db_account_id: Option<String> = tokio::task::spawn_blocking(move || {
                session_persistence::get_session(&sk)
                    .map_err(|err| format!("[channel] DB error loading account_id: {}", err))
                    .map(|opt| opt.and_then(|s| s.account_id))
            })
            .await
            .map_err(|err| format!("[channel] Task panic loading account_id: {}", err))??;
            if let Some(ref acc_id) = db_account_id {
                let mut current = state.current_account_id.lock().await;
                *current = Some(acc_id.clone());
            }
            db_account_id
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
pub async fn agent_ide_action_result(
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
            "[channel_ide_action_result] No pending request for correlation_id: {}",
            correlation_id
        );
    }
    Ok(())
}
