//! Interactive tool registry — single source of truth for tools whose
//! `execute()` blocks the agent turn awaiting user input.
//!
//! These tools differ from regular tools in two ways:
//!
//! 1. Their tool_call event remains in a "waiting" state for an arbitrary
//!    duration — far longer than any normal tool execution.
//! 2. The frontend renders an interactive surface (question card, permission
//!    prompt, mode-switch confirmation, plan-submission card) tied to the
//!    event; closing that surface prematurely loses user-facing affordances.
//!
//! Treating them with the same lifecycle as regular tools (Running →
//! Completed) leads to bugs like AskQuestionCard disappearing the moment any
//! generic "complete the running event" path fires (e.g. `agent:complete`
//! arriving after a turn the model thinks is done while a user-input tool is
//! still blocking).
//!
//! The fix: give them a distinct lifecycle phase (`AwaitingUser`) so generic
//! completion paths can skip them, and only `agent:interaction_finalized`
//! transitions them to `Completed`.

use crate::tools::names;

/// Tools that block the agent turn awaiting user input from the frontend.
///
/// Keep this list aligned with tools that go through
/// `crate::interaction::finalize::finalize_interaction_event`
/// when they complete. Adding a new interactive tool requires:
///   1. Adding its name constant here, and
///   2. Calling `finalize_interaction_event` from the tool's response path.
///
/// `CREATE_PLAN` is in this list because — like the user-question tools —
/// calling it also submits the plan for user review. Its tool_call event
/// must stay in `AwaitingUser` until the user clicks Build (or supersedes
/// the plan with a new `create_plan` call), matching the FE `CreatePlanCard`
/// lifecycle.
pub const INTERACTIVE_TOOL_NAMES: &[&str] = &[
    names::ASK_USER_QUESTIONS,
    names::ASK_USER_PERMISSIONS,
    names::SUGGEST_MODE_SWITCH,
    names::CREATE_PLAN,
];

/// Returns `true` if the given tool name is an interactive tool whose
/// `execute()` blocks the agent turn awaiting user input.
#[inline]
pub fn is_interactive_tool(tool_name: &str) -> bool {
    INTERACTIVE_TOOL_NAMES.contains(&tool_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_interactive_tools() {
        assert!(is_interactive_tool(names::ASK_USER_QUESTIONS));
        assert!(is_interactive_tool(names::ASK_USER_PERMISSIONS));
        assert!(is_interactive_tool(names::SUGGEST_MODE_SWITCH));
        assert!(is_interactive_tool(names::CREATE_PLAN));
    }

    #[test]
    fn rejects_non_interactive_tools() {
        assert!(!is_interactive_tool(names::READ_FILE));
        assert!(!is_interactive_tool(names::EDIT_FILE));
        assert!(!is_interactive_tool(names::MANAGE_TODO));
        assert!(!is_interactive_tool(names::RUN_SHELL));
    }

    #[test]
    fn rejects_unknown_tool_names() {
        assert!(!is_interactive_tool(""));
        assert!(!is_interactive_tool("totally_made_up_tool"));
    }
}
