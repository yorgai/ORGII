//! `SessionOverrides` — per-session mutable state.
//!
//! # Role
//!
//! `ResolvedAgent` is an immutable snapshot of an `AgentDefinition` at
//! session launch. But some things a user does *during* a session are
//! session-scoped rather than agent-scoped — e.g., running one prompt
//! against a different workspace, or using a one-off display label. Those
//! live here.
//!
//! Three invariants hold (per §2.4 of the the agent-definition design doc):
//!
//! 1. **In-memory only.** Never serialised, never persisted. A session end
//!    deletes every override. Persistent changes belong on `AgentDefinition`.
//! 2. **Not read by background subsystems.** Consolidation, scheduler, and
//!    cron-style subsystems read `ResolvedAgent` only — they must not see
//!    overrides from a live session.
//! 3. **Read order: `overrides` first, `resolved` fallback.** Session-local
//!    code paths (prompt builders, tool handlers) check `overrides.foo`
//!    first, fall back to `resolved.foo` if it's `None`.
//!
//! # Field selection
//!
//! This struct holds exactly two fields: `workspace` and `animate`. That is
//! the minimum needed for a session to pick its own directory and animation
//! setting without mutating the underlying `AgentDefinition`.
//!
//! Additional overrides (`execution_mode`, `exec_mode`, `excluded_tools`)
//! are expected in a follow-up phase that wires mode-switch and runtime
//! tool-disable plumbing. Adding them now would leave the fields
//! unreachable — the same dead-code pattern the wiring checklist
//! warns against.

use std::path::PathBuf;

/// In-memory, per-session overrides over a `ResolvedAgent`.
///
/// All fields are `Option<T>` so "unset" is distinguishable from "set to
/// the type's default". The read pattern is always
/// `overrides.field.as_ref().unwrap_or(&resolved.field)` (or the
/// `Option`-returning helpers on `AgentSession`).
#[derive(Debug, Clone, Default)]
pub struct SessionOverrides {
    /// Workspace directory for this session — semantically the agent's
    /// `working_dir` (the cwd file tools execute against), NOT the
    /// user-visible `workspace_root`. For non-worktree sessions the two
    /// collapse onto each other; for worktree sessions the override
    /// must be the shadow checkout, never the user's project tree.
    /// This is the same projection as `SessionIdentity.workspace_root`
    /// (a `working_dir` projection of `SessionWorkspace`). Defaults to
    /// the resolved agent's workspace (via `personal_workspace()`)
    /// when `None`.
    pub workspace: Option<PathBuf>,

    /// Whether this session animates streaming output. When `None`, falls
    /// back to the resolved agent's `animate` flag.
    pub animate: Option<bool>,
}

impl SessionOverrides {
    /// Convenience constructor for tests and for the session-launch path
    /// that knows the full override set at launch time.
    pub fn new(workspace: Option<PathBuf>, animate: Option<bool>) -> Self {
        Self { workspace, animate }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_overrides_are_empty() {
        let overrides = SessionOverrides::default();
        assert!(overrides.workspace.is_none());
        assert!(overrides.animate.is_none());
    }

    #[test]
    fn new_preserves_all_fields() {
        let overrides = SessionOverrides::new(Some(PathBuf::from("/tmp/project")), Some(false));
        assert_eq!(
            overrides.workspace.as_deref(),
            Some(std::path::Path::new("/tmp/project"))
        );
        assert_eq!(overrides.animate, Some(false));
    }
}
