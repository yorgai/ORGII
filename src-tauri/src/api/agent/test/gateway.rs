//! Dev-only channel test endpoints.
//!
//! History: this module used to host a dozen probes for the Gateway LLM
//! router (Tier-0/Tier-1 routing, `create_and_route_session`,
//! `prompt-singleton`, `list-agents`, etc.). The Gateway was retired in
//! favour of an OS-agent-per-chat architecture (April 2026). Everything
//! LLM-routing-specific was deleted; what remains are the generic channel
//! plumbing probes still useful for dogfooding + smoke tests:
//!
//! - `inject_normal` — push an inbound message through the full handler
//!   so slash commands, bindings, and re-inject paths can be observed.
//! - `binding_set` / `binding_get` — raw read/write against the in-memory
//!   `(channel, chat_id) → session_id` store.
//! - `archive_session` / `backdate_binding` — time-shift helpers for
//!   idle-reset scenarios.
//! - `outbound_snapshot` — drain the debug-only outbound capture.
//! - `outbound_tap/{arm,disarm,drain}` — arm the tap for the interactive
//!   `gateway-chat-cli` dogfood harness.
//! - `set_reset_policy` / `force_compact` — mutate the reset policy and
//!   force-fork a session for compact tests.
//!
//! Only compiled in dev builds; `create_routes` in `api/agent/mod.rs`
//! calls these via `test::gateway::*`.

#![cfg(debug_assertions)]

use axum::Json;
use serde::Deserialize;

// ============================================
// Binding store probes
// ============================================

#[derive(Debug, Deserialize)]
pub struct GatewayBindingSetRequest {
    session_key: String,
    target_session_id: String,
}

/// Force-write a binding via the production
/// `state.gateway_bindings.set` store API. Lets E2E short-circuit the
/// Gateway LLM decision for a chat, so Tier-0 can be tested in
/// isolation. This is a **store-level fixture probe**, not a
/// caller-path probe — the LLM-driven binding-decision path is
/// covered separately by `test_gateway_inject_normal` exercising the
/// real inbound processor.
pub async fn test_gateway_binding_set(
    Json(request): Json<GatewayBindingSetRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({
                "error": "AppHandle not initialized."
            }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    let key = agent_core::integrations::gateway::SessionKey(request.session_key.clone());
    state
        .gateway_bindings
        .set(key, request.target_session_id.clone())
        .await;
    Json(serde_json::json!({
        "ok": true,
        "session_key": request.session_key,
        "target_session_id": request.target_session_id,
    }))
}

#[derive(Debug, Deserialize)]
pub struct GatewayBindingGetRequest {
    session_key: String,
}

/// Read a binding out of the store. Always returns a valid JSON object,
/// never an empty body.
pub async fn test_gateway_binding_get(
    Json(request): Json<GatewayBindingGetRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle not initialized.",
                "session_key": request.session_key,
                "binding": serde_json::Value::Null,
                "target_session_id": serde_json::Value::Null,
                "updated_at": serde_json::Value::Null,
                "last_activity_at": serde_json::Value::Null,
            }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    let key = agent_core::integrations::gateway::SessionKey(request.session_key.clone());
    let binding = state.gateway_bindings.get(&key).await;
    let binding_obj = binding.as_ref().map(|b| {
        serde_json::json!({
            "target_session_id": b.target_session_id,
            "updated_at": b.updated_at,
            "last_activity_at": b.last_activity_at,
        })
    });
    Json(serde_json::json!({
        "ok": true,
        "session_key": request.session_key,
        "binding": binding_obj,
        "target_session_id": binding.as_ref().map(|b| b.target_session_id.clone()),
        "updated_at": binding.as_ref().map(|b| b.updated_at.clone()),
        "last_activity_at": binding.as_ref().map(|b| b.last_activity_at.clone()),
    }))
}

// ============================================
// Idle-reset / archive / outbound probes
// ============================================

#[derive(Debug, Deserialize)]
pub struct GatewayArchiveSessionRequest {
    session_id: String,
}

/// Force a session's status to `archived` and invalidate its in-memory
/// runtime. Lets E2E skip the "wait for idle window" step when
/// validating that the archive-filter in `list_sessions` hides the row.
pub async fn test_gateway_archive_session(
    Json(request): Json<GatewayArchiveSessionRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({ "error": "AppHandle not initialized." }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    let session_id = request.session_id.clone();
    // The chain `.ok().and_then(|r| r.ok()).unwrap_or(false)` silently
    // collapsed both a JoinError (worker panicked) and an Err from
    // `update_status` (DB write failed) into `archived: false`,
    // which the E2E runner would mis-read as "we tried but the row
    // wasn't there to archive". Warn so persistence failures are
    // distinguishable from a benign no-op.
    let archived = match tokio::task::spawn_blocking(move || {
        agent_core::core::session::persistence::update_status(
            &session_id,
            agent_core::core::session::SessionStatus::Archived,
        )
    })
    .await
    {
        Ok(Ok(_)) => true,
        Ok(Err(err)) => {
            tracing::warn!(
                error = %err,
                "test::gateway::archive: update_status DB error"
            );
            false
        }
        Err(err) => {
            tracing::warn!(
                error = %err,
                "test::gateway::archive: update_status task panicked"
            );
            false
        }
    };
    state.invalidate_session(&request.session_id).await;
    Json(serde_json::json!({
        "ok": true,
        "session_id": request.session_id,
        "archived": archived,
    }))
}

#[derive(Debug, Deserialize)]
pub struct GatewayBackdateBindingRequest {
    session_key: String,
    minutes_ago: u64,
}

/// Backdate a binding's `last_activity_at` so the next inbound message
/// trips the idle-reset threshold without the test having to wait
/// `idle_minutes` real seconds.
pub async fn test_gateway_backdate_binding(
    Json(request): Json<GatewayBackdateBindingRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({ "error": "AppHandle not initialized." }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    let backdated_iso =
        (chrono::Utc::now() - chrono::Duration::minutes(request.minutes_ago as i64)).to_rfc3339();
    let updated = state
        .gateway_bindings
        .test_backdate(&request.session_key, &backdated_iso)
        .await;
    Json(serde_json::json!({
        "ok": true,
        "session_key": request.session_key,
        "last_activity_at": backdated_iso,
        "found": updated,
    }))
}

#[derive(Debug, Deserialize, Default)]
pub struct GatewayOutboundSnapshotRequest {
    #[serde(default)]
    clear: bool,
}

pub async fn test_gateway_outbound_snapshot(
    Json(request): Json<GatewayOutboundSnapshotRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({ "error": "AppHandle not initialized." }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();
    let mut buf = state.debug_outbound_capture.lock().await;
    let msgs: Vec<serde_json::Value> = buf
        .iter()
        .map(|(channel, chat_id, content)| {
            serde_json::json!({
                "channel": channel,
                "chat_id": chat_id,
                "content": content,
            })
        })
        .collect();
    if request.clear {
        buf.clear();
    }
    let pending = state.pending_reset_notifies.lock().await;
    let pending_entries: Vec<serde_json::Value> = pending
        .iter()
        .map(|(k, v)| serde_json::json!({ "key": k, "notice": v }))
        .collect();
    Json(serde_json::json!({
        "ok": true,
        "messages": msgs,
        "pending_reset_notifies": pending_entries,
    }))
}

// ─── Interactive dogfood outbound tap (debug-only) ──────────────────────────
//
// Three endpoints cooperate with `bin/gateway_chat_cli` so an operator can
// type into a terminal and watch the agent reply without a real channel
// connected. The tap is a pure copy-on-send mirror; it never blocks or
// modifies real delivery, and defaults to disarmed.

pub async fn test_gateway_outbound_tap_arm() -> Json<serde_json::Value> {
    agent_core::channels::debug_tap::arm();
    Json(serde_json::json!({ "ok": true, "armed": true }))
}

pub async fn test_gateway_outbound_tap_disarm() -> Json<serde_json::Value> {
    agent_core::channels::debug_tap::disarm();
    Json(serde_json::json!({ "ok": true, "armed": false }))
}

#[derive(Debug, Deserialize, Default)]
pub struct OutboundTapDrainRequest {
    #[serde(default = "default_drain_clear")]
    clear: bool,
}

fn default_drain_clear() -> bool {
    true
}

pub async fn test_gateway_outbound_tap_drain(
    Json(request): Json<OutboundTapDrainRequest>,
) -> Json<serde_json::Value> {
    let samples = agent_core::channels::debug_tap::drain(request.clear);
    let msgs: Vec<serde_json::Value> = samples
        .into_iter()
        .map(|(channel, chat_id, content)| {
            serde_json::json!({
                "channel": channel,
                "chat_id": chat_id,
                "content": content,
            })
        })
        .collect();
    Json(serde_json::json!({
        "ok": true,
        "armed": agent_core::channels::debug_tap::is_armed(),
        "messages": msgs,
    }))
}

// ============================================
// Reset policy + force-compact
// ============================================

#[derive(Debug, Deserialize)]
pub struct GatewaySetResetPolicyRequest {
    mode: String,
    #[serde(default = "default_policy_idle_minutes")]
    idle_minutes: u64,
    #[serde(default = "default_policy_notify")]
    notify: bool,
}

fn default_policy_idle_minutes() -> u64 {
    240
}

fn default_policy_notify() -> bool {
    true
}

pub async fn test_gateway_set_reset_policy(
    Json(request): Json<GatewaySetResetPolicyRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({ "error": "AppHandle not initialized." }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();

    let mode = match request.mode.as_str() {
        "none" => agent_core::integrations::gateway::ResetMode::None,
        "idle" => agent_core::integrations::gateway::ResetMode::Idle,
        other => {
            return Json(serde_json::json!({
                "error": format!("unknown reset mode '{}' (expected 'none' or 'idle')", other)
            }));
        }
    };

    let _ = state.integrations.update(|cfg| {
        cfg.channels.gateway.reset_policy = agent_core::integrations::gateway::ResetPolicy {
            mode,
            idle_minutes: request.idle_minutes,
            notify: request.notify,
        };
        Ok::<(), std::convert::Infallible>(())
    });

    Json(serde_json::json!({
        "ok": true,
        "mode": request.mode,
        "idle_minutes": request.idle_minutes,
        "notify": request.notify,
    }))
}

#[derive(Debug, Deserialize)]
pub struct GatewayForceCompactRequest {
    session_id: String,
}

/// Force a compact-fork for a given session without waiting for the real
/// compactor. Synthesizes a 3-message compacted transcript and drives
/// `compact_fork::attempt_fork` directly so the fork behaviour is
/// observable deterministically.
pub async fn test_gateway_force_compact(
    Json(request): Json<GatewayForceCompactRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({ "error": "AppHandle not initialized." }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();

    let synthetic_compacted = vec![
        serde_json::json!({"role": "system", "content": "compacted"}),
        serde_json::json!({"role": "user", "content": "[prior user messages compacted]"}),
        serde_json::json!({"role": "assistant", "content": "[prior assistant messages compacted]"}),
    ];

    let reset_policy = state
        .integrations
        .snapshot()
        .channels
        .gateway
        .reset_policy
        .clone();

    let outcome = agent_core::core::session::compaction::fork::attempt_fork(
        agent_core::core::session::compaction::fork::ForkInputs {
            state: state.inner(),
            compacted_messages: &synthetic_compacted,
            old_session_id: &request.session_id,
            reset_policy: &reset_policy,
        },
    )
    .await;

    match outcome {
        agent_core::core::session::compaction::fork::ForkOutcome::Forked { new_session_id } => {
            Json(serde_json::json!({
                "ok": true,
                "outcome": "forked",
                "old_session_id": request.session_id,
                "new_session_id": new_session_id,
            }))
        }
        agent_core::core::session::compaction::fork::ForkOutcome::NotChannelAttached => {
            Json(serde_json::json!({
                "ok": false,
                "outcome": "not_channel_attached",
                "old_session_id": request.session_id,
            }))
        }
        agent_core::core::session::compaction::fork::ForkOutcome::Failed(reason) => {
            Json(serde_json::json!({
                "ok": false,
                "outcome": "failed",
                "old_session_id": request.session_id,
                "reason": reason,
            }))
        }
    }
}

// ============================================
// Caller-path inbound probe (used by gateway-chat-cli)
// ============================================

#[derive(Debug, Deserialize)]
pub struct GatewayInjectNormalRequest {
    /// External channel label (e.g. "telegram:default"). Must NOT be the
    /// reserved re-inject marker.
    source_channel: String,
    source_chat_id: String,
    #[serde(default)]
    sender_id: Option<String>,
    /// Message body. If it starts with `/new`, `/status`, `/compact`, or
    /// `/help`, the command path runs; otherwise the binding/OS path
    /// runs.
    content: String,
    /// Optional default model seeded into `channels.gateway.model` when
    /// empty. `dispatch_to_session` reads this to resolve a provider
    /// when initializing a fresh OS session on first inbound.
    #[serde(default)]
    model: Option<String>,
    /// Optional account_id seeded into `channels.gateway.account_id`
    /// (and `state.current_account_id` when empty) before dispatch.
    #[serde(default)]
    account_id: Option<String>,
}

/// Push a non-reinject `InboundMessage` onto the channel queue. This is
/// the caller-path probe used by the dogfood CLI and by E2E to exercise
/// the real inbound processor end-to-end.
pub async fn test_gateway_inject_normal(
    Json(request): Json<GatewayInjectNormalRequest>,
) -> Json<serde_json::Value> {
    use tauri::Manager;

    let handle = match crate::api::get_app_handle() {
        Some(h) => h,
        None => {
            return Json(serde_json::json!({
                "error": "AppHandle not initialized."
            }));
        }
    };
    let state = handle.state::<agent_core::state::AgentAppState>();

    if request.model.is_some() {
        let _ = state.integrations.update(|cfg| {
            if let Some(ref model) = request.model {
                if cfg
                    .channels
                    .gateway
                    .model
                    .as_deref()
                    .unwrap_or("")
                    .is_empty()
                {
                    cfg.channels.gateway.model = Some(model.clone());
                }
            }
            Ok::<(), std::convert::Infallible>(())
        });
    }
    if let Some(ref aid) = request.account_id {
        let mut current = state.current_account_id.lock().await;
        if current.is_none() {
            *current = Some(aid.clone());
        }
        let _ = state.integrations.update(|cfg| {
            if cfg
                .channels
                .gateway
                .account_id
                .as_deref()
                .unwrap_or("")
                .is_empty()
            {
                cfg.channels.gateway.account_id = Some(aid.clone());
            }
            Ok::<(), std::convert::Infallible>(())
        });
    }

    if let Err(err) =
        agent_core::state::commands::channel_handler::ensure_gateway_infra(&state).await
    {
        return Json(serde_json::json!({
            "error": format!("ensure_gateway_infra failed: {}", err)
        }));
    }

    use agent_core::bus::InboundMessage;

    let mut msg = InboundMessage::new(
        &request.source_channel,
        request.sender_id.as_deref().unwrap_or(""),
        &request.source_chat_id,
        &request.content,
    );
    if let Some(ref sender) = request.sender_id {
        msg.sender_id = sender.clone();
    }

    let sender = {
        let bus = state.gateway.bus.lock().await;
        bus.inbound_sender()
    };
    if let Err(err) = sender.send(msg).await {
        return Json(serde_json::json!({
            "error": format!("inbound_sender.send failed: {}", err)
        }));
    }

    Json(serde_json::json!({
        "ok": true,
        "source_channel": request.source_channel,
        "source_chat_id": request.source_chat_id,
    }))
}
