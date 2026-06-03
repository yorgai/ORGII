//! Agent-team task system + ExecModeSetRequest E2E scenarios.
//!
//! Matrix:
//! - helper-isolation: scenarios in this file seed state via
//!   `/test/agent-org/tasks/seed` and `/test/agent-org/inbox/seed`, drive
//!   the production `drain_and_render_deferred` helper directly through
//!   `/test/agent-org/drain-inbox`, and assert on post-state via
//!   `/test/agent-org/tasks/list` and `/test/agent-org/inbox/list-by-run`.
//!   These pin the tool/store/helper contract only.
//! - caller-path: `agent_org.rs` launch/run-view scenarios drive
//!   `/test/agent-org/launch-coordinator`, `/test/agent-org/follow-up-message`,
//!   or the wake path in `agent_org_session_return_to_work`; those prove a real
//!   session launch/follow-up/wake reaches the helper instead of just the debug
//!   endpoint.
//! - rendered UI: frontend rendered E2E must assert user-visible history and
//!   run-view badges/cards. Helper endpoints may seed or inspect, but must not
//!   be the side-effect path for rendered history assertions.

use super::agent_org::{http_client, list_inbox, messages_array, post_send, unique_run_id};
use super::config::Config;
use super::harness;

const TASK_DEPENDENCY_CYCLE_ERROR: &str = "task_dependency_cycle";
const TOOL_ERROR_INVALID_PARAMS: &str = "invalid_params";
const TASK_TOOL_DIRECT_PATH: &str = "/agent/test/agent-org/task-tool-direct";
const TASKS_SEED_PATH: &str = "/agent/test/agent-org/tasks/seed";
const TASKS_LIST_PATH: &str = "/agent/test/agent-org/tasks/list";
const STALE_WORKERS_SEED_RUN_PATH: &str = "/agent/test/agent-org/stale-workers/seed-run";
const STALE_WORKERS_RELEASE_TASKS_PATH: &str = "/agent/test/agent-org/stale-workers/release-tasks";
const INBOX_SEED_PATH: &str = "/agent/test/agent-org/inbox/seed";
const DRAIN_INBOX_PATH: &str = "/agent/test/agent-org/drain-inbox";

fn default_org_context(run_id: &str) -> serde_json::Value {
    serde_json::json!({
        "org_run_id": run_id,
        "org_id": "test-org-team-tasks",
        "org_name": "Team Tasks Org",
        "org_role": "team",
        "coordinator_agent_id": "coord",
        "coordinator_name": "Team Tasks Org",
        "coordinator_role": "lead",
        "members": [
            {
                "member_id": "m1",
                "name": "Alice",
                "role": "worker",
                "agent_id": "alice-agent",
            },
            {
                "member_id": "m2",
                "name": "Bob",
                "role": "worker",
                "agent_id": "bob-agent",
            },
        ],
    })
}

fn member_id_for_agent(agent_id: &str) -> Option<&'static str> {
    match agent_id {
        "alice-agent" => Some("m1"),
        "bob-agent" => Some("m2"),
        "coord" => Some("coordinator"),
        _ => None,
    }
}

fn drain_body(run_id: &str, recipient_agent_id: &str) -> serde_json::Value {
    let mut body = default_org_context(run_id);
    let obj = body.as_object_mut().expect("object");
    obj.insert(
        "recipient_agent_id".to_string(),
        serde_json::Value::String(recipient_agent_id.to_string()),
    );
    if let Some(member_id) = member_id_for_agent(recipient_agent_id) {
        obj.insert(
            "recipient_member_id".to_string(),
            serde_json::Value::String(member_id.to_string()),
        );
    }
    body
}

async fn post_json(
    cfg: &Config,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", cfg.base_url, path);
    let resp = http_client()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("HTTP error ({path}): {err}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error ({path}): {err}"))
}

async fn task_tool_direct(
    cfg: &Config,
    run_id: &str,
    operation: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut body = default_org_context(run_id);
    let obj = body.as_object_mut().expect("object");
    obj.insert(
        "sender_agent_id".to_string(),
        serde_json::Value::String("coord".to_string()),
    );
    obj.insert(
        "sender_member_id".to_string(),
        serde_json::Value::String("coordinator".to_string()),
    );
    obj.insert(
        "operation".to_string(),
        serde_json::Value::String(operation.to_string()),
    );
    obj.insert("params".to_string(), params);
    post_json(cfg, TASK_TOOL_DIRECT_PATH, body).await
}

async fn seed_task(
    cfg: &Config,
    run_id: &str,
    id: &str,
    subject: &str,
    owner: Option<&str>,
    status: &str,
) -> Result<serde_json::Value, String> {
    seed_task_with_dependencies(cfg, run_id, id, subject, owner, status, &[], &[]).await
}

async fn seed_task_with_dependencies(
    cfg: &Config,
    run_id: &str,
    id: &str,
    subject: &str,
    owner: Option<&str>,
    status: &str,
    blocks: &[&str],
    blocked_by: &[&str],
) -> Result<serde_json::Value, String> {
    let mut body = serde_json::json!({
        "id": id,
        "org_run_id": run_id,
        "subject": subject,
        "description": "",
        "status": status,
        "blocks": blocks,
        "blocked_by": blocked_by,
    });
    if let Some(owner_agent_id) = owner {
        body.as_object_mut().unwrap().insert(
            "owner".into(),
            serde_json::Value::String(owner_agent_id.to_string()),
        );
    }
    let resp = post_json(cfg, TASKS_SEED_PATH, body).await?;
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("tasks/seed rejected payload: {resp}"));
    }
    Ok(resp)
}

async fn list_tasks(cfg: &Config, run_id: &str) -> Result<serde_json::Value, String> {
    post_json(
        cfg,
        TASKS_LIST_PATH,
        serde_json::json!({ "org_run_id": run_id }),
    )
    .await
}

async fn seed_inbox(
    cfg: &Config,
    run_id: &str,
    sender: &str,
    recipient: &str,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut body = serde_json::json!({
        "org_run_id": run_id,
        "sender_agent_id": sender,
        "recipient_agent_id": recipient,
        "message": message,
    });
    if let Some(sender_member_id) = member_id_for_agent(sender) {
        body.as_object_mut().expect("object").insert(
            "sender_member_id".to_string(),
            serde_json::Value::String(sender_member_id.to_string()),
        );
    }
    if let Some(recipient_member_id) = member_id_for_agent(recipient) {
        body.as_object_mut().expect("object").insert(
            "recipient_member_id".to_string(),
            serde_json::Value::String(recipient_member_id.to_string()),
        );
    }
    let resp = post_json(cfg, INBOX_SEED_PATH, body).await?;
    // The seed endpoint silently returns `{ok:false, error:...}` when
    // the message payload fails to deserialize as `AgentMessage` (e.g.
    // wrong field shape). Surface that as an explicit error so test
    // authors notice immediately instead of seeing downstream "drain
    // rendered 0" failures.
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(format!("inbox/seed rejected payload: {resp}"));
    }
    Ok(resp)
}

async fn drain(cfg: &Config, run_id: &str, recipient: &str) -> Result<serde_json::Value, String> {
    post_json(cfg, DRAIN_INBOX_PATH, drain_body(run_id, recipient)).await
}

fn tasks_array(resp: &serde_json::Value) -> Result<&Vec<serde_json::Value>, String> {
    let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("tasks/list returned ok=false: {err}"));
    }
    resp.get("tasks")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "tasks/list response missing tasks array".to_string())
}

// ────────────────────────────────────────────────────────────────────────
// Autonomous claim
// ────────────────────────────────────────────────────────────────────────

/// Happy path. Pins the autonomous-claim side effect: when an idle
/// worker drains and there is at least one unowned, non-resolved task
/// in the run, the drain helper picks the oldest available task,
/// atomically flips its owner and status, and posts a system-authored
/// `TaskAssigned` envelope to the worker's own inbox.
pub async fn idle_member_autonomous_claim_assigns_oldest_pending(cfg: &Config) -> bool {
    let label = "Agent-Org: idle worker autonomously claims oldest pending task";
    let run_id = unique_run_id("team-tasks-claim");

    if let Err(err) = seed_task(cfg, &run_id, "task-A", "Refactor auth", None, "pending").await {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(cfg, &run_id, "task-B", "Update docs", None, "pending").await {
        return harness::print_error(label, &err);
    }

    let drain_resp = match drain(cfg, &run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rendered_attachment = drain_resp
        .get("messages")
        .and_then(|value| value.as_array())
        .and_then(|messages| messages.first())
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let active_task_context_rendered = rendered_attachment.contains("<task_assigned")
        && rendered_attachment.contains("task_id=\"task-A\"")
        && rendered_attachment.contains("subject=\"Refactor auth\"")
        && rendered_attachment.contains("assigned_by=\"system\"");

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };

    let task_a = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-A"));
    let task_b = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-B"));

    let claimed_one = task_a
        .and_then(|t| t.get("owner").and_then(|v| v.as_str()))
        .map(|owner| owner == "m1")
        .unwrap_or(false);
    let status_in_progress = task_a
        .and_then(|t| t.get("status").and_then(|v| v.as_str()))
        .map(|s| s == "in_progress")
        .unwrap_or(false);
    let other_untouched = task_b
        .and_then(|t| t.get("owner"))
        .map(|v| v.is_null())
        .unwrap_or(false);

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let task_assigned_row = messages
        .iter()
        .find(|r| r.get("payload_kind").and_then(|v| v.as_str()) == Some("task_assigned"));
    let assigned_present = task_assigned_row.is_some();
    let assigned_to_alice = task_assigned_row
        .and_then(|r| r.get("recipient_member_id").and_then(|v| v.as_str()))
        == Some("m1");
    let assigned_from_system = task_assigned_row
        .and_then(|r| r.get("sender_agent_id").and_then(|v| v.as_str()))
        == Some("_system");
    let assigned_payload_ok = task_assigned_row
        .and_then(|r| r.get("payload_decoded"))
        .map(|p| {
            p.get("task_id").and_then(|v| v.as_str()) == Some("task-A")
                && p.get("assigned_by")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    let output = serde_json::json!({
        "drain": drain_resp,
        "tasks": tasks_resp,
    });

    harness::print_result(
        label,
        &output.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            (
                "drain attachment includes active task context",
                active_task_context_rendered,
            ),
            ("task-A owner == m1", claimed_one),
            ("task-A status flipped to in_progress", status_in_progress),
            (
                "task-B left untouched (single-claim per drain)",
                other_untouched,
            ),
            ("task_assigned row present", assigned_present),
            ("task_assigned recipient is alice-agent", assigned_to_alice),
            ("task_assigned sender is _system", assigned_from_system),
            (
                "task_assigned payload references task-A + assigned_by",
                assigned_payload_ok,
            ),
        ],
    )
}

/// Negative pin. Coordinator drains its own inbox and must NOT
/// autonomously claim — the autonomous-claim path is gated to
/// non-coordinator members. Without this pin a refactor of the gate
/// would silently turn the lead into a worker.
pub async fn coordinator_drain_does_not_autonomously_claim(cfg: &Config) -> bool {
    let label = "Agent-Org: coordinator drain does NOT autonomously claim";
    let run_id = unique_run_id("team-tasks-coord-skip");

    if let Err(err) = seed_task(cfg, &run_id, "task-X", "Lead-only", None, "pending").await {
        return harness::print_error(label, &err);
    }

    let drain_resp = match drain(cfg, &run_id, "coord").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let task_x = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-X"));
    let owner_still_null = task_x
        .and_then(|t| t.get("owner"))
        .map(|v| v.is_null())
        .unwrap_or(false);
    let status_still_pending =
        task_x.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("pending");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_assigned_row = messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("task_assigned"));

    harness::print_result(
        label,
        &tasks_resp.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            ("task-X owner still null", owner_still_null),
            ("task-X status still pending", status_still_pending),
            ("no task_assigned row in inbox", no_assigned_row),
        ],
    )
}

/// Busy-skip pin. A worker who already owns a non-resolved task does
/// NOT autonomously claim a second one — the per-agent
/// `has_open_task_for_owner` gate keeps work serialized on the worker
/// side, with an early-out when the agent has any in-progress task.
pub async fn busy_member_skips_autonomous_claim(cfg: &Config) -> bool {
    let label = "Agent-Org: worker with open task skips autonomous claim";
    let run_id = unique_run_id("team-tasks-busy");

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-already-mine",
        "Existing work",
        Some("m1"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(cfg, &run_id, "task-extra", "Extra", None, "pending").await {
        return harness::print_error(label, &err);
    }

    let drain_resp = match drain(cfg, &run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let extra = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-extra"));
    let extra_unowned = extra
        .and_then(|t| t.get("owner"))
        .map(|v| v.is_null())
        .unwrap_or(false);
    let extra_pending =
        extra.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("pending");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_assigned_row = messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("task_assigned"));

    harness::print_result(
        label,
        &tasks_resp.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            ("extra task left unowned", extra_unowned),
            ("extra task status still pending", extra_pending),
            ("no task_assigned row from busy worker", no_assigned_row),
        ],
    )
}

/// Atomicity pin. Two idle members can race the same production drain
/// path, but the underlying claim must have exactly one winner: one
/// owner on the task and one `task_assigned` row in the inbox.
pub async fn concurrent_autonomous_claim_has_single_winner(cfg: &Config) -> bool {
    let label = "Agent-Org: concurrent autonomous claim has a single winner";
    let run_id = unique_run_id("team-tasks-concurrent-claim");

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-race",
        "Race for one task",
        None,
        "pending",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let (alice_drain, bob_drain) = tokio::join!(
        drain(cfg, &run_id, "alice-agent"),
        drain(cfg, &run_id, "bob-agent")
    );
    let alice_drain_resp = match alice_drain {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let bob_drain_resp = match bob_drain {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let both_drains_ok = alice_drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && bob_drain_resp
            .get("ok")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let raced_task = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-race"));
    let owner = raced_task
        .and_then(|t| t.get("owner"))
        .and_then(|v| v.as_str());
    let owner_is_one_member = matches!(owner, Some("m1" | "m2"));
    let task_in_progress = raced_task
        .and_then(|t| t.get("status"))
        .and_then(|v| v.as_str())
        == Some("in_progress");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let task_assigned_rows: Vec<&serde_json::Value> = messages
        .iter()
        .filter(|row| row.get("payload_kind").and_then(|v| v.as_str()) == Some("task_assigned"))
        .collect();
    let exactly_one_task_assigned = task_assigned_rows.len() == 1;
    let assigned_row_matches_owner = task_assigned_rows
        .first()
        .and_then(|row| row.get("recipient_member_id"))
        .and_then(|v| v.as_str())
        == owner;

    harness::print_result(
        label,
        &serde_json::json!({
            "alice_drain": alice_drain_resp,
            "bob_drain": bob_drain_resp,
            "tasks": tasks_resp,
            "inbox": inbox,
        })
        .to_string(),
        &[
            ("both drain endpoints returned ok", both_drains_ok),
            ("task owner is exactly one member", owner_is_one_member),
            ("task status flipped to in_progress", task_in_progress),
            (
                "exactly one task_assigned row was persisted",
                exactly_one_task_assigned,
            ),
            (
                "task_assigned recipient matches final owner",
                assigned_row_matches_owner,
            ),
        ],
    )
}

/// Dependency gate pin. A task whose `blocked_by` points at an
/// incomplete prerequisite must not be autonomously claimed. The same
/// production drain path must claim the dependent task once the
/// prerequisite is already completed.
pub async fn blocked_dependency_prevents_claim_until_completed(cfg: &Config) -> bool {
    let label = "Agent-Org: blocked dependency prevents autonomous claim until completed";
    let blocked_run_id = unique_run_id("team-tasks-blocked-dep");

    if let Err(err) = seed_task_with_dependencies(
        cfg,
        &blocked_run_id,
        "blocker-open",
        "Finish API contract",
        None,
        "pending",
        &["dependent"],
        &[],
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task_with_dependencies(
        cfg,
        &blocked_run_id,
        "dependent",
        "Implement UI after API",
        None,
        "pending",
        &[],
        &["blocker-open"],
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let blocked_drain_resp = match drain(cfg, &blocked_run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let blocked_drain_ok = blocked_drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let blocked_tasks_resp = match list_tasks(cfg, &blocked_run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let blocked_tasks = match tasks_array(&blocked_tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let blocked_dependent = blocked_tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("dependent"));
    let blocked_dependent_unowned = blocked_dependent
        .and_then(|t| t.get("owner"))
        .map(|v| v.is_null())
        .unwrap_or(false);
    let blocked_dependent_pending =
        blocked_dependent.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("pending");

    let ready_run_id = unique_run_id("team-tasks-unblocked-dep");
    if let Err(err) = seed_task_with_dependencies(
        cfg,
        &ready_run_id,
        "blocker-done",
        "Finish API contract",
        Some("m2"),
        "completed",
        &["dependent"],
        &[],
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task_with_dependencies(
        cfg,
        &ready_run_id,
        "dependent",
        "Implement UI after API",
        None,
        "pending",
        &[],
        &["blocker-done"],
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let ready_drain_resp = match drain(cfg, &ready_run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let ready_drain_ok = ready_drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let ready_tasks_resp = match list_tasks(cfg, &ready_run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let ready_tasks = match tasks_array(&ready_tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let ready_dependent = ready_tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("dependent"));
    let ready_dependent_owned_by_alice =
        ready_dependent.and_then(|t| t.get("owner").and_then(|v| v.as_str())) == Some("m1");
    let ready_dependent_in_progress = ready_dependent
        .and_then(|t| t.get("status").and_then(|v| v.as_str()))
        == Some("in_progress");

    harness::print_result(
        label,
        &serde_json::json!({
            "blocked": blocked_tasks_resp,
            "ready": ready_tasks_resp,
        })
        .to_string(),
        &[
            ("blocked-run drain endpoint returned ok", blocked_drain_ok),
            (
                "blocked dependent task remains unowned",
                blocked_dependent_unowned,
            ),
            (
                "blocked dependent task remains pending",
                blocked_dependent_pending,
            ),
            ("ready-run drain endpoint returned ok", ready_drain_ok),
            (
                "ready dependent task owner == alice-agent",
                ready_dependent_owned_by_alice,
            ),
            (
                "ready dependent task status flipped to in_progress",
                ready_dependent_in_progress,
            ),
        ],
    )
}

/// Task-tool validation pin. Dependency cycles must be rejected through
/// the LLM-callable task tool surface as a typed `invalid_params` error,
/// not merely by debug seed helpers or later claim-time behavior.
pub async fn dependency_cycle_rejected_by_task_tool(cfg: &Config) -> bool {
    let label = "Agent-Org: task tool rejects dependency cycle with typed error";
    let run_id = unique_run_id("team-tasks-cycle");

    let create_first = match task_tool_direct(
        cfg,
        &run_id,
        "create",
        serde_json::json!({
            "id": "cycle-first",
            "subject": "First cycle task",
            "blocks": ["cycle-second"]
        }),
    )
    .await
    {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let create_second = match task_tool_direct(
        cfg,
        &run_id,
        "create",
        serde_json::json!({
            "id": "cycle-second",
            "subject": "Second cycle task"
        }),
    )
    .await
    {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let update_cycle = match task_tool_direct(
        cfg,
        &run_id,
        "update",
        serde_json::json!({
            "id": "cycle-second",
            "blocks": ["cycle-first"]
        }),
    )
    .await
    {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(items) => items,
    };
    let second_task = tasks
        .iter()
        .find(|task| task.get("id").and_then(|value| value.as_str()) == Some("cycle-second"));
    let second_blocks_unchanged = second_task
        .and_then(|task| task.get("blocks"))
        .and_then(|value| value.as_array())
        .map(|blocks| blocks.is_empty())
        .unwrap_or(false);

    let output = serde_json::json!({
        "create_first": create_first,
        "create_second": create_second,
        "update_cycle": update_cycle,
        "tasks": tasks_resp,
    });
    harness::print_result(
        label,
        &output.to_string(),
        &[
            (
                "initial task_create calls succeeded",
                create_first.get("ok").and_then(|value| value.as_bool()) == Some(true)
                    && create_second.get("ok").and_then(|value| value.as_bool()) == Some(true),
            ),
            (
                "cycle update returned typed invalid_params",
                update_cycle.get("ok").and_then(|value| value.as_bool()) == Some(false)
                    && update_cycle
                        .get("error_kind")
                        .and_then(|value| value.as_str())
                        == Some(TOOL_ERROR_INVALID_PARAMS),
            ),
            (
                "cycle update exposes task_dependency_cycle code",
                update_cycle
                    .get("error_message")
                    .and_then(|value| value.as_str())
                    .map(|message| message.contains(TASK_DEPENDENCY_CYCLE_ERROR))
                    .unwrap_or(false),
            ),
            (
                "failed update did not persist cycle edge",
                second_blocks_unchanged,
            ),
        ],
    )
}

/// Resolved-skip pin. A run whose only task is `completed` has no
/// available work — drain must NOT mutate or post anything. This
/// pins `find_available`'s `is_resolved()` filter end-to-end.
pub async fn no_pending_tasks_means_no_claim(cfg: &Config) -> bool {
    let label = "Agent-Org: no pending tasks → drain does not claim";
    let run_id = unique_run_id("team-tasks-no-work");

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-done",
        "Already done",
        Some("m2"),
        "completed",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let drain_resp = match drain(cfg, &run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let done = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-done"));
    let owner_unchanged = done.and_then(|t| t.get("owner").and_then(|v| v.as_str())) == Some("m2");
    let status_unchanged =
        done.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("completed");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_assigned_row = messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("task_assigned"));

    harness::print_result(
        label,
        &tasks_resp.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            ("completed task owner unchanged", owner_unchanged),
            ("completed task status unchanged", status_unchanged),
            ("no task_assigned row created", no_assigned_row),
        ],
    )
}

// ────────────────────────────────────────────────────────────────────────
// Unassign-on-shutdown
// ────────────────────────────────────────────────────────────────────────

/// Happy path. When a worker accepts a shutdown handshake, the
/// coordinator's drain releases that worker's open tasks back to the
/// pool (owner cleared, status reset to `pending`) so the next idle
/// peer can claim them.
pub async fn accepted_shutdown_releases_owned_open_tasks(cfg: &Config) -> bool {
    let label = "Agent-Org: accepted shutdown releases dying worker's open tasks";
    let run_id = unique_run_id("team-tasks-release");

    if let Err(err) = seed_task(cfg, &run_id, "task-alive", "WIP", Some("m1"), "in_progress").await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-shipped",
        "Done",
        Some("m1"),
        "completed",
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-bob",
        "Bob's work",
        Some("m2"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let body = {
        let mut b = default_org_context(&run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("alice-agent".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("m1".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "coord",
                "recipient_member_id": "coordinator",
                "kind": "shutdown_response",
                "request_id": "req-shut-team-tasks",
                "accepted": true,
                "note": "wrapping up",
            }),
        );
        b
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    if !send_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return harness::print_error(label, &send_resp.to_string());
    }

    let drain_resp = match drain(cfg, &run_id, "coord").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };

    let alive = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-alive"));
    let alive_owner_cleared = alive
        .and_then(|t| t.get("owner"))
        .map(|v| v.is_null())
        .unwrap_or(false);
    let alive_status_pending =
        alive.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("pending");

    let shipped = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-shipped"));
    let shipped_owner_kept =
        shipped.and_then(|t| t.get("owner").and_then(|v| v.as_str())) == Some("m1");
    let shipped_status_kept =
        shipped.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("completed");

    let bobs = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-bob"));
    let bobs_owner_kept = bobs.and_then(|t| t.get("owner").and_then(|v| v.as_str())) == Some("m2");
    let bobs_status_kept =
        bobs.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("in_progress");

    harness::print_result(
        label,
        &tasks_resp.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            ("alice's open task owner cleared", alive_owner_cleared),
            (
                "alice's open task status reset to pending",
                alive_status_pending,
            ),
            ("alice's completed task owner kept", shipped_owner_kept),
            ("alice's completed task status kept", shipped_status_kept),
            ("bob's task owner untouched", bobs_owner_kept),
            ("bob's task status untouched", bobs_status_kept),
        ],
    )
}

/// Negative pin. A REJECTED shutdown_response (the worker pushes
/// back) must NOT release that worker's tasks — the worker is still
/// alive. Without this pin a refactor that conditions task release
/// on the kind alone would lose the in-flight work whenever a worker
/// stalls a shutdown.
pub async fn released_task_can_be_claimed_by_idle_peer(cfg: &Config) -> bool {
    let label = "Agent-Org: released shutdown task can be claimed by idle peer";
    let run_id = unique_run_id("team-tasks-release-reclaim");

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-released",
        "Released handoff",
        Some("m1"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let body = {
        let mut payload = default_org_context(&run_id);
        payload.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("alice-agent".into()),
        );
        payload.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("m1".into()),
        );
        payload.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "coord",
                "recipient_member_id": "coordinator",
                "kind": "shutdown_response",
                "request_id": "req-shut-reclaim",
                "accepted": true,
                "note": "handoff",
            }),
        );
        payload
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    if !send_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return harness::print_error(label, &send_resp.to_string());
    }

    let release_drain_resp = match drain(cfg, &run_id, "coord").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    if release_drain_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        != Some(true)
    {
        return harness::print_error(label, &release_drain_resp.to_string());
    }

    let bob_drain_resp = match drain(cfg, &run_id, "bob-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let bob_drain_ok = bob_drain_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let bob_attachment = bob_drain_resp
        .get("messages")
        .and_then(|value| value.as_array())
        .and_then(|messages| messages.first())
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let bob_saw_reclaimed_task = bob_attachment.contains("<task_assigned")
        && bob_attachment.contains("task_id=\"task-released\"")
        && bob_attachment.contains("subject=\"Released handoff\"")
        && bob_attachment.contains("assigned_by=\"system\"");

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(items) => items,
    };
    let task = tasks
        .iter()
        .find(|item| item.get("id").and_then(|value| value.as_str()) == Some("task-released"));
    let task_owner_bob =
        task.and_then(|item| item.get("owner").and_then(|value| value.as_str())) == Some("m2");
    let task_status_in_progress = task
        .and_then(|item| item.get("status").and_then(|value| value.as_str()))
        == Some("in_progress");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(items) => items,
    };
    let bob_task_assigned_row = messages.iter().any(|row| {
        row.get("payload_kind").and_then(|value| value.as_str()) == Some("task_assigned")
            && row
                .get("recipient_member_id")
                .and_then(|value| value.as_str())
                == Some("m2")
            && row
                .get("payload_decoded")
                .and_then(|payload| payload.get("task_id"))
                .and_then(|value| value.as_str())
                == Some("task-released")
    });
    let output = serde_json::json!({
        "release_drain": release_drain_resp,
        "bob_drain": bob_drain_resp,
        "tasks": tasks_resp,
        "inbox": inbox,
    });

    harness::print_result(
        label,
        &output.to_string(),
        &[
            ("Bob drain endpoint returned ok", bob_drain_ok),
            (
                "Bob received reclaimed task attachment",
                bob_saw_reclaimed_task,
            ),
            ("task owner changed to bob-agent", task_owner_bob),
            ("task status is in_progress", task_status_in_progress),
            ("task_assigned row targets bob-agent", bob_task_assigned_row),
        ],
    )
}

pub async fn stale_worker_timeout_releases_open_tasks(cfg: &Config) -> bool {
    let label = "Agent-Org: stale worker timeout releases open tasks";
    let stale_updated_at = (chrono::Utc::now() - chrono::Duration::minutes(20)).to_rfc3339();
    let fresh_updated_at = chrono::Utc::now().to_rfc3339();

    let seed_run_resp = match post_json(
        cfg,
        STALE_WORKERS_SEED_RUN_PATH,
        serde_json::json!({
            "root_session_id": format!("{}-root", unique_run_id("stale-worker")),
            "coordinator_agent_id": "coord",
            "workers": [
                {
                    "agent_definition_id": "alice-agent",
                    "member_id": "m1",
                    "updated_at": stale_updated_at,
                    "status": "running"
                },
                {
                    "agent_definition_id": "bob-agent",
                    "member_id": "m2",
                    "updated_at": fresh_updated_at,
                    "status": "running"
                }
            ]
        }),
    )
    .await
    {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    if seed_run_resp.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return harness::print_error(label, &seed_run_resp.to_string());
    }
    let Some(run_id) = seed_run_resp
        .get("org_run_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return harness::print_error(label, &seed_run_resp.to_string());
    };

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-stale-open",
        "Stale worker handoff",
        Some("m1"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-stale-complete",
        "Completed audit trail",
        Some("m1"),
        "completed",
    )
    .await
    {
        return harness::print_error(label, &err);
    }
    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-fresh-open",
        "Fresh worker keeps work",
        Some("m2"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let release_resp = match post_json(
        cfg,
        STALE_WORKERS_RELEASE_TASKS_PATH,
        serde_json::json!({
            "org_run_id": run_id,
            "stale_before": (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339(),
        }),
    )
    .await
    {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(items) => items,
    };

    let stale_open = tasks
        .iter()
        .find(|item| item.get("id").and_then(|value| value.as_str()) == Some("task-stale-open"));
    let stale_completed = tasks.iter().find(|item| {
        item.get("id").and_then(|value| value.as_str()) == Some("task-stale-complete")
    });
    let fresh_open = tasks
        .iter()
        .find(|item| item.get("id").and_then(|value| value.as_str()) == Some("task-fresh-open"));

    let stale_open_released = stale_open
        .and_then(|item| item.get("owner"))
        .map_or(true, serde_json::Value::is_null)
        && stale_open.and_then(|item| item.get("status").and_then(|value| value.as_str()))
            == Some("pending");
    let completed_preserved = stale_completed
        .and_then(|item| item.get("owner").and_then(|value| value.as_str()))
        == Some("m1")
        && stale_completed.and_then(|item| item.get("status").and_then(|value| value.as_str()))
            == Some("completed");
    let fresh_worker_preserved = fresh_open
        .and_then(|item| item.get("owner").and_then(|value| value.as_str()))
        == Some("m2")
        && fresh_open.and_then(|item| item.get("status").and_then(|value| value.as_str()))
            == Some("in_progress");
    let release_count_ok = release_resp
        .get("released_worker_count")
        .and_then(|value| value.as_u64())
        == Some(1)
        && release_resp
            .get("released_task_count")
            .and_then(|value| value.as_u64())
            == Some(1);

    let output = serde_json::json!({
        "seed_run": seed_run_resp,
        "release": release_resp,
        "tasks": tasks_resp,
    });
    harness::print_result(
        label,
        &output.to_string(),
        &[
            (
                "release endpoint returned ok",
                release_resp.get("ok").and_then(|value| value.as_bool()) == Some(true),
            ),
            ("only stale worker open task was released", release_count_ok),
            (
                "stale worker open task became unowned pending",
                stale_open_released,
            ),
            (
                "stale worker completed task stayed completed and owned",
                completed_preserved,
            ),
            (
                "fresh worker open task stayed assigned",
                fresh_worker_preserved,
            ),
        ],
    )
}

pub async fn rejected_shutdown_keeps_owned_tasks_assigned(cfg: &Config) -> bool {
    let label = "Agent-Org: rejected shutdown keeps worker's tasks assigned";
    let run_id = unique_run_id("team-tasks-rejected");

    if let Err(err) = seed_task(
        cfg,
        &run_id,
        "task-keep",
        "Still mine",
        Some("m1"),
        "in_progress",
    )
    .await
    {
        return harness::print_error(label, &err);
    }

    let body = {
        let mut b = default_org_context(&run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("alice-agent".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("m1".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "coord",
                "recipient_member_id": "coordinator",
                "kind": "shutdown_response",
                "request_id": "req-shut-team-tasks-neg",
                "accepted": false,
                "note": "still mid-edit",
            }),
        );
        b
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    if !send_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return harness::print_error(label, &send_resp.to_string());
    }

    let _ = match drain(cfg, &run_id, "coord").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };

    let tasks_resp = match list_tasks(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let tasks = match tasks_array(&tasks_resp) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let keep = tasks
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some("task-keep"));
    let owner_kept = keep.and_then(|t| t.get("owner").and_then(|v| v.as_str())) == Some("m1");
    let status_kept =
        keep.and_then(|t| t.get("status").and_then(|v| v.as_str())) == Some("in_progress");

    harness::print_result(
        label,
        &tasks_resp.to_string(),
        &[
            ("alice still owns task-keep", owner_kept),
            ("task-keep status still in_progress", status_kept),
        ],
    )
}

// ────────────────────────────────────────────────────────────────────────
// ExecModeSetRequest
// ────────────────────────────────────────────────────────────────────────

/// Caller-path pin. The coordinator can issue an
/// `exec_mode_set_request` via the production `org_send_message`
/// tool, the row lands in the recipient member's inbox with the mode
/// preserved, and a subsequent drain marks the row read (the side
/// effect that stages the override on the recipient session is
/// covered by unit tests in `inbox_drain.rs`).
pub async fn coordinator_exec_mode_set_request_lands_in_member_inbox(cfg: &Config) -> bool {
    let label = "Agent-Org: coordinator exec_mode_set_request lands in member inbox";
    let run_id = unique_run_id("team-tasks-set-mode");

    let body = {
        let mut b = default_org_context(&run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "exec_mode_set_request",
                "request_id": "req-mode-1",
                "summary": "switch to plan",
                "mode": "plan",
                "text": "please draft a plan first",
            }),
        );
        b
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let send_ok = send_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !send_ok {
        return harness::print_error(label, &send_resp.to_string());
    }

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };

    let exec_row = messages
        .iter()
        .find(|r| r.get("payload_kind").and_then(|v| v.as_str()) == Some("exec_mode_set_request"));
    let row_present = exec_row.is_some();
    let recipient_alice =
        exec_row.and_then(|r| r.get("recipient_member_id").and_then(|v| v.as_str())) == Some("m1");
    let sender_coord =
        exec_row.and_then(|r| r.get("sender_agent_id").and_then(|v| v.as_str())) == Some("coord");
    let mode_plan = exec_row
        .and_then(|r| r.get("payload_decoded"))
        .and_then(|p| p.get("mode"))
        .and_then(|v| v.as_str())
        == Some("plan");
    let still_unread = exec_row
        .and_then(|r| r.get("read_at"))
        .map(|v| v.is_null())
        .unwrap_or(false);

    harness::print_result(
        label,
        &inbox.to_string(),
        &[
            ("send returned ok=true", send_ok),
            ("exec_mode_set_request row present", row_present),
            ("recipient_agent_id == alice-agent", recipient_alice),
            ("sender_agent_id == coord", sender_coord),
            ("decoded mode == plan", mode_plan),
            ("row still unread (next-turn delivery)", still_unread),
        ],
    )
}

/// Permission pin. A non-coordinator member who tries to send
/// `exec_mode_set_request` gets rejected with `invalid_params` —
/// only the coordinator may remotely change another agent's exec
/// mode. Without this pin a refactor of the sender check would let
/// any peer flip another peer's mode.
pub async fn member_cannot_send_exec_mode_set_request(cfg: &Config) -> bool {
    let label = "Agent-Org: member cannot send exec_mode_set_request";
    let run_id = unique_run_id("team-tasks-member-rejected");

    let body = {
        let mut b = default_org_context(&run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("alice-agent".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("m1".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "bob-agent",
                "recipient_member_id": "m2",
                "kind": "exec_mode_set_request",
                "request_id": "req-mode-mem",
                "summary": "force build",
                "mode": "build",
                "text": "switch now",
            }),
        );
        b
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let send_ok = send_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rejected_with_invalid_params = !send_ok
        && send_resp
            .get("error_kind")
            .and_then(|v| v.as_str())
            .map(|s| s == "invalid_params")
            .unwrap_or(false);
    let error_mentions_kind_not_allowed = send_resp
        .get("error_message")
        .and_then(|v| v.as_str())
        .map(|s| s.contains("not allowed"))
        .unwrap_or(false);

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_exec_rows = messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("exec_mode_set_request"));

    harness::print_result(
        label,
        &send_resp.to_string(),
        &[
            ("send returned ok=false", !send_ok),
            ("rejected with invalid_params", rejected_with_invalid_params),
            (
                "error says kind is not allowed for member sender",
                error_mentions_kind_not_allowed,
            ),
            ("no exec_mode_set_request row in inbox", no_exec_rows),
        ],
    )
}

/// Validation pin. Coordinator must supply a supported remote `mode`
/// string (`build`/`ask`/`plan`). Unknown values and globally
/// known-but-currently-unsupported values such as `debug` are rejected
/// with `invalid_params`. Without this pin the LLM could stage a typo
/// or an unavailable workflow that silently derails the member.
pub async fn coordinator_exec_mode_set_request_rejects_unknown_mode(cfg: &Config) -> bool {
    let label = "Agent-Org: coordinator exec_mode_set_request rejects unknown mode";
    let run_id = unique_run_id("team-tasks-bad-mode");

    let body = {
        let mut b = default_org_context(&run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "exec_mode_set_request",
                "request_id": "req-mode-bad",
                "summary": "bogus",
                "mode": "wingman-of-the-future",
                "text": "switch",
            }),
        );
        b
    };
    let send_resp = match post_send(cfg, body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let send_ok = send_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rejected_with_invalid_params = !send_ok
        && send_resp
            .get("error_kind")
            .and_then(|v| v.as_str())
            .map(|s| s == "invalid_params")
            .unwrap_or(false);

    let unsupported_run_id = unique_run_id("team-tasks-unsupported-mode");
    let unsupported_body = {
        let mut b = default_org_context(&unsupported_run_id);
        b.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        b.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        b.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "exec_mode_set_request",
                "request_id": "req-mode-debug",
                "summary": "unsupported debug",
                "mode": "debug",
                "text": "switch",
            }),
        );
        b
    };
    let unsupported_resp = match post_send(cfg, unsupported_body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let unsupported_rejected = !unsupported_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        && unsupported_resp
            .get("error_kind")
            .and_then(|v| v.as_str())
            .map(|s| s == "invalid_params")
            .unwrap_or(false)
        && unsupported_resp
            .get("error_message")
            .and_then(|v| v.as_str())
            .map(|s| s.contains("unsupported mode"))
            .unwrap_or(false);

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_exec_rows = messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("exec_mode_set_request"));

    let unsupported_inbox = match list_inbox(cfg, &unsupported_run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let unsupported_messages = match messages_array(&unsupported_inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_unsupported_exec_rows = unsupported_messages
        .iter()
        .all(|r| r.get("payload_kind").and_then(|v| v.as_str()) != Some("exec_mode_set_request"));

    let details = serde_json::json!({
        "unknown_mode_response": send_resp,
        "unsupported_mode_response": unsupported_resp,
        "unknown_mode_inbox": inbox,
        "unsupported_mode_inbox": unsupported_inbox,
    });

    harness::print_result(
        label,
        &details.to_string(),
        &[
            ("unknown mode send returned ok=false", !send_ok),
            (
                "unknown mode rejected with invalid_params",
                rejected_with_invalid_params,
            ),
            (
                "unsupported debug rejected with invalid_params",
                unsupported_rejected,
            ),
            (
                "unknown mode stored no exec_mode_set_request row",
                no_exec_rows,
            ),
            (
                "unsupported debug stored no exec_mode_set_request row",
                no_unsupported_exec_rows,
            ),
        ],
    )
}

/// Caller-path pin for coordinator plan approval mode defaults. The
/// production `org_send_message` tool must persist `next_mode=build`
/// for accepted approvals and `next_mode=plan` for rejected approvals
/// when the coordinator omits `next_mode`. Known-but-unsupported modes
/// such as `debug` must be rejected before persistence.
pub async fn coordinator_plan_approval_response_defaults_and_rejects_unsupported_next_mode(
    cfg: &Config,
) -> bool {
    let label = "Agent-Org: coordinator plan_approval_response next_mode contract";
    let run_id = unique_run_id("team-tasks-plan-approval-next-mode");

    let accepted_body = {
        let mut body = default_org_context(&run_id);
        body.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        body.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        body.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "plan_approval_response",
                "request_id": "plan-accepted-default",
                "accepted": true,
                "feedback": "approved, start build",
            }),
        );
        body
    };
    let accepted_resp = match post_send(cfg, accepted_body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let accepted_ok = accepted_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let rejected_body = {
        let mut body = default_org_context(&run_id);
        body.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        body.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        body.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "plan_approval_response",
                "request_id": "plan-rejected-default",
                "accepted": false,
                "feedback": "revise the plan before build",
            }),
        );
        body
    };
    let rejected_resp = match post_send(cfg, rejected_body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let rejected_ok = rejected_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let unsupported_run_id = unique_run_id("team-tasks-plan-approval-debug");
    let unsupported_body = {
        let mut body = default_org_context(&unsupported_run_id);
        body.as_object_mut().unwrap().insert(
            "sender_agent_id".into(),
            serde_json::Value::String("coord".into()),
        );
        body.as_object_mut().unwrap().insert(
            "sender_member_id".into(),
            serde_json::Value::String("coordinator".into()),
        );
        body.as_object_mut().unwrap().insert(
            "params".into(),
            serde_json::json!({
                "recipient_agent_id": "alice-agent",
                "recipient_member_id": "m1",
                "kind": "plan_approval_response",
                "request_id": "plan-unsupported-debug",
                "accepted": true,
                "feedback": "try debug",
                "next_mode": "debug",
            }),
        );
        body
    };
    let unsupported_resp = match post_send(cfg, unsupported_body).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let unsupported_rejected = !unsupported_resp
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        && unsupported_resp
            .get("error_kind")
            .and_then(|value| value.as_str())
            .map(|kind| kind == TOOL_ERROR_INVALID_PARAMS)
            .unwrap_or(false)
        && unsupported_resp
            .get("error_message")
            .and_then(|value| value.as_str())
            .map(|message| message.contains("unsupported mode"))
            .unwrap_or(false);

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let accepted_row = messages.iter().find(|row| {
        row.get("request_id").and_then(|value| value.as_str()) == Some("plan-accepted-default")
    });
    let rejected_row = messages.iter().find(|row| {
        row.get("request_id").and_then(|value| value.as_str()) == Some("plan-rejected-default")
    });
    let accepted_default_build = accepted_row
        .and_then(|row| row.get("payload_decoded"))
        .and_then(|payload| payload.get("next_mode"))
        .and_then(|value| value.as_str())
        == Some("build");
    let rejected_default_plan = rejected_row
        .and_then(|row| row.get("payload_decoded"))
        .and_then(|payload| payload.get("next_mode"))
        .and_then(|value| value.as_str())
        == Some("plan");

    let unsupported_inbox = match list_inbox(cfg, &unsupported_run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let unsupported_messages = match messages_array(&unsupported_inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let no_unsupported_plan_rows = unsupported_messages.iter().all(|row| {
        row.get("payload_kind").and_then(|value| value.as_str()) != Some("plan_approval_response")
    });

    let details = serde_json::json!({
        "accepted_response": accepted_resp,
        "rejected_response": rejected_resp,
        "unsupported_response": unsupported_resp,
        "inbox": inbox,
        "unsupported_inbox": unsupported_inbox,
    });

    harness::print_result(
        label,
        &details.to_string(),
        &[
            ("accepted response persisted", accepted_ok),
            ("rejected response persisted", rejected_ok),
            (
                "accepted response defaults next_mode to build",
                accepted_default_build,
            ),
            (
                "rejected response defaults next_mode to plan",
                rejected_default_plan,
            ),
            ("unsupported debug next_mode rejected", unsupported_rejected),
            (
                "unsupported debug next_mode stored no plan_approval_response row",
                no_unsupported_plan_rows,
            ),
        ],
    )
}

// ────────────────────────────────────────────────────────────────────────
// Autonomous-claim drain side effect via inbox seed
// (caller-path pair for the unit test that exercises drain after a
// real `task_assigned` row is staged via `enqueue_task_assigned`).
// ────────────────────────────────────────────────────────────────────────

/// Inbox-routed pin. Seed a `task_assigned` envelope for alice
/// (mimicking what `enqueue_task_assigned` would do after a
/// `task_create` with a non-self owner) and confirm the drain
/// renders it and marks it read on commit. Pins the message-routing
/// half of the autonomous-claim contract independently from the
/// store side effect.
pub async fn task_assigned_inbox_message_drains_for_recipient(cfg: &Config) -> bool {
    let label = "Agent-Org: task_assigned inbox row drains and marks read";
    let run_id = unique_run_id("team-tasks-msg-drain");

    let message = serde_json::json!({
        "kind": "task_assigned",
        "task_id": "task-routed",
        "subject": "Routed work",
        "description": "Routed via inbox seed",
        "assigned_by": "Coordinator",
    });
    if let Err(err) = seed_inbox(cfg, &run_id, "_system", "alice-agent", message).await {
        return harness::print_error(label, &err);
    }

    let drain_resp = match drain(cfg, &run_id, "alice-agent").await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let drain_ok = drain_resp
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let rendered_at_least_one = drain_resp
        .get("rendered")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        >= 1;
    let rendered_attachment = drain_resp
        .get("messages")
        .and_then(|value| value.as_array())
        .and_then(|messages| messages.first())
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let rendered_payload_ok = rendered_attachment.contains("<task_assigned")
        && rendered_attachment.contains("task_id=\"task-routed\"")
        && rendered_attachment.contains("subject=\"Routed work\"")
        && rendered_attachment.contains("Routed via inbox seed");

    let inbox = match list_inbox(cfg, &run_id).await {
        Err(err) => return harness::print_error(label, &err),
        Ok(json) => json,
    };
    let messages = match messages_array(&inbox) {
        Err(err) => return harness::print_error(label, &err),
        Ok(arr) => arr,
    };
    let row = messages
        .iter()
        .find(|r| r.get("payload_kind").and_then(|v| v.as_str()) == Some("task_assigned"));
    let row_present = row.is_some();
    let row_marked_read = row
        .and_then(|r| r.get("read_at"))
        .map(|v| !v.is_null())
        .unwrap_or(false);

    let output = serde_json::json!({
        "drain": drain_resp,
        "inbox": inbox,
    });

    harness::print_result(
        label,
        &output.to_string(),
        &[
            ("drain endpoint returned ok", drain_ok),
            ("drain rendered at least one message", rendered_at_least_one),
            ("drain rendered task_assigned payload", rendered_payload_ok),
            ("task_assigned row present after drain", row_present),
            (
                "task_assigned row marked read by drain commit",
                row_marked_read,
            ),
        ],
    )
}
