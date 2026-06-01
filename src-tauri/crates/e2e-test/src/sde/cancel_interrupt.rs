//! Cancel-interrupt E2E scenarios.
//!
//! When a user cancels a turn, the runtime records a one-shot
//! `last_turn_cancelled` marker. The next turn consumes that marker, filters
//! unresolved tool calls from in-memory history, and suppresses crash-repair
//! injection so the fresh user request stays primary. The pieces involved:
//!
//!   1. Calling `mark_turn_cancelled` at every cancel exit point in
//!      `turn_executor` — this writes `last_turn_cancelled = 1` to the
//!      `agent_sessions` table.
//!   2. In `processor.rs` step 4b: reading the flag with `take_turn_cancelled`
//!      (atomic read-and-clear), filtering unresolved tool uses from the
//!      in-memory message list only, and suppressing synthetic crash repair.
//!   3. The interrupt sentinel is retained only as a legacy constant and must
//!      not be persisted to `agent_messages`, so the UI transcript stays clean.
//!
//! These scenarios are **fully deterministic** (no LLM calls) and pin three
//! contracts per the positive+negative assertion convention:
//!
//!   - Positive: flag is set after cancel; `take_turn_cancelled` returns `true`
//!     and clears the flag.
//!   - Negative: after the flag is consumed, it is `false`; transcript never
//!     contains the sentinel text.

use super::super::{config::Config, harness};
use super::tmp_workspace_path;

/// The interrupt sentinel text (must match `recovery::USER_INTERRUPT_SENTINEL`).
const INTERRUPT_SENTINEL: &str = "[Request interrupted by user]";

/// Scenario 1 (`cancel-interrupt-flag-set`): deterministic flag lifecycle.
///
/// Positive:
///   - After `seed_cancel_flag`, `fetch_cancel_flag` returns `true`.
///   - `take_cancel_flag` returns `was_cancelled = true`.
///   - After the take, `fetch_cancel_flag` returns `false` (consumed).
///
/// Negative:
///   - Sentinel text does NOT appear in the persisted transcript because the
///     marker only triggers in-memory injection in the next LLM turn — it is
///     never written to `agent_messages`.
pub async fn cancel_interrupt_flag_set(cfg: &Config) -> bool {
    let session_id = format!("{}-cancel-interrupt-01", cfg.session_prefix);
    let project = tmp_workspace_path("cancel-interrupt-01");

    // Bootstrap a real session so the `agent_sessions` row exists.
    if let Err(err) = harness::send_sde_message(
        cfg,
        "E2E-CANCEL-INTERRUPT-BOOTSTRAP: reply with the word ready.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Cancel-interrupt: flag lifecycle", &err);
    }

    // Confirm flag starts clear.
    let flag_before = match harness::fetch_cancel_flag(cfg, &session_id).await {
        Ok(f) => f,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };

    // Seed the cancel flag (mirrors what turn_executor does on cancel).
    if let Err(err) = harness::seed_cancel_flag(cfg, &session_id).await {
        return harness::print_error("Cancel-interrupt: flag lifecycle", &err);
    }

    // Positive: flag is now set.
    let flag_after_seed = match harness::fetch_cancel_flag(cfg, &session_id).await {
        Ok(f) => f,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };

    // Positive: take-and-clear returns true.
    let was_cancelled = match harness::take_cancel_flag(cfg, &session_id).await {
        Ok(f) => f,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };

    // Negative: flag is now clear (consumed exactly once).
    let flag_after_take = match harness::fetch_cancel_flag(cfg, &session_id).await {
        Ok(f) => f,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };

    // Second take must return false (idempotent clear).
    let second_take = match harness::take_cancel_flag(cfg, &session_id).await {
        Ok(f) => f,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };

    // Negative: sentinel text must NOT appear in the persisted transcript.
    let transcript = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Cancel-interrupt: flag lifecycle", &err),
    };
    let sentinel_in_transcript = transcript.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains(INTERRUPT_SENTINEL))
    });

    // Cleanup.
    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    harness::print_result(
        "Cancel-interrupt: flag lifecycle",
        &format!(
            "before={} after_seed={} was_cancelled={} after_take={} second_take={}",
            flag_before, flag_after_seed, was_cancelled, flag_after_take, second_take
        ),
        &[
            ("Flag starts clear (pre-check)", !flag_before),
            ("Flag set after seed (positive)", flag_after_seed),
            ("take returns was_cancelled=true (positive)", was_cancelled),
            ("Flag clear after take (negative)", !flag_after_take),
            (
                "Second take returns false — idempotent (negative)",
                !second_take,
            ),
            (
                "Sentinel NOT in persisted transcript (negative)",
                !sentinel_in_transcript,
            ),
        ],
    )
}

/// Scenario 2 (`cancel-interrupt-no-repair`): confirm that a cancelled turn
/// does not trigger synthetic crash repair, while still deleting unresolved
/// tool calls so the next provider request is valid.
///
/// We seed an orphan `tool_use` to simulate what the DB looks like after a
/// cancel mid-tool, then also seed the cancel flag. A normal (non-resume) turn
/// should consume the flag, filter the orphan from the in-memory history, and
/// avoid `repair_interrupted_history` injection.
///
/// Positive: `filter_invocations` runs and removes the orphan.
/// Negative: `repair_invocations` stays at 0, so no synthetic continuation
/// message is injected. The fresh user prompt succeeds.
pub async fn cancel_interrupt_no_repair(cfg: &Config) -> bool {
    let session_id = format!("{}-cancel-interrupt-02", cfg.session_prefix);
    let project = tmp_workspace_path("cancel-interrupt-02");
    let orphan_tcid = "tc_e2e_cancel_interrupt_orphan";

    // Bootstrap session.
    if let Err(err) = harness::send_sde_message(
        cfg,
        "E2E-CANCEL-INTERRUPT-NOREPAIR: say hi.",
        &session_id,
        "build",
        &project,
        None,
        true,
    )
    .await
    {
        return harness::print_error("Cancel-interrupt: no repair", &err);
    }

    // Seed an orphan tool call — mimics a cancel that happened mid-tool.
    if let Err(err) =
        harness::seed_orphan(cfg, &session_id, orphan_tcid, "read_file", None, Some("")).await
    {
        return harness::print_error("Cancel-interrupt: no repair", &err);
    }

    // Seed the cancel flag — mimics turn_executor calling mark_turn_cancelled.
    if let Err(err) = harness::seed_cancel_flag(cfg, &session_id).await {
        return harness::print_error("Cancel-interrupt: no repair", &err);
    }

    if let Err(err) = harness::reset_recovery_counters(cfg).await {
        return harness::print_error("Cancel-interrupt: no repair", &err);
    }

    // Normal (non-resume) turn — processor should filter unresolved tool uses
    // and suppress repair_interrupted_history.
    let expected_marker = "E2E_CANCEL_INTERRUPT_ACK_9341";
    let result = match harness::send_sde_message(
        cfg,
        &format!("Reply with exactly {expected_marker} and no other words."),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Ok(r) => r,
        Err(err) => return harness::print_error("Cancel-interrupt: no repair", &err),
    };

    let counters = match harness::fetch_recovery_counters(cfg).await {
        Ok(c) => c,
        Err(err) => return harness::print_error("Cancel-interrupt: no repair", &err),
    };

    let agent_responded = !result.content.is_empty();

    let filter_ran = counters.filter_invocations >= 1;
    let orphan_removed = counters.filter_messages_removed >= 1;
    let repair_did_not_run = counters.repair_invocations == 0;

    // Negative: sentinel must NOT appear in the persisted transcript.
    let transcript = match harness::fetch_transcript(cfg, &session_id).await {
        Ok(t) => t,
        Err(err) => return harness::print_error("Cancel-interrupt: no repair", &err),
    };
    let sentinel_not_persisted = !transcript.messages.iter().any(|m| {
        m.get("content")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.contains(INTERRUPT_SENTINEL))
    });

    harness::print_result(
        "Cancel-interrupt: no repair",
        &format!(
            "filter={} removed={} repair={} agent_responded={}",
            counters.filter_invocations,
            counters.filter_messages_removed,
            counters.repair_invocations,
            agent_responded
        ),
        &[
            ("Agent responded (turn succeeded)", agent_responded),
            ("Cancelled-turn filter ran (positive)", filter_ran),
            (
                "Cancelled-turn orphan was removed (positive)",
                orphan_removed,
            ),
            (
                "repair_interrupted_history did NOT run (negative)",
                repair_did_not_run,
            ),
            (
                "Sentinel NOT in persisted transcript (negative)",
                sentinel_not_persisted,
            ),
        ],
    )
}
