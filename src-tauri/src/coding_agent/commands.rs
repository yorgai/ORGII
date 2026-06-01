//! Tauri commands for coding agent session management.
//!
//! Extracted from `mod.rs` to keep module root focused on state and initialization.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Manager;
use tracing::info;

use super::context;
use super::modes;
use super::permission;
use super::persistence;
use super::processor;
use super::tools;
use super::{CodingAgentResponse, CodingAgentState, SESSION_PREFIX};

// ============================================
// Session Lifecycle
// ============================================

/// Create a new coding agent session.
///
/// Returns the session ID (prefixed with `codingagent-`).
#[tauri::command]
pub async fn coding_agent_create(
    _state: tauri::State<'_, CodingAgentState>,
    project_path: String,
    model: Option<String>,
    account_id: Option<String>,
    name: Option<String>,
) -> Result<CodingAgentResponse, String> {
    let session_id = format!("{}{}", SESSION_PREFIX, uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();

    let effective_model = model.unwrap_or_else(|| {
        "anthropic/claude-sonnet-4-20250514".to_string()
    });

    let session = persistence::CodingAgentSession {
        session_id: session_id.clone(),
        name: name.unwrap_or_else(|| "New coding session".to_string()),
        status: persistence::CodingAgentSessionStatus::Idle,
        model: Some(effective_model.clone()),
        account_id,
        project_path: Some(project_path),
        user_input: None,
        total_tokens: 0,
        created_at: now.clone(),
        updated_at: now,
    };

    tokio::task::spawn_blocking(move || persistence::upsert_session(&session))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;

    info!("[coding_agent] Created session: {}", session_id);

    Ok(CodingAgentResponse {
        content: String::new(),
        session_id,
        model: effective_model,
    })
}

/// Send a message to a coding agent session.
#[tauri::command]
pub async fn coding_agent_message(
    state: tauri::State<'_, CodingAgentState>,
    session_id: String,
    content: String,
    model: Option<String>,
    account_id: Option<String>,
    project_path: Option<String>,
    mode: Option<String>,
    images: Option<Vec<String>>,
    ide_context: Option<context::IdeContext>,
) -> Result<CodingAgentResponse, String> {
    info!(
        "[coding_agent_message] session={}, model={:?}, account={:?}, mode={:?}",
        session_id, model, account_id, mode
    );

    // Resolve project path: explicit param > session DB > fallback to home
    let effective_project_path = if let Some(ref path) = project_path {
        PathBuf::from(path)
    } else {
        let sid = session_id.clone();
        let db_path = tokio::task::spawn_blocking(move || {
            persistence::get_session(&sid)
                .ok()
                .flatten()
                .and_then(|s| s.project_path)
        })
        .await
        .unwrap_or(None);

        db_path
            .map(PathBuf::from)
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp")))
    };

    // Resolve model: explicit param > existing session runtime > default
    let effective_model = if let Some(ref m) = model {
        m.clone()
    } else {
        let runtimes = state.session_runtimes.lock().await;
        runtimes
            .get(&session_id)
            .map(|r| r.model.clone())
            .unwrap_or_else(|| "anthropic/claude-sonnet-4-20250514".to_string())
    };

    // Resolve account_id: explicit > existing session runtime > DB
    let effective_account_id = if account_id.is_some() {
        account_id
    } else {
        let from_runtime = {
            let runtimes = state.session_runtimes.lock().await;
            runtimes
                .get(&session_id)
                .and_then(|r| r.account_id.clone())
        };
        if from_runtime.is_some() {
            from_runtime
        } else {
            let sid = session_id.clone();
            tokio::task::spawn_blocking(move || {
                persistence::get_session(&sid)
                    .ok()
                    .flatten()
                    .and_then(|s| s.account_id)
            })
            .await
            .unwrap_or(None)
        }
    };

    // Initialize session runtime (returns existing if config matches)
    let runtime = super::ensure_session_initialized(
        &state,
        &session_id,
        &effective_model,
        effective_account_id.as_deref(),
        &effective_project_path,
    )
    .await?;

    // Update session status to running
    {
        let sid = session_id.clone();
        let input_preview: String = content.chars().take(100).collect();
        let model_clone = effective_model.clone();
        tokio::task::spawn_blocking(move || {
            let _ = persistence::update_session_status(
                &sid,
                persistence::CodingAgentSessionStatus::Running.as_ref(),
            );
            if let Ok(Some(mut session)) = persistence::get_session(&sid) {
                if session.user_input.is_none() {
                    session.user_input = Some(input_preview);
                    session.model = Some(model_clone);
                    let _ = persistence::upsert_session(&session);
                }
            }
        })
        .await
        .map_err(|err| err.to_string())?;
    }

    let provider = Arc::clone(&runtime.provider);
    let tool_registry = Arc::clone(&runtime.tool_registry);
    let policy = Arc::clone(&runtime.policy);
    let config = runtime.config.clone();

    let mut compaction_state = {
        let mut compaction_states = state.compaction_states.lock().await;
        compaction_states.remove(&session_id).unwrap_or_default()
    };

    let permission_manager = {
        let mut managers = state.permission_managers.lock().await;
        managers
            .entry(session_id.clone())
            .or_insert_with(|| Arc::new(super::permission::PermissionManager::new()))
            .clone()
    };

    let lsp_manager: Option<Arc<tokio::sync::Mutex<crate::lsp::LspManager>>> = state
        .app_handle
        .as_ref()
        .and_then(|h| h.try_state::<crate::lsp::LspManagerState>())
        .map(|s| s.inner().clone());

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.cancel_flags.lock().await;
        flags.insert(session_id.clone(), Arc::clone(&cancel_flag));
    }
    let cancel_flags_ref = Arc::clone(&state.cancel_flags);
    let session_id_for_cleanup = session_id.clone();
    let _cancel_guard = scopeguard::guard((), move |_| {
        if let Ok(mut flags) = cancel_flags_ref.try_lock() {
            flags.remove(&session_id_for_cleanup);
        }
    });

    let response = processor::process_message(
        &session_id,
        &content,
        &effective_model,
        &effective_project_path,
        provider.as_ref(),
        &tool_registry,
        &policy,
        &config,
        &mut compaction_state,
        &permission_manager,
        modes::AgentMode::from_str_lossy(mode.as_deref().unwrap_or("build")),
        images.as_deref(),
        lsp_manager,
        Some(&cancel_flag),
        ide_context.as_ref(),
    )
    .await;

    // Update session status based on result
    let final_status = if response.is_ok() {
        persistence::CodingAgentSessionStatus::Completed
    } else {
        persistence::CodingAgentSessionStatus::Failed
    };

    if final_status.is_terminal() {
        let mut compaction_states = state.compaction_states.lock().await;
        compaction_states.remove(&session_id);
        drop(compaction_states);

        let mut managers = state.permission_managers.lock().await;
        managers.remove(&session_id);
    } else {
        let mut compaction_states = state.compaction_states.lock().await;
        compaction_states.insert(session_id.clone(), compaction_state);
    }

    {
        let sid = session_id.clone();
        tokio::task::spawn_blocking(move || {
            let _ = persistence::update_session_status(&sid, final_status.as_ref());
        })
        .await
        .ok();
    }

    let response_text = response?;

    Ok(CodingAgentResponse {
        content: response_text,
        session_id,
        model: effective_model,
    })
}

/// Cancel a running coding agent session.
#[tauri::command]
pub async fn coding_agent_cancel(
    state: tauri::State<'_, CodingAgentState>,
    session_id: String,
) -> Result<(), String> {
    info!("[coding_agent] Cancelling session: {}", session_id);

    {
        let flags = state.cancel_flags.lock().await;
        if let Some(flag) = flags.get(&session_id) {
            flag.store(true, Ordering::Relaxed);
            info!("[coding_agent] Cancel flag set for session {}", session_id);
        }
    }

    {
        let mut managers = state.permission_managers.lock().await;
        if let Some(manager) = managers.remove(&session_id) {
            manager.cancel_all().await;
        }
    }

    {
        let managers = state.question_managers.lock().await;
        if let Some(manager) = managers.get("__global__") {
            manager.cancel_all().await;
        }
    }

    {
        let mut compaction_states = state.compaction_states.lock().await;
        compaction_states.remove(&session_id);
    }

    super::cleanup_session_runtime(&state, &session_id).await;

    tokio::task::spawn_blocking(move || {
        persistence::update_session_status(
            &session_id,
            persistence::CodingAgentSessionStatus::Cancelled.as_ref(),
        )
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;
    Ok(())
}

// ============================================
// Permission & Question Responses
// ============================================

/// Respond to a permission request from the coding agent.
#[tauri::command]
pub async fn coding_agent_permission_response(
    state: tauri::State<'_, CodingAgentState>,
    session_id: String,
    request_id: String,
    response: String,
    tool_name: Option<String>,
) -> Result<(), String> {
    let perm_response = match response.as_str() {
        "allow" => permission::PermissionResponse::Allow,
        "deny" => permission::PermissionResponse::Deny,
        "always_allow" => permission::PermissionResponse::AlwaysAllow,
        _ => return Err(format!("Invalid permission response: {}", response)),
    };

    let managers = state.permission_managers.lock().await;
    let manager = managers
        .get(&session_id)
        .ok_or_else(|| format!("No permission manager for session {}", session_id))?;

    manager
        .respond(&request_id, perm_response, tool_name.as_deref())
        .await;

    Ok(())
}

/// Respond to a question from the coding agent.
#[tauri::command]
pub async fn coding_agent_question_response(
    state: tauri::State<'_, CodingAgentState>,
    request_id: String,
    answers: Vec<Vec<String>>,
) -> Result<(), String> {
    let managers = state.question_managers.lock().await;
    let manager = managers
        .get("__global__")
        .ok_or_else(|| "No question manager initialized".to_string())?;

    manager.respond(&request_id, answers).await;
    Ok(())
}

/// Reject/dismiss a question from the coding agent.
#[tauri::command]
pub async fn coding_agent_question_reject(
    state: tauri::State<'_, CodingAgentState>,
    request_id: String,
) -> Result<(), String> {
    let managers = state.question_managers.lock().await;
    let manager = managers
        .get("__global__")
        .ok_or_else(|| "No question manager initialized".to_string())?;

    manager.reject(&request_id).await;
    Ok(())
}

// ============================================
// Snapshot / Revert
// ============================================

/// Revert file changes via git snapshot.
#[tauri::command]
pub async fn coding_agent_revert(
    _state: tauri::State<'_, CodingAgentState>,
    project_path: String,
    snapshot_hash: String,
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let project = PathBuf::from(&project_path);

        let changed = if let Some(ref sid) = session_id {
            let latest = persistence::get_latest_snapshot(sid).ok().flatten();
            if let Some(latest_hash) = latest {
                if latest_hash != snapshot_hash {
                    tools::snapshot::diff_between_trees(&project, &snapshot_hash, &latest_hash)
                        .map_err(|err| format!("Failed to diff snapshots: {}", err))?
                } else {
                    tools::snapshot::changed_files(&project, &snapshot_hash)
                        .map_err(|err| format!("Failed to get changed files: {}", err))?
                }
            } else {
                tools::snapshot::changed_files(&project, &snapshot_hash)
                    .map_err(|err| format!("Failed to get changed files: {}", err))?
            }
        } else {
            tools::snapshot::changed_files(&project, &snapshot_hash)
                .map_err(|err| format!("Failed to get changed files: {}", err))?
        };

        if changed.is_empty() {
            return Ok(serde_json::json!({
                "reverted": [],
                "message": "No changes to revert"
            }));
        }

        let patches = vec![(snapshot_hash.clone(), changed)];
        let reverted = tools::snapshot::revert_files(&project, &patches)
            .map_err(|err| format!("Failed to revert: {}", err))?;

        Ok(serde_json::json!({
            "reverted": reverted,
            "snapshotHash": snapshot_hash,
        }))
    })
    .await
    .map_err(|err| format!("spawn_blocking join error: {}", err))?
}

/// Revert a single file to its state in a snapshot.
#[tauri::command]
pub async fn coding_agent_revert_file(
    _state: tauri::State<'_, CodingAgentState>,
    project_path: String,
    snapshot_hash: String,
    file_path: String,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let project = PathBuf::from(&project_path);
        let patches = vec![(snapshot_hash, vec![file_path])];
        let reverted = tools::snapshot::revert_files(&project, &patches)
            .map_err(|err| format!("Failed to revert file: {}", err))?;
        Ok(!reverted.is_empty())
    })
    .await
    .map_err(|err| format!("spawn_blocking join error: {}", err))?
}

// ============================================
// Status / Config / Modes
// ============================================

/// Get coding agent status.
#[tauri::command]
pub async fn coding_agent_get_status(
    state: tauri::State<'_, CodingAgentState>,
) -> Result<serde_json::Value, String> {
    let runtimes = state.session_runtimes.lock().await;
    let initialized = !runtimes.is_empty();
    let active_sessions = runtimes.len();

    let (model, project, tool_names) =
        if let Some((_, runtime)) = runtimes.iter().next() {
            (
                Some(runtime.model.clone()),
                Some(runtime.project_path.display().to_string()),
                runtime.tool_registry.tool_names(),
            )
        } else {
            (None, None, vec![])
        };

    Ok(serde_json::json!({
        "initialized": initialized,
        "model": model,
        "projectPath": project,
        "tools": tool_names,
        "activeSessions": active_sessions,
    }))
}

/// Delete a coding agent session and all associated data.
#[tauri::command]
pub async fn coding_agent_delete_session_full(
    state: tauri::State<'_, CodingAgentState>,
    session_id: String,
) -> Result<(), String> {
    {
        let mut managers = state.permission_managers.lock().await;
        if let Some(manager) = managers.remove(&session_id) {
            manager.cancel_all().await;
        }
    }
    {
        let mut compaction_states = state.compaction_states.lock().await;
        compaction_states.remove(&session_id);
    }

    super::cleanup_session_runtime(&state, &session_id).await;

    tokio::task::spawn_blocking(move || persistence::delete_session(&session_id))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

/// Get coding agent configuration.
#[tauri::command]
pub async fn coding_agent_get_config(
    project_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = match project_path {
        Some(ref path) => super::config::CodingAgentConfig::load_for_project(&PathBuf::from(path)),
        None => super::config::CodingAgentConfig::load_global(),
    };
    serde_json::to_value(&config).map_err(|e| format!("Failed to serialize config: {}", e))
}

/// Update coding agent configuration.
#[tauri::command]
pub async fn coding_agent_update_config(
    _state: tauri::State<'_, CodingAgentState>,
    project_path: Option<String>,
    update: serde_json::Value,
) -> Result<(), String> {
    let mut config = match project_path {
        Some(ref path) => super::config::CodingAgentConfig::load_for_project(&PathBuf::from(path)),
        None => super::config::CodingAgentConfig::load_global(),
    };

    config.merge_update(&update);

    match project_path {
        Some(ref path) => config.save_for_project(&PathBuf::from(path))?,
        None => {
            let global_path = super::config::CodingAgentConfig::global_config_path();
            if let Some(parent) = global_path.parent() {
                if !parent.exists() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create config directory: {}", e))?;
                }
            }
            let json = serde_json::to_string_pretty(&config)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;
            std::fs::write(&global_path, json)
                .map_err(|e| format!("Failed to write config: {}", e))?;
        }
    }

    Ok(())
}

/// Get available agent modes and their descriptions.
#[tauri::command]
pub async fn coding_agent_list_modes() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!([
        {
            "id": "build",
            "name": "Build",
            "description": "Default mode - full tool access for implementation"
        },
        {
            "id": "plan",
            "name": "Plan",
            "description": "Read-only planning mode - analyze, design, and plan without editing files"
        },
        {
            "id": "explore",
            "name": "Explore",
            "description": "Fast codebase exploration - read and search only"
        }
    ]))
}
