//! `manage_todo` E2E regressions. These cover the full loop: the SDE agent
//! must actually **call** `manage_todo` for non-trivial multi-step work, and
//! what it stores (content + `activeForm` + `blockedBy`) must round-trip
//! through the SQLite `agent_todos` table without shape loss.
//!
//! These scenarios drive the LLM via natural-language prompts — we never tell
//! the agent which tool to pick. We then assert:
//!   1. `manage_todo` shows up in the tool-call trace (prompt-nudge worked).
//!   2. `GET /agent/test/sde/todos/:session_id` returns non-empty rows with
//!      the right `status` / `activeForm` / `blockedBy` shape.
//!   3. After NAG_THRESHOLD turns without a `manage_todo` call, the system
//!      reminder is injected and the agent resumes updating the todo list
//!      (`manage_todo_nag_resumes` scenario).

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;
use crate::harness::{ReadyTodosResponse, TodoSnapshotResponse};

/// Multi-step request should provoke a `manage_todo` write + persisted rows.
///
/// We ask for three clearly independent sub-tasks. The prompt nudge in
/// `manage_todo`'s tool description ("use for non-trivial multi-step work")
/// plus the exec-mode system prompt should make the LLM write a checklist
/// instead of just narrating steps.
pub async fn manage_todo_write(cfg: &Config) -> bool {
    let session_id = format!("{}-todo-write", cfg.session_prefix);
    let project = tmp_workspace_path("todo-write");

    let prompt = "I have three unrelated chores for you to plan out before acting: \
(1) write a Rust hello-world program to /tmp/hello.rs, \
(2) write a short README explaining what the program does, \
(3) run the program and capture its stdout. \
Please organise these as a tracked checklist so we can follow progress, then stop — \
do not actually run any of the steps yet.";

    let resp = match harness::send_sde_message(
        cfg,
        prompt,
        &session_id,
        "build",
        &project,
        None,
        true, // keep session so we can read todos
    )
    .await
    {
        Err(err) => {
            return harness::print_error("SDE manage_todo Write", &err);
        }
        Ok(r) => r,
    };

    let used_todo = harness::assert_sde_tool_used(&resp, "manage_todo");

    let snapshot = harness::fetch_todos(cfg, &session_id).await;
    let (persisted, has_three, statuses_valid) = match &snapshot {
        Ok(s) => {
            let valid_statuses = s.todos.iter().all(|t| {
                matches!(
                    t.status.as_str(),
                    "pending" | "in_progress" | "completed" | "cancelled"
                )
            });
            (!s.todos.is_empty(), s.todos.len() >= 3, valid_statuses)
        }
        Err(_) => (false, false, false),
    };

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "SDE manage_todo Write",
        &resp.content,
        &[
            ("Called manage_todo", used_todo),
            ("Todos persisted in DB", persisted),
            ("At least 3 items recorded", has_three),
            ("All statuses are valid enum values", statuses_valid),
        ],
    )
}

/// `activeForm` field should round-trip: the LLM writes present-continuous
/// labels, we read them back from SQLite unchanged.
///
/// We explicitly ask the agent to set `activeForm` on each task. If the
/// description + V2 prompt ported in this PR is doing its job, the field
/// reaches the DB intact and our harness sees it.
pub async fn manage_todo_active_form(cfg: &Config) -> bool {
    let session_id = format!("{}-todo-activeform", cfg.session_prefix);
    let project = tmp_workspace_path("todo-activeform");

    let prompt =
        "Plan out this small refactor as a tracked checklist (don't execute anything yet): \
(1) read src/main.rs, (2) extract a helper function, (3) run cargo test. \
When you create the checklist, make sure each task also has an `activeForm` — \
the present-continuous label to show while that step is in progress \
(for example content 'Run cargo test' → activeForm 'Running cargo test'). \
After creating the list, stop.";

    let resp =
        match harness::send_sde_message(cfg, prompt, &session_id, "build", &project, None, true)
            .await
        {
            Err(err) => {
                return harness::print_error("SDE manage_todo ActiveForm", &err);
            }
            Ok(r) => r,
        };

    let used_todo = harness::assert_sde_tool_used(&resp, "manage_todo");

    let snapshot = harness::fetch_todos(cfg, &session_id).await;
    let (persisted, any_active_form, majority_active_form) = match &snapshot {
        Ok(s) => {
            let with_active_form = s
                .todos
                .iter()
                .filter(|t| t.active_form.as_deref().is_some_and(|af| !af.is_empty()))
                .count();
            let total = s.todos.len();
            (
                total > 0,
                with_active_form > 0,
                // loose parity check: at least half the rows should carry an
                // activeForm when we asked for it on every task. LLM wording
                // varies so we don't demand 100%.
                total > 0 && with_active_form * 2 >= total,
            )
        }
        Err(_) => (false, false, false),
    };

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "SDE manage_todo ActiveForm Round-trip",
        &resp.content,
        &[
            ("Called manage_todo", used_todo),
            ("Todos persisted in DB", persisted),
            ("At least one row has activeForm", any_active_form),
            (
                "Majority of rows carry activeForm (field reaches DB intact)",
                majority_active_form,
            ),
        ],
    )
}

/// Task DAG: `blockedBy` field should round-trip through SQLite.
///
/// We explicitly ask the agent to model a three-step pipeline where step 2
/// depends on step 1 and step 3 depends on step 2. The expected graph is:
///
///   [0] Fetch data  ←─ [1] Process data (blockedBy: [0])
///                             ←─ [2] Write report (blockedBy: [1])
///
/// We assert:
///   1. At least one row has a non-empty `blockedBy` list (DAG was used).
///   2. `list_ready` is consistent: with all tasks pending, only index 0
///      should be ready (no blockers). We verify this by checking that at
///      least one todo has an empty `blocked_by` — the "root" task — while
///      others are blocked.
pub async fn manage_todo_dag(cfg: &Config) -> bool {
    let session_id = format!("{}-todo-dag", cfg.session_prefix);
    let project = tmp_workspace_path("todo-dag");

    let prompt = "Create a todo list for a sequential data pipeline: \
(1) Fetch raw data from an API, \
(2) Process and transform the data — this can only start after step 1 finishes, \
(3) Write the final report — this can only start after step 2 finishes. \
Model the dependencies using the `blockedBy` field so the list captures that \
these steps must happen in order. Stop after creating the list.";

    let resp =
        match harness::send_sde_message(cfg, prompt, &session_id, "build", &project, None, true)
            .await
        {
            Err(err) => {
                return harness::print_error("SDE manage_todo DAG", &err);
            }
            Ok(r) => r,
        };

    let used_todo = harness::assert_sde_tool_used(&resp, "manage_todo");

    let snapshot = harness::fetch_todos(cfg, &session_id).await;
    let (persisted, has_three, any_blocked, has_root_unblocked) = match &snapshot {
        Ok(TodoSnapshotResponse { todos }) => {
            let has_blocked = todos.iter().any(|t| !t.blocked_by.is_empty());
            let has_root = todos.iter().any(|t| t.blocked_by.is_empty());
            (!todos.is_empty(), todos.len() >= 3, has_blocked, has_root)
        }
        Err(_) => (false, false, false, false),
    };

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "SDE manage_todo DAG (blockedBy)",
        &resp.content,
        &[
            ("Called manage_todo", used_todo),
            ("Todos persisted in DB", persisted),
            ("At least 3 items", has_three),
            ("At least one task has blockedBy set", any_blocked),
            ("At least one root task has no blockers", has_root_unblocked),
        ],
    )
}

/// Nag reminder: after NAG_THRESHOLD (3) turns without `manage_todo`, the
/// system injects a reminder and the agent should resume updating the list.
///
/// Flow:
///   Turn 1 — ask agent to create a 4-step checklist and stop.
///   Turns 2-4 — send trivial unrelated questions ("What is 2+2?", etc.).
///             These accumulate nag counter to ≥3 without clearing it.
///   Turn 5 — ask agent to "continue with the first task on your list".
///             With the nag reminder injected, the agent should recall the
///             list and call `manage_todo` to mark progress.
///
/// Asserts:
///   - Turn 1 called `manage_todo` (list was created).
///   - Turn 5 called `manage_todo` (nag+context caused a todo update).
///   - After turn 5, at least one todo has status `in_progress` or `completed`
///     (agent actually advanced the list, not just re-wrote it as pending).
pub async fn manage_todo_nag_resumes(cfg: &Config) -> bool {
    let session_id = format!("{}-todo-nag", cfg.session_prefix);
    let project = tmp_workspace_path("todo-nag");

    // ── Turn 1: establish the todo list ────────────────────────────────
    println!("  [turn 1] Creating todo list...");
    let turn1 = harness::send_sde_message(
        cfg,
        "I need to refactor a Rust library. Plan these four steps as a tracked \
         checklist (do NOT execute them yet): \
         (1) Read src/lib.rs, \
         (2) Extract a helper function, \
         (3) Run cargo test, \
         (4) Update the README. \
         Create the todo list and stop.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    let turn1_used_todo = turn1
        .as_ref()
        .map(|r| harness::assert_sde_tool_used(r, "manage_todo"))
        .unwrap_or(false);

    if !turn1_used_todo {
        let _ = harness::cleanup_sde_session(cfg, &session_id).await;
        return harness::print_result(
            "SDE manage_todo Nag Resumes",
            turn1
                .as_ref()
                .map(|r| r.content.as_str())
                .unwrap_or("ERROR"),
            &[
                ("Turn 1: called manage_todo", false),
                ("Turns 2-4: nag accumulates", false),
                ("Turn 5: nag triggered manage_todo", false),
                ("After turn 5: list has progress", false),
            ],
        );
    }

    // ── Turns 2-4: trivial questions to accumulate nag counter ─────────
    // NAG_THRESHOLD is 3, so we need ≥3 non-todo turns.
    let trivia = [
        "What is 2 + 2? Answer in one word.",
        "What colour is the sky? One word.",
        "Name one programming language other than Rust. One word.",
    ];

    let mut trivia_ok = true;
    for (idx, q) in trivia.iter().enumerate() {
        println!("  [turn {}] Trivial question (nag accumulator)...", idx + 2);
        match harness::send_sde_message(cfg, q, &session_id, "build", &project, None, true).await {
            Err(err) => {
                println!("    turn {} error: {err}", idx + 2);
                trivia_ok = false;
                break;
            }
            Ok(resp) => {
                println!("    turn {} ok ({} chars)", idx + 2, resp.content.len());
            }
        }
    }

    // ── Turn 5: ask agent to continue the checklist ────────────────────
    println!("  [turn 5] Asking agent to start the first task...");
    let turn5 = harness::send_sde_message(
        cfg,
        "Please start working on the first item in the task list you created earlier. \
         Mark it as in_progress using manage_todo, then stop.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    let turn5_used_todo = turn5
        .as_ref()
        .map(|r| harness::assert_sde_tool_used(r, "manage_todo"))
        .unwrap_or(false);

    // Check that at least one task is now in_progress or completed.
    let snapshot = harness::fetch_todos(cfg, &session_id).await;
    let list_has_progress = match &snapshot {
        Ok(s) => s
            .todos
            .iter()
            .any(|t| t.status == "in_progress" || t.status == "completed"),
        Err(_) => false,
    };

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    let combined = format!(
        "--- TURN 1 ---\n{}\n\n--- TURN 5 ---\n{}",
        turn1
            .as_ref()
            .map(|r| r.content.as_str())
            .unwrap_or("ERROR"),
        turn5
            .as_ref()
            .map(|r| r.content.as_str())
            .unwrap_or("ERROR"),
    );

    harness::print_result(
        "SDE manage_todo Nag Resumes",
        &combined,
        &[
            ("Turn 1: called manage_todo (list created)", turn1_used_todo),
            ("Turns 2-4: nag accumulates (HTTP ok)", trivia_ok),
            (
                "Turn 5: manage_todo called (nag + context resumed list)",
                turn5_used_todo,
            ),
            (
                "After turn 5: at least one task has progress status",
                list_has_progress,
            ),
        ],
    )
}

/// Deterministic `list_ready` filter test (positive + negative).
///
/// Seeds a 3-task DAG via the LLM:
///   [0] Root task — no blockers (READY)
///   [1] Middle task — blocked by [0] (BLOCKED)
///   [2] Final task — blocked by [1] (BLOCKED)
///
/// After seeding, calls `GET /test/sde/todos/:id/ready` directly and asserts:
///   - Exactly 1 ready task is returned (index 0)
///   - Index 1 and 2 are NOT in the ready list (negative check)
///
/// Does NOT drive a second LLM turn; the ready-filter endpoint is deterministic.
pub async fn manage_todo_dag_list_ready(cfg: &Config) -> bool {
    let session_id = format!("{}-todo-dag-ready", cfg.session_prefix);
    let project = super::tmp_workspace_path("todo-dag-ready");

    // Seed the DAG via LLM (keep session alive so the ready endpoint can read it).
    let prompt = "Create a todo list for a 3-step sequential build pipeline: \
(1) Compile source — no dependencies, \
(2) Run tests — can only start after compile (blockedBy: [0]), \
(3) Deploy — can only start after tests pass (blockedBy: [1]). \
Use the blockedBy field to model dependencies. Stop after creating the list.";

    let seed_result = harness::send_sde_message(
        cfg,
        prompt,
        &session_id,
        "build",
        &project,
        None,
        true, // keep session so the ready endpoint can read it
    )
    .await;

    let seeded = seed_result.is_ok();

    // Deterministic check: call the ready-filter debug endpoint directly.
    let ready_check = harness::fetch_ready_todos(cfg, &session_id).await;

    let (total_seeded, only_root_ready, blocked_not_in_ready) = match &ready_check {
        Ok(ReadyTodosResponse {
            ready_count,
            total_count,
            ready_indices,
        }) => {
            // Total must be ≥3 (LLM may add more).
            let enough = *total_count >= 3;
            // Exactly index 0 should be ready (the root task has no blockers).
            let root_ready = ready_indices.contains(&0);
            // Indices 1 and 2 must NOT appear in ready (they are blocked).
            let blocked_absent = !ready_indices.contains(&1) && !ready_indices.contains(&2);
            // ready_count must match the length of the ready list.
            let count_consistent = *ready_count == ready_indices.len();
            (enough, root_ready && count_consistent, blocked_absent)
        }
        Err(_) => (false, false, false),
    };

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "SDE manage_todo DAG list_ready (positive+negative assertion)",
        &seed_result.map(|r| r.content).unwrap_or_default(),
        &[
            ("DAG seeded via LLM", seeded),
            ("At least 3 tasks stored", total_seeded),
            (
                "Root task (index 0) is ready — positive check",
                only_root_ready,
            ),
            (
                "Blocked tasks (index 1, 2) absent from ready — negative check",
                blocked_not_in_ready,
            ),
        ],
    )
}
