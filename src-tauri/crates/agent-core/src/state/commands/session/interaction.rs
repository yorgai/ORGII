//! Interaction commands: questions, permissions, mode-switch, plan-approval.

use crate::foundation::session_bridge::{self, CliPlanApprovalResponseParams};
use crate::interaction::mode_switch::ModeSwitchChoice;
use crate::interaction::permission::PermissionResponse;
use crate::session::persistence as session_persistence;
use crate::session::AgentExecMode;
use crate::state::AgentAppState;

use super::identity::IdentityOverrides;
use super::message;

/// Respond to a question from the agent.
#[tauri::command]
pub async fn agent_question_response(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    request_id: String,
    answers: Vec<Vec<String>>,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await;
    if let Some(session) = session {
        session.question_manager.respond(&request_id, answers).await;
        return Ok(());
    }
    Err(format!(
        "No session found for question response: {}",
        session_id
    ))
}

/// Reject a question from the agent.
#[tauri::command]
pub async fn agent_question_reject(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    request_id: String,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await;
    if let Some(session) = session {
        session.question_manager.reject(&request_id).await;
        return Ok(());
    }
    Err(format!(
        "No session found for question reject: {}",
        session_id
    ))
}

/// Respond to a permission request from the agent.
#[tauri::command]
pub async fn agent_permission_response(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    request_id: String,
    response: String,
    tool_name: Option<String>,
    tool_args: Option<serde_json::Value>,
) -> Result<(), String> {
    let perm_response = PermissionResponse::from_wire(&response)
        .ok_or_else(|| format!("Invalid permission response: {}", response))?;

    let session = state.get_session(&session_id).await;
    if let Some(session) = session {
        session
            .permission_manager
            .respond(
                &request_id,
                perm_response,
                tool_name.as_deref(),
                tool_args.as_ref(),
            )
            .await;
        return Ok(());
    }
    Err(format!(
        "No session found for permission response: {}",
        session_id
    ))
}

/// Get pending questions for a session.
#[tauri::command]
pub async fn agent_get_pending_questions(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let session = state.get_session(&session_id).await;
    let questions = if let Some(session) = session {
        session.question_manager.get_pending_metadata().await
    } else {
        Vec::new()
    };
    Ok(serde_json::json!({ "pendingQuestions": questions }))
}

/// Respond to a mode-switch prompt from the agent.
#[tauri::command]
pub async fn agent_mode_switch_response(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    choice: String,
    target_mode: Option<String>,
) -> Result<(), String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("No session found: {}", session_id))?;

    let manager = session
        .mode_switch_manager
        .as_ref()
        .ok_or_else(|| format!("Session {} has no mode-switch manager", session_id))?;

    let decision = ModeSwitchChoice::from_wire(&choice, target_mode)
        .ok_or_else(|| format!("Invalid mode-switch choice: {}", choice))?;

    manager.respond(decision).await;
    Ok(())
}

/// Query the pending plan approval snapshot for a session (if any).
///
/// Called on session mount/switch so the frontend can rehydrate
/// `pendingPlanApprovalsAtom` after a page refresh or window re-focus.
/// Returns `null` when no plan is currently pending.
///
/// Lookup order:
///   1. In-memory `PlanApprovalManager::pending_snapshot` when the
///      session is already initialized (hot-path during a live session).
///   2. DB fallback via `plan_approval::load_snapshot_for_session` when
///      the session object hasn't been created yet — this is the normal
///      path on the first window focus after an app restart, before the
///      user has typed anything into this session. Without this branch
///      the Build button would stay disabled until the user sent an
///      unrelated message that triggered `ensure_session_initialized`.
#[tauri::command]
pub async fn agent_get_pending_plan_approval(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let live_snapshot = match state.get_session(&session_id).await {
        Some(session) => match session.plan_approval_manager.as_ref() {
            Some(manager) => manager.pending_snapshot().await,
            None => None,
        },
        None => None,
    };
    let snapshot = match live_snapshot {
        Some(snapshot) => Some(snapshot),
        None => crate::interaction::plan_approval::load_snapshot_for_session(&session_id).await?,
    };

    let Some(snapshot) = snapshot else {
        return Ok(None);
    };

    Ok(Some(serde_json::json!({
        "sessionId": &snapshot.session_id,
        "planPath": &snapshot.plan_path,
        "planTitle": &snapshot.plan_title,
        "planContent": &snapshot.plan_content,
        "toolCallId": &snapshot.tool_call_id,
        "planId": &snapshot.plan_id,
        "planRevisionId": &snapshot.plan_revision_id,
        "originToolCallId": &snapshot.origin_tool_call_id,
    })))
}

/// Build button response from the plan card.
///
/// `choice` is `"approve"` (plain), `"approve_with_edits"` (edited plan
/// content supplied), or `"reject"` (skip the pending plan without starting
/// a Build turn).
///
/// This command:
///   1. Consumes the pending plan snapshot from `PlanApprovalManager`.
///   2. When `approve_with_edits`, overwrites the plan file with the edited
///      content so the next turn reads the user's version.
///   3. Consumes `pre_plan_mode_cache` and broadcasts `agent:exit_plan_mode`
///      so the frontend flips the per-session exec mode back to the previous mode.
///   4. Clears `plan_slot_cache` so a future `create_plan` starts fresh.
///   5. Kicks off a **new Build-mode turn** with a synthetic user-visible
///      message instructing the LLM to start implementing the approved plan.
///      Clicking Build immediately produces a new turn that writes the todo
///      list and begins executing. There is
///      no hidden deferred `tool_result` injection — every state change is
///      visible in the transcript as a real user/assistant exchange.
///
/// `handle` is taken so we can re-enter `send_message_impl`, which needs a
/// `tauri::State<AgentAppState>` and a live `app_handle` via `state.app_handle`.
#[tauri::command]
pub async fn agent_plan_approval_response(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    choice: String,
    edited_content: Option<String>,
    model: Option<String>,
    account_id: Option<String>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let session = state.get_session(&session_id).await;

    if session_bridge::get_cli_tools_snapshot(&session_id)?.is_some() {
        let rejected = choice == "reject";
        let cli_snapshot =
            crate::interaction::plan_approval::load_snapshot_for_session(&session_id).await?;
        session_bridge::respond_cli_plan_approval(CliPlanApprovalResponseParams {
            session_id,
            choice,
            edited_content,
            model,
            account_id,
            workspace_path,
        })
        .await?;
        if let (Some(handle), Some(snapshot)) = (state.app_handle.as_ref(), cli_snapshot.as_ref()) {
            crate::interaction::plan_approval::push_plan_approval_resolution_event(
                handle, snapshot, rejected,
            );
        }
        return Ok(());
    }

    // Fast path: live session with an initialized manager. Slow path:
    // the FE clicked Build on the very first window focus after an app
    // restart — no message has been sent yet, so the agent pipeline
    // never entered `ensure_session_initialized` and the in-memory
    // session object does not exist. Create it here so the plan row
    // that was persisted by the previous run rehydrates into
    // `PlanApprovalManager` before we `take_pending()` below.
    if session.is_none() {
        crate::init::register_session_with_rehydrate(&state, &session_id).await?;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("No session found: {}", session_id))?;

    let manager = session
        .plan_approval_manager
        .as_ref()
        .ok_or_else(|| format!("Session {} has no plan-approval manager", session_id))?;

    let edited = match choice.as_str() {
        "approve" => None,
        "approve_with_edits" => Some(
            edited_content
                .ok_or_else(|| "approve_with_edits requires `edited_content`".to_string())?,
        ),
        "reject" => None,
        other => return Err(format!("Invalid plan-approval choice: {}", other)),
    };
    let rejected = choice == "reject";

    let snapshot = if rejected {
        manager
            .reject_pending()
            .await
            .ok_or_else(|| format!("No pending plan approval for session {}", session_id))?
    } else {
        manager
            .take_pending()
            .await
            .ok_or_else(|| format!("No pending plan approval for session {}", session_id))?
    };

    if let Some(ref new_content) = edited {
        std::fs::write(&snapshot.plan_path, new_content.as_bytes())
            .map_err(|err| format!("Failed to persist edited plan: {}", err))?;
    }

    let restore_mode = session
        .pre_plan_mode_cache
        .take(&session_id)
        .unwrap_or(AgentExecMode::Plan);
    let build_turn_mode = AgentExecMode::Build;

    session.plan_slot_cache.clear(&session_id);

    session_persistence::update_agent_exec_mode(&session_id, restore_mode.as_str())
        .map_err(|err| format!("Failed to persist restored agent exec mode: {err}"))?;

    crate::bus::broadcast_event(
        "agent:exit_plan_mode",
        serde_json::json!({
            "sessionId": &session_id,
            "planPath": &snapshot.plan_path,
            "planTitle": &snapshot.plan_title,
            "toolCallId": &snapshot.tool_call_id,
            "planId": &snapshot.plan_id,
            "planRevisionId": &snapshot.plan_revision_id,
            "originToolCallId": &snapshot.origin_tool_call_id,
            "restoreMode": restore_mode.as_str(),
            "edited": edited.is_some(),
            "rejected": rejected,
        }),
    );

    if rejected {
        return Ok(());
    }

    // ── Kick off the Build turn ──────────────────────────────────────────
    //
    // Why we re-enter `send_message_impl` here instead of writing a custom
    // "resume" path:
    //   * `send_message_impl` already handles scheduler enqueue, runtime
    //     resolution, cancel-flag reset, and turn stats. Duplicating any
    //     of that would drift on the next refactor.
    //
    let plan_body = std::fs::read_to_string(&snapshot.plan_path)
        .map_err(|err| format!("Failed to read approved plan: {}", err))?;
    let synthetic_content = format!(
        "[Plan approved{edited_marker}] Implement the approved plan now.\n\n\
         Execute the approved plan directly. Use the available coding tools to make the requested changes. \
         If the plan is genuinely complex, you may use `manage_todo` with its schema to track execution, \
         but do not create another plan.\n\n\
         ## Approved plan\n\n{plan_body}",
        edited_marker = if edited.is_some() { " (edited)" } else { "" },
    );

    // Prefer the FE-supplied identity (model / account_id / workspace_path)
    // from the current chat composer over DB fallbacks. After an app
    // restart the in-memory runtime is empty, and the DB row may be stale
    // if the user switched model/account since the plan was drafted —
    // using what the composer currently shows is always the least
    // surprising behavior ("Build with whatever I'm about to send").
    // `send_message_impl` will still fall back to runtime/DB for any
    // field the FE leaves as `None`.
    let overrides = IdentityOverrides {
        model,
        account_id,
        workspace_root: workspace_path,
        native_harness_type: None,
    };
    message::send_message_impl(
        &state,
        session_id.clone(),
        synthetic_content,
        None,
        overrides,
        Some(build_turn_mode.as_str().to_string()),
        None,
        None,
        false,
        false,
        None,
    )
    .await
    .map(|_| ())
    .map_err(|err| format!("Failed to kick off Build turn after plan approval: {}", err))
}
