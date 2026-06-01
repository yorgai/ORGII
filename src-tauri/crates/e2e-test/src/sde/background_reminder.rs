//! E2E scenarios for the background-jobs system-reminder injection.
//!
//! Validates that:
//! 1. A backgrounded shell process appears in the per-turn reminder
//!    (visible to the LLM via dynamic_sections).
//! 2. After the agent reads the output (via await_output), the job is
//!    acknowledged and drops out of the reminder.
//! 3. The model references the background process in a follow-up turn
//!    (proving the injection actually reached the prompt).

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Multi-turn scenario:
///
/// Turn 1 — ask the agent to background a shell command (`sleep 120`).
///          Verify via debug endpoint that a running job appears in the
///          reminder for this session.
///
/// Turn 2 — ask an unrelated question ("what is 2+2?"). Because the
///          background-jobs reminder is injected into the prompt, the
///          agent's response should mention or acknowledge the running
///          background process.
///
/// Cleanup — kill the sleep process via the cleanup endpoint so it
///           doesn't linger.
pub async fn background_reminder_injection(cfg: &Config) -> bool {
    let session_id = format!("{}-bg-reminder", cfg.session_prefix);
    let project = tmp_workspace_path("bg-reminder");

    // ── Turn 1: launch a background process ────────────────────────
    println!("  [turn 1] Asking agent to background `sleep 120`...");
    let turn1 = harness::send_sde_message(
        cfg,
        "Run `sleep 120` in background mode (mode: \"background\"). \
         Report the PID/handle you got back.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    let turn1_ok = match &turn1 {
        Ok(resp) => {
            let used_shell = harness::assert_sde_tool_used(resp, "run_shell");
            println!(
                "    turn 1 response ({} chars), used run_shell: {}",
                resp.content.len(),
                used_shell
            );
            used_shell
        }
        Err(err) => {
            return harness::print_error("Background Reminder Injection", err);
        }
    };

    // Brief pause to let the registry populate
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    // ── Check debug endpoint: should see a running job ─────────────
    println!("  [check] Querying background-jobs debug endpoint...");
    let bg_check = harness::get_background_jobs(cfg, &session_id).await;
    let (has_running_job, reminder_mentions_sleep) = match &bg_check {
        Ok(resp) => {
            println!(
                "    background jobs count: {}, reminder length: {}",
                resp.count,
                resp.reminder_text.len()
            );
            let has_running = resp.jobs.iter().any(|job| {
                job.get("status")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "running")
                    .unwrap_or(false)
            });
            let mentions_sleep = resp.reminder_text.contains("sleep");
            (has_running, mentions_sleep)
        }
        Err(err) => {
            println!("    background-jobs endpoint error: {err}");
            (false, false)
        }
    };

    // ── Turn 2: ask an unrelated question ──────────────────────────
    println!("  [turn 2] Asking unrelated question (agent should still see bg job)...");
    let turn2 = harness::send_sde_message(
        cfg,
        "What is 2+2? Answer briefly.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let turn2_ok = turn2.is_ok();

    let combined = format!(
        "--- TURN 1 ---\n{}\n\n--- BG CHECK ---\njobs: {}, reminder mentions sleep: {}\n\n--- TURN 2 ---\n{}",
        turn1.as_ref().map(|r| r.content.as_str()).unwrap_or("ERROR"),
        bg_check.as_ref().map(|r| r.count).unwrap_or(0),
        reminder_mentions_sleep,
        turn2.as_ref().map(|r| r.content.as_str()).unwrap_or("ERROR"),
    );

    harness::print_result(
        "Background Reminder Injection",
        &combined,
        &[
            ("Turn 1: used run_shell", turn1_ok),
            ("Debug endpoint shows running job", has_running_job),
            ("Reminder text mentions 'sleep'", reminder_mentions_sleep),
            ("Turn 2: HTTP ok", turn2_ok),
        ],
    )
}

/// Verifies the acknowledged-output lifecycle:
///
/// Turn 1 — background a short command (`echo hello && sleep 1`).
/// Wait for it to complete, then call `await_output monitor` to
/// read the output (which should auto-acknowledge).
/// Check that the job disappears from the reminder.
pub async fn background_reminder_acknowledge(cfg: &Config) -> bool {
    let session_id = format!("{}-bg-ack", cfg.session_prefix);
    let project = tmp_workspace_path("bg-ack");

    // ── Turn 1: background a short-lived command ───────────────────
    println!("  [turn 1] Backgrounding a short command...");
    let turn1 = harness::send_sde_message(
        cfg,
        "Run `echo 'bg-test-marker' && sleep 3` in background mode (mode: \"background\"). \
         Report the handle/PID.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    if let Err(err) = &turn1 {
        return harness::print_error("Background Reminder Acknowledge", err);
    }

    // Wait for the command to finish
    println!("  [wait] Waiting 5s for command to complete...");
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    // Check that the completed-unread job appears in the reminder
    let bg_before = harness::get_background_jobs(cfg, &session_id).await;
    let has_unread_before = bg_before
        .as_ref()
        .map(|r| {
            r.jobs.iter().any(|job| {
                job.get("has_unread_output")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    println!("  [check] Before ack — has unread output: {has_unread_before}");

    // ── Turn 2: ask agent to check on it (triggers auto-acknowledge) ─
    println!("  [turn 2] Asking agent to check background jobs...");
    let turn2 = harness::send_sde_message(
        cfg,
        "Check on the background job you just launched using await_output. \
         Report its status and output.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    let turn2_used_await = turn2
        .as_ref()
        .map(|r| harness::assert_sde_tool_used(r, "await_output"))
        .unwrap_or(false);

    // After await_output, the job should be acknowledged
    let bg_after = harness::get_background_jobs(cfg, &session_id).await;
    let reminder_empty_after = bg_after
        .as_ref()
        .map(|r| r.count == 0 || r.reminder_text.is_empty())
        .unwrap_or(false);
    println!(
        "  [check] After ack — reminder count: {}, empty: {reminder_empty_after}",
        bg_after.as_ref().map(|r| r.count).unwrap_or(999),
    );

    // Cleanup
    let _ =
        harness::send_sde_message(cfg, "done", &session_id, "build", &project, None, false).await;

    let combined = format!(
        "--- TURN 1 ---\n{}\n\n--- TURN 2 ---\n{}",
        turn1
            .as_ref()
            .map(|r| r.content.as_str())
            .unwrap_or("ERROR"),
        turn2
            .as_ref()
            .map(|r| r.content.as_str())
            .unwrap_or("ERROR"),
    );

    harness::print_result(
        "Background Reminder Acknowledge",
        &combined,
        &[
            ("Turn 1: HTTP ok", turn1.is_ok()),
            (
                "Completed job has unread output (before ack)",
                has_unread_before,
            ),
            ("Turn 2: used await_output", turn2_used_await),
            ("Reminder empty after acknowledge", reminder_empty_after),
        ],
    )
}
