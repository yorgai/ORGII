//! Subagent dispatch scenarios — pin the parameter-resolution contract of
//! `AgentTool::execute()` against the two failures reported on 2026-04-13
//! (screenshot from a teammate's SDE session):
//!
//!   1) "Invalid parameters: missing 'agent_id' (required for delegate mode)"
//!      → now falls back to `builtin:general` + warn log.
//!   2) "Executor failed: No persisted history found for session '<id>'"
//!      → now rejected upfront via a shape pre-check on `resume_session_id`.
//!   3) Subagents recursing into more subagents (custom agents with
//!      `inherit_all: true` + empty deny list) — now blocked at the top
//!      of `AgentTool::execute()` by `subagent_of_subagent_rejection`.
//!
//! The deterministic scenarios drive the debug-only
//! `/agent/test/subagent/dispatch-check` endpoint and finish sub-second.

use super::config::Config;
use super::harness;

// ── Deterministic dispatch-check scenarios ─────────────────────────

/// POST to the debug dispatch-check endpoint with the given params.
async fn dispatch_check(
    cfg: &Config,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/subagent/dispatch-check", cfg.base_url);
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("client")
        .post(&url)
        .json(&params)
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;

    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

/// Delegate mode without `agent_id` → falls back to `builtin:general` with
/// `fallback=true`. Pins the fix for Error 1; used to return `InvalidParams`.
pub async fn dispatch_delegate_no_agent_id(cfg: &Config) -> bool {
    let params = serde_json::json!({ "prompt": "do something" });
    match dispatch_check(cfg, params).await {
        Err(err) => harness::print_error("Dispatch: delegate without agent_id", &err),
        Ok(json) => {
            let resolved = json
                .get("resolved_agent_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fallback = json
                .get("agent_id_fallback")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            harness::print_result(
                "Dispatch: delegate without agent_id",
                &json.to_string(),
                &[
                    (
                        "resolved_agent_id == builtin:general",
                        resolved == "builtin:general",
                    ),
                    ("agent_id_fallback == true", fallback),
                ],
            )
        }
    }
}

/// Delegate mode with explicit `agent_id` → honored, fallback=false.
/// Control case for the happy path LLMs are supposed to hit.
pub async fn dispatch_delegate_with_agent_id(cfg: &Config) -> bool {
    let params = serde_json::json!({
        "agent_id": "builtin:explore",
        "prompt": "find stale sessions",
    });
    match dispatch_check(cfg, params).await {
        Err(err) => harness::print_error("Dispatch: delegate with explicit agent_id", &err),
        Ok(json) => {
            let resolved = json
                .get("resolved_agent_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fallback = json
                .get("agent_id_fallback")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            harness::print_result(
                "Dispatch: delegate with explicit agent_id",
                &json.to_string(),
                &[
                    (
                        "resolved_agent_id == builtin:explore",
                        resolved == "builtin:explore",
                    ),
                    ("agent_id_fallback == false", !fallback),
                ],
            )
        }
    }
}

/// Shadow mode without `agent_id` → resolved to `builtin:general` BUT
/// `fallback=false` (shadow legitimately ignores this field, so it's not
/// a miss). Protects the distinction introduced by the fix.
pub async fn dispatch_shadow_no_agent_id(cfg: &Config) -> bool {
    let params = serde_json::json!({
        "mode": "shadow",
        "prompt": "parallel subtask",
    });
    match dispatch_check(cfg, params).await {
        Err(err) => harness::print_error("Dispatch: shadow without agent_id", &err),
        Ok(json) => {
            let resolved = json
                .get("resolved_agent_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fallback = json
                .get("agent_id_fallback")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            harness::print_result(
                "Dispatch: shadow without agent_id",
                &json.to_string(),
                &[
                    (
                        "resolved_agent_id == builtin:general",
                        resolved == "builtin:general",
                    ),
                    (
                        "agent_id_fallback == false (shadow is not a miss)",
                        !fallback,
                    ),
                ],
            )
        }
    }
}

/// Resume with the exact hallucinated id from the 2026-04-13 screenshot
/// (first segment is 9 chars — not a valid UUID). Shape check must reject
/// so the runtime never hits `load_llm_history` with garbage.
pub async fn dispatch_resume_hallucinated(cfg: &Config) -> bool {
    let hallucinated = "01dc8f8ae-3b3b-7fdc-aa27-50ebe0c15839";
    let params = serde_json::json!({
        "agent_id": "builtin:general",
        "prompt": "continue",
        "resume_session_id": hallucinated,
    });
    match dispatch_check(cfg, params).await {
        Err(err) => harness::print_error("Dispatch: hallucinated resume_session_id rejected", &err),
        Ok(json) => {
            let shape_valid = json.get("resume_shape_valid").and_then(|v| v.as_bool());
            harness::print_result(
                "Dispatch: hallucinated resume_session_id rejected",
                &json.to_string(),
                &[
                    ("resume_shape_valid is non-null", shape_valid.is_some()),
                    ("resume_shape_valid == false", shape_valid == Some(false)),
                ],
            )
        }
    }
}

/// Resume with a canonical `<prefix>-<agent_id>-<uuid>` handle → shape
/// check passes (the runtime still defers existence to `load_llm_history`).
/// Documents the boundary between "shape invalid" and "shape valid but unknown".
pub async fn dispatch_resume_canonical(cfg: &Config) -> bool {
    let real_handle = format!("agent-builtin:general-{}", uuid::Uuid::new_v4());
    let params = serde_json::json!({
        "agent_id": "builtin:general",
        "prompt": "continue",
        "resume_session_id": real_handle,
    });
    match dispatch_check(cfg, params).await {
        Err(err) => {
            harness::print_error("Dispatch: canonical resume_session_id passes shape", &err)
        }
        Ok(json) => {
            let shape_valid = json.get("resume_shape_valid").and_then(|v| v.as_bool());
            harness::print_result(
                "Dispatch: canonical resume_session_id passes shape",
                &json.to_string(),
                &[("resume_shape_valid == true", shape_valid == Some(true))],
            )
        }
    }
}

/// Subagent-of-subagent guard: the root session (empty `delegation_chain`)
/// MUST be allowed to call `agent`; any non-empty chain MUST be rejected
/// with a structured error that echoes the chain so misconfigured custom
/// agents are debuggable. Drives the same `/dispatch-check` endpoint as
/// the other deterministic scenarios so it finishes sub-second.
pub async fn dispatch_subagent_cannot_spawn_subagent(cfg: &Config) -> bool {
    let root_params = serde_json::json!({
        "prompt": "spawn explore from the root session",
        "delegation_chain": [],
    });
    let root_ok = match dispatch_check(cfg, root_params).await {
        Err(err) => {
            println!("  [root] HTTP error: {err}");
            false
        }
        Ok(json) => {
            let rejected = json
                .get("subagent_recursion_rejected")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            !rejected
        }
    };

    let sub_params = serde_json::json!({
        "prompt": "try to spawn another subagent from inside a subagent",
        "delegation_chain": ["custom:manager", "custom:worker"],
    });
    let (sub_rejected, msg_echoes_chain, msg_has_rule) = match dispatch_check(cfg, sub_params).await
    {
        Err(err) => {
            println!("  [subagent] HTTP error: {err}");
            (false, false, false)
        }
        Ok(json) => {
            let rejected = json
                .get("subagent_recursion_rejected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let message = json
                .get("subagent_recursion_message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let echoes_chain =
                message.contains("custom:manager") && message.contains("custom:worker");
            let has_rule = message
                .to_lowercase()
                .contains("subagents cannot spawn other subagents");
            (rejected, echoes_chain, has_rule)
        }
    };

    harness::print_result(
        "Dispatch: subagents cannot spawn other subagents (guard chokepoint)",
        "see individual checks",
        &[
            ("Root session (empty chain) is allowed", root_ok),
            ("Subagent (non-empty chain) is rejected", sub_rejected),
            ("Rejection message states the rule", msg_has_rule),
            (
                "Rejection message echoes the full delegation chain for debugging",
                msg_echoes_chain,
            ),
        ],
    )
}

/// Background-launch message contract: when a subagent is launched with
/// `background:true`, the tool_result handed back to the parent agent must
/// (a) carry the subagent's session_id (the DB key), (b) hand the parent a
/// ready-made `sqlite3 ... agent_messages` query for progress, and (c) NOT
/// push the parent toward `await_output` polling. Pins the 2026-06-14 fix
/// that replaced "Use await_output(handle=...) to monitor progress" with
/// session-DB browsing guidance to stop the infinite-poll loop.
pub async fn background_launch_msg_no_poll(cfg: &Config) -> bool {
    let session_id = "agent-builtin:general-launchmsg-fixture";
    let params = serde_json::json!({
        "prompt": "explore the codebase in the background",
        "launch_agent_name": "Explore",
        "launch_session_id": session_id,
    });
    match dispatch_check(cfg, params).await {
        Err(err) => harness::print_error("Dispatch: background launch message no-poll", &err),
        Ok(json) => {
            let msg = json
                .get("launch_message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let lower = msg.to_lowercase();
            harness::print_result(
                "Dispatch: background launch message no-poll",
                &msg,
                &[
                    (
                        "Message carries the subagent session_id",
                        msg.contains(session_id),
                    ),
                    (
                        "Tells the parent NOT to poll with await_output",
                        lower.contains("do not call await_output"),
                    ),
                    (
                        "Hands the parent a sqlite3 agent_messages query",
                        msg.contains("sqlite3") && msg.contains("agent_messages"),
                    ),
                    (
                        "Promises automatic completion notification",
                        lower.contains("notified automatically"),
                    ),
                    (
                        "Does NOT tell the parent to monitor via await_output handle",
                        !lower.contains("await_output(handle"),
                    ),
                ],
            )
        }
    }
}
