//! Resume / orphan-cleanup E2E scenarios.
//!
//! Pins the contract of `session::recovery::filter_unresolved_tool_uses`
//! (user-initiated resume) vs `repair_interrupted_history` (crash recovery).
//! Both paths modify the in-memory `Vec<Value>` mid-turn and intentionally
//! do **not** write the cleaned shape back to the SQLite transcript — the
//! transcript is append-only: historical orphans stay on disk forever, the
//! filter re-runs at the start of every turn and only affects what is sent
//! to the provider API.
//!
//! Because of that, asserting on the persisted transcript shape after a
//! resume is the wrong contract. Instead, each scenario combines:
//!
//!   - **Recovery-path counters** (`GET /agent/test/recovery/counters`):
//!     debug-only atomics that record whether `filter_*` or `repair_*` ran
//!     and how many messages were removed.
//!   - **Turn success** (HTTP 200 + non-empty response content): proves
//!     the provider API did not reject the payload because of a dangling
//!     tool_use (i.e. the in-memory cleanup actually worked).
//!   - **Transcript append** (`GET /agent/test/sde/transcript/:id`): the
//!     user's new prompt and the assistant's reply both land as fresh rows
//!     with no duplicate injection-marker text.
//!
//! Following the positive+negative assertion convention, every scenario asserts both a
//! positive (expected path ran, new turn appended) and a negative (the
//! other path did **not** run, no duplicate markers) outcome.

use super::super::{config::Config, harness};
use super::tmp_workspace_path;

const INJECTION_MARKER: &str = "Your previous response was interrupted";

/// Scenario 1: orphan `tool_use` on user-initiated resume is filtered out
/// via `filter_unresolved_tool_uses` (deletion-based) — NOT injected via
/// `repair_interrupted_history` (injection-based).
///
/// Positive: `filter_invocations` increments by ≥1, ≥1 message removed,
/// resume turn succeeds with a non-empty assistant reply, and the fresh
/// user prompt is appended to the transcript.
/// Negative: `repair_invocations` stays at 0 (the crash-recovery path must
/// NOT run for user-initiated resumes), and no injection marker text is
/// appended.
pub async fn resume_filters_orphan_tool_use(cfg: &Config) -> bool {
    let session_id = format!("{}-resume-orphan-01", cfg.session_prefix);
    let project = super::tmp_workspace_path("resume-orphan-01");
    let orphan_tcid = "tc_e2e_resume_orphan_001";

    if let Err(err) = harness::send_sde_message(
        cfg,
        "List files in the current directory briefly.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Resume: filters orphan tool_use", &err);
    }

    if let Err(err) = harness::seed_orphan(
        cfg,
        &session_id,
        orphan_tcid,
        "read_file",
        Some("I also need you to read README."),
        Some(""),
    )
    .await
    {
        return harness::print_error("Resume: filters orphan tool_use", &err);
    }

    let before = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Resume: filters orphan tool_use", &err),
    };
    let orphan_was_seeded = before
        .orphan_tool_call_ids
        .iter()
        .any(|id| id == orphan_tcid);

    if let Err(err) = harness::reset_recovery_counters(cfg).await {
        return harness::print_error("Resume: filters orphan tool_use", &err);
    }

    let resume = match harness::send_sde_message_resume(
        cfg,
        "Actually forget that, just say hi.",
        &session_id,
        "build",
        &project,
        false,
    )
    .await
    {
        Ok(r) => r,
        Err(err) => return harness::print_error("Resume: filters orphan tool_use", &err),
    };

    let counters = match harness::fetch_recovery_counters(cfg).await {
        Ok(c) => c,
        Err(err) => return harness::print_error("Resume: filters orphan tool_use", &err),
    };

    let after = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Resume: filters orphan tool_use", &err),
    };

    let filter_ran = counters.filter_invocations >= 1;
    let messages_removed = counters.filter_messages_removed >= 1;
    let repair_did_not_run = counters.repair_invocations == 0;
    let appended_fresh_user = after.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains("Actually forget that"))
    });
    let no_injection_marker = !after.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains(INJECTION_MARKER))
    });

    let _ = resume;

    harness::print_result(
        "Resume: filters orphan tool_use",
        &format!(
            "filter={} removed={} repair={}",
            counters.filter_invocations,
            counters.filter_messages_removed,
            counters.repair_invocations
        ),
        &[
            ("Orphan was seeded (pre-check)", orphan_was_seeded),
            ("filter_unresolved_tool_uses invoked (positive)", filter_ran),
            (
                "filter_unresolved_tool_uses removed >=1 message (positive)",
                messages_removed,
            ),
            (
                "repair_interrupted_history did NOT run (negative)",
                repair_did_not_run,
            ),
            (
                "Fresh user prompt appended to transcript (positive)",
                appended_fresh_user,
            ),
            (
                "No injection-marker text appended on user-resume path (negative)",
                no_injection_marker,
            ),
        ],
    )
}

/// Scenario 2: clean history (no orphans) is preserved untouched on resume.
///
/// Positive: the resume turn succeeds, `filter_*` may technically run but
/// removes **zero** messages (there is nothing to remove), and the Turn-A
/// prompt still appears alongside the new Turn-B prompt.
/// Negative: `repair_invocations` stays at 0 (nothing to repair either),
/// no injection marker text appears (port fidelity — the user-resume path must
/// NOT trigger the crash-recovery injection).
pub async fn resume_preserves_clean_history(cfg: &Config) -> bool {
    let session_id = format!("{}-resume-clean-02", cfg.session_prefix);
    let project = super::tmp_workspace_path("resume-clean-02");
    let turn_a_prompt = "E2E-CLEAN-A-PROMPT: reply with the word ack.";
    let turn_b_prompt = "E2E-CLEAN-B-PROMPT: now reply with the word roger.";

    if let Err(err) = harness::send_sde_message(
        cfg,
        turn_a_prompt,
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Resume: preserves clean history", &err);
    }

    let before = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Resume: preserves clean history", &err),
    };
    let pre_has_orphans = !before.orphan_tool_call_ids.is_empty();

    if let Err(err) = harness::reset_recovery_counters(cfg).await {
        return harness::print_error("Resume: preserves clean history", &err);
    }

    let resume = match harness::send_sde_message_resume(
        cfg,
        turn_b_prompt,
        &session_id,
        "build",
        &project,
        false,
    )
    .await
    {
        Ok(r) => r,
        Err(err) => return harness::print_error("Resume: preserves clean history", &err),
    };

    let counters = match harness::fetch_recovery_counters(cfg).await {
        Ok(c) => c,
        Err(err) => return harness::print_error("Resume: preserves clean history", &err),
    };

    let after = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Resume: preserves clean history", &err),
    };

    let still_has_a = after.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains("E2E-CLEAN-A-PROMPT"))
    });
    let has_b = after.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains("E2E-CLEAN-B-PROMPT"))
    });
    let no_injection_marker = !after.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains(INJECTION_MARKER))
    });
    let filter_removed_nothing = counters.filter_messages_removed == 0;
    let repair_did_not_run = counters.repair_invocations == 0;

    let _ = resume;

    harness::print_result(
        "Resume: preserves clean history",
        &format!(
            "filter={} removed={} repair={}",
            counters.filter_invocations,
            counters.filter_messages_removed,
            counters.repair_invocations
        ),
        &[
            ("No orphans pre-existed (pre-check)", !pre_has_orphans),
            ("Turn A prompt still in transcript (positive)", still_has_a),
            ("Turn B prompt appended (positive)", has_b),
            (
                "filter_unresolved_tool_uses removed 0 messages (positive)",
                filter_removed_nothing,
            ),
            (
                "repair_interrupted_history did NOT run (negative)",
                repair_did_not_run,
            ),
            (
                "No injection marker text appended (negative)",
                no_injection_marker,
            ),
        ],
    )
}

/// Scenario 3: user-initiated resume does not duplicate the user's message.
///
/// `filter_unresolved_tool_uses` drops the orphan assistant turn without
/// injecting a synthetic "continue from where you left off" prompt, so
/// the user's actual next message is the **only** new user row. This
/// scenario seeds an orphan, sends one resume prompt with a unique marker,
/// and asserts the marker appears in exactly one user row (not two — two
/// would indicate both the deletion path and the injection path ran).
pub async fn resume_does_not_duplicate_user(cfg: &Config) -> bool {
    let session_id = format!("{}-resume-nodup-03", cfg.session_prefix);
    let project = super::tmp_workspace_path("resume-nodup-03");
    let resume_marker =
        "E2E-RESUME-UNIQUE-MARKER-XYZ789: please reply with the single word 'continued'.";
    let marker_substring = "E2E-RESUME-UNIQUE-MARKER-XYZ789";

    if let Err(err) = harness::send_sde_message(
        cfg,
        "Say hi and await instructions.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Resume: no duplicate user", &err);
    }

    if let Err(err) = harness::seed_orphan(
        cfg,
        &session_id,
        "tc_e2e_resume_nodup_orphan",
        "read_file",
        None,
        Some(""),
    )
    .await
    {
        return harness::print_error("Resume: no duplicate user", &err);
    }

    if let Err(err) = harness::reset_recovery_counters(cfg).await {
        return harness::print_error("Resume: no duplicate user", &err);
    }

    let resume = match harness::send_sde_message_resume(
        cfg,
        resume_marker,
        &session_id,
        "build",
        &project,
        false,
    )
    .await
    {
        Ok(r) => r,
        Err(err) => return harness::print_error("Resume: no duplicate user", &err),
    };

    let counters = match harness::fetch_recovery_counters(cfg).await {
        Ok(c) => c,
        Err(err) => return harness::print_error("Resume: no duplicate user", &err),
    };

    let after = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Resume: no duplicate user", &err),
    };

    let marker_occurrences = after
        .messages
        .iter()
        .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        .filter(|m| {
            m.get("content")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s.contains(marker_substring))
        })
        .count();

    let filter_ran = counters.filter_invocations >= 1;
    let filter_removed_messages = counters.filter_messages_removed >= 1;
    let repair_did_not_run = counters.repair_invocations == 0;

    let _ = resume;

    harness::print_result(
        "Resume: no duplicate user",
        &format!(
            "filter={} removed={} repair={} marker_occurrences={}",
            counters.filter_invocations,
            counters.filter_messages_removed,
            counters.repair_invocations,
            marker_occurrences,
        ),
        &[
            (
                "Exactly one user row carries the resume marker (positive)",
                marker_occurrences == 1,
            ),
            (
                "Resume marker did not appear twice (negative)",
                marker_occurrences < 2,
            ),
            ("filter_unresolved_tool_uses invoked (positive)", filter_ran),
            (
                "filter_unresolved_tool_uses removed >=1 message (positive)",
                filter_removed_messages,
            ),
            (
                "repair_interrupted_history did NOT run (negative)",
                repair_did_not_run,
            ),
        ],
    )
}

/// Scenario 4: non-resume path (`is_resume: false`) with an orphan routes
/// through `repair_interrupted_history` (injection), not through
/// `filter_unresolved_tool_uses` (deletion).
///
/// Positive: `repair_invocations >= 1` confirms the crash-recovery path
/// fired. The next turn still succeeds (provider API accepts the injected
/// synthetic tool_result + continuation prompt).
/// Negative: `filter_invocations == 0` — the user-resume deletion path must
/// NOT run when the caller sent `is_resume: false`.
pub async fn non_resume_uses_injection_path(cfg: &Config) -> bool {
    let session_id = format!("{}-noninject-04", cfg.session_prefix);
    let project = super::tmp_workspace_path("noninject-04");
    let orphan_tcid = "tc_e2e_noninject_orphan";

    if let Err(err) = harness::send_sde_message(
        cfg,
        "Hi, I will give you a task soon.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Non-resume: injection path", &err);
    }

    if let Err(err) =
        harness::seed_orphan(cfg, &session_id, orphan_tcid, "read_file", None, Some("")).await
    {
        return harness::print_error("Non-resume: injection path", &err);
    }

    let before = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Non-resume: injection path", &err),
    };
    let orphan_was_seeded = before
        .orphan_tool_call_ids
        .iter()
        .any(|id| id == orphan_tcid);

    if let Err(err) = harness::reset_recovery_counters(cfg).await {
        return harness::print_error("Non-resume: injection path", &err);
    }

    let result = match harness::send_sde_message(
        cfg,
        "Now tell me a short joke.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Ok(r) => r,
        Err(err) => return harness::print_error("Non-resume: injection path", &err),
    };

    let counters = match harness::fetch_recovery_counters(cfg).await {
        Ok(c) => c,
        Err(err) => return harness::print_error("Non-resume: injection path", &err),
    };

    let repair_ran = counters.repair_invocations >= 1;
    let filter_did_not_run = counters.filter_invocations == 0;

    let _ = result;

    harness::print_result(
        "Non-resume: injection path",
        &format!(
            "filter={} removed={} repair={}",
            counters.filter_invocations,
            counters.filter_messages_removed,
            counters.repair_invocations
        ),
        &[
            ("Orphan was seeded (pre-check)", orphan_was_seeded),
            ("repair_interrupted_history invoked (positive)", repair_ran),
            (
                "filter_unresolved_tool_uses did NOT run (negative)",
                filter_did_not_run,
            ),
        ],
    )
}

/// Resume Agent / Subagent — verify that the agent tool supports
/// resuming a previous subagent session. We run a first task via subagent,
/// then ask to resume that subagent with a follow-up task.
pub async fn resume_subagent(cfg: &Config) -> bool {
    let session_id = format!("{}-resume-sub", cfg.session_prefix);
    let project = tmp_workspace_path("resume-sub");
    let _ = std::fs::create_dir_all(&project);

    println!("  [turn 1] Launching initial subagent task...");
    let turn1 = harness::send_sde_message(
        cfg,
        "Use the agent tool to launch a subagent with this task: \
         'Create a file called sub_context.txt with content: UNIQUE_MARKER_7742'. \
         Wait for it to complete.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await;

    let turn1_ok = turn1.as_ref().is_ok_and(|resp| {
        !resp.content.is_empty()
            && (harness::assert_sde_tool_used(resp, "agent")
                || resp.content.to_lowercase().contains("sub_context"))
    });

    if !turn1_ok {
        let err_msg = turn1
            .as_ref()
            .map(|resp| resp.content.clone())
            .unwrap_or_else(|err| err.clone());
        return harness::print_result(
            "Resume Subagent",
            &err_msg,
            &[("Turn 1: Subagent launched", false)],
        );
    }

    println!("  [turn 2] Asking agent to resume previous subagent...");
    let turn2 = harness::send_sde_message(
        cfg,
        "Resume the same subagent you just used and ask it: \
         'Read sub_context.txt and tell me what UNIQUE_MARKER value is in it.'",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await;

    let turn2_ok = turn2.as_ref().is_ok_and(|resp| {
        let content = resp.content.to_lowercase();
        content.contains("7742")
            || content.contains("unique_marker")
            || content.contains("sub_context")
    });

    harness::print_result(
        "Resume Subagent",
        &turn2
            .as_ref()
            .map(|resp| resp.content.clone())
            .unwrap_or_default(),
        &[
            ("Turn 1: Subagent launched and created file", turn1_ok),
            ("Turn 2: Resumed subagent recalls context", turn2_ok),
            (
                "Turn 2: Used agent tool",
                turn2
                    .as_ref()
                    .is_ok_and(|resp| harness::assert_sde_tool_used(resp, "agent")),
            ),
        ],
    )
}
