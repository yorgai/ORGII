//! Post-compaction plan preservation.
//!
//! An approved plan enters the conversation exactly once — as the
//! `[Plan approved]` user message that kicks off the Build turn. Without
//! protection, the first compaction that folds that message into the
//! summary removes the plan's full text from the model's context forever;
//! the Build-mode "execute the approved plan" instruction then points at
//! nothing, and long plans quietly stop being followed ("plan 烂尾").
//!
//! This module gives the plan the same special treatment the reference
//! implementation gives it (`plan_file_reference`: the plan is the ONE
//! file preserved verbatim across compaction, with an explicit
//! "continue working on it" instruction):
//!
//! - [`extract_active_plan`] finds the newest plan-bearing message in the
//!   pre-compaction list — either the original `[Plan approved]` kick-off
//!   or a previously injected preservation reminder.
//! - [`reinject_plan_after_compaction`] re-injects the plan verbatim right
//!   after the compact summary, unless the surviving tail still contains
//!   it. The injected message carries the same recognizable header, so the
//!   NEXT compaction finds it again — the plan survives any number of
//!   compaction rounds until the session ends or a new plan supersedes it.

use serde_json::Value;
use tracing::info;

/// Header of the Build kick-off message (see
/// `state/commands/session/interaction.rs`). `(edited)` markers make the
/// prefix vary, so match on the bracket prefix only.
const PLAN_APPROVED_PREFIX: &str = "[Plan approved";

/// Header of the preservation message this module injects.
const PLAN_PRESERVED_PREFIX: &str = "[Plan reminder — preserved across compaction]";

/// Upper bound on preserved plan text. Plans are markdown documents, not
/// transcripts; anything beyond this is almost certainly not a plan.
const MAX_PRESERVED_PLAN_CHARS: usize = 32_000;

fn message_text(msg: &Value) -> Option<&str> {
    match msg.get("content") {
        Some(Value::String(text)) => Some(text),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .find_map(|block| block.get("text").and_then(Value::as_str)),
        _ => None,
    }
}

fn is_plan_bearing(msg: &Value) -> bool {
    if msg.get("role").and_then(Value::as_str) != Some("user") {
        return false;
    }
    message_text(msg).is_some_and(|text| {
        text.starts_with(PLAN_APPROVED_PREFIX) || text.starts_with(PLAN_PRESERVED_PREFIX)
    })
}

/// Extract the newest plan text from the pre-compaction message list.
///
/// Returns the plan BODY (everything after the kick-off boilerplate's
/// `## Approved plan` header when present, else the full message text).
pub fn extract_active_plan(messages: &[Value]) -> Option<String> {
    let text = messages
        .iter()
        .rev()
        .find(|msg| is_plan_bearing(msg))
        .and_then(message_text)?;

    // Strip the kick-off boilerplate down to the plan body when the
    // canonical header is present; keep the whole text otherwise.
    let body = match text.find("## Approved plan") {
        Some(idx) => &text[idx..],
        None => text,
    };
    if body.len() > MAX_PRESERVED_PLAN_CHARS {
        return None; // not plausibly a plan document — don't amplify junk
    }
    Some(body.to_string())
}

/// Re-inject the active plan after compaction when the surviving tail no
/// longer carries it. Inserted right after the leading compact summary so
/// the plan sits at the top of the rebuilt context.
pub fn reinject_plan_after_compaction(
    pre_compaction_messages: &[Value],
    compacted_messages: &mut Vec<Value>,
) {
    let Some(plan_body) = extract_active_plan(pre_compaction_messages) else {
        return;
    };

    // Already survived (short conversations keep the tail intact)?
    if compacted_messages.iter().any(is_plan_bearing) {
        return;
    }

    let reminder = format!(
        "{PLAN_PRESERVED_PREFIX}\nThe approved plan below is still the active task. \
         If it is not already complete, continue working on it. Check each item \
         before declaring the task done.\n\n{plan_body}",
    );

    // Insert after the compact summary (index 0 when present), mirroring
    // file re-injection placement.
    let insert_idx = if compacted_messages.is_empty() { 0 } else { 1 };
    compacted_messages.insert(
        insert_idx,
        serde_json::json!({ "role": "user", "content": reminder }),
    );
    info!(
        "[plan-preservation] Re-injected approved plan ({} chars) after compaction",
        plan_body.len()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan_kickoff() -> Value {
        json!({
            "role": "user",
            "content": "[Plan approved] Implement the approved plan now.\n\nExecute the approved plan directly. ...\n\n## Approved plan\n\n# Refactor X\n\n1. step one\n2. step two"
        })
    }

    #[test]
    fn extracts_plan_body_from_kickoff() {
        let msgs = vec![json!({"role": "user", "content": "hi"}), plan_kickoff()];
        let body = extract_active_plan(&msgs).expect("plan found");
        assert!(body.starts_with("## Approved plan"));
        assert!(body.contains("step two"));
    }

    #[test]
    fn reinjects_when_plan_compacted_away() {
        let pre = vec![plan_kickoff(), json!({"role": "assistant", "content": "working"})];
        let mut post = vec![
            json!({"role": "user", "content": "[Conversation summary — 2 earlier messages compacted]\n\nsummary"}),
            json!({"role": "assistant", "content": "recent"}),
        ];
        reinject_plan_after_compaction(&pre, &mut post);
        assert_eq!(post.len(), 3);
        let text = post[1]["content"].as_str().unwrap();
        assert!(text.starts_with("[Plan reminder — preserved across compaction]"));
        assert!(text.contains("step two"));
        assert!(text.contains("continue working on it"));
    }

    #[test]
    fn skips_when_plan_survived_in_tail() {
        let pre = vec![plan_kickoff()];
        let mut post = vec![
            json!({"role": "user", "content": "[Conversation summary — compacted]\n\ns"}),
            plan_kickoff(),
        ];
        reinject_plan_after_compaction(&pre, &mut post);
        assert_eq!(post.len(), 2, "no duplicate injection");
    }

    #[test]
    fn preserved_reminder_is_found_by_next_compaction() {
        // Round 1 injects; round 2's pre-compact list contains the
        // preservation message — it must be recognized as plan-bearing.
        let pre1 = vec![plan_kickoff()];
        let mut post1 = vec![json!({"role": "user", "content": "[Conversation summary — c]\n\ns"})];
        reinject_plan_after_compaction(&pre1, &mut post1);

        let pre2 = post1.clone();
        let mut post2 = vec![json!({"role": "user", "content": "[Conversation summary — c2]\n\ns2"})];
        reinject_plan_after_compaction(&pre2, &mut post2);
        assert_eq!(post2.len(), 2);
        assert!(post2[1]["content"]
            .as_str()
            .unwrap()
            .contains("step two"));
    }

    #[test]
    fn no_plan_no_injection() {
        let pre = vec![json!({"role": "user", "content": "just chatting"})];
        let mut post = vec![json!({"role": "user", "content": "[Conversation summary — c]\n\ns"})];
        reinject_plan_after_compaction(&pre, &mut post);
        assert_eq!(post.len(), 1);
    }

    #[test]
    fn newest_plan_wins() {
        let old = json!({"role": "user", "content": "[Plan approved] ...\n\n## Approved plan\n\nOLD PLAN"});
        let new = json!({"role": "user", "content": "[Plan approved (edited)] ...\n\n## Approved plan\n\nNEW PLAN"});
        let msgs = vec![old, json!({"role": "assistant", "content": "x"}), new];
        let body = extract_active_plan(&msgs).unwrap();
        assert!(body.contains("NEW PLAN"));
        assert!(!body.contains("OLD PLAN"));
    }
}
