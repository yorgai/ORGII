use crate::session::AgentExecMode;

// -- parse --
//
// `parse` returns `Option<Self>` so callers must explicitly handle
// unknown variants. The previous catch-all → `Build` fallback was a
// safety reversal: a typo'd wire payload would silently downgrade
// `Plan` / `Ask` / `Review` (read-only) into `Build` (full
// write access). See `state/commands/session/message.rs` for the
// production caller path.

#[test]
fn parse_known_modes() {
    assert_eq!(AgentExecMode::parse("plan"), Some(AgentExecMode::Plan));
    assert_eq!(AgentExecMode::parse("ask"), Some(AgentExecMode::Ask));
    assert_eq!(AgentExecMode::parse("review"), Some(AgentExecMode::Review));
    assert_eq!(AgentExecMode::parse("debug"), Some(AgentExecMode::Debug));
    assert_eq!(
        AgentExecMode::parse("wingman"),
        Some(AgentExecMode::Wingman)
    );
    assert_eq!(AgentExecMode::parse("build"), Some(AgentExecMode::Build));
}

#[test]
fn parse_is_case_insensitive() {
    assert_eq!(AgentExecMode::parse("PLAN"), Some(AgentExecMode::Plan));
    assert_eq!(AgentExecMode::parse("Build"), Some(AgentExecMode::Build));
}

#[test]
fn parse_unknown_returns_none() {
    // Realistic typos that previously slipped through the catch-all and
    // were silently re-routed to `Build`, defeating Plan/Ask
    // read-only safety.
    assert_eq!(AgentExecMode::parse(""), None);
    assert_eq!(AgentExecMode::parse("plann"), None);
    assert_eq!(AgentExecMode::parse("explore"), None); // retired alias
}

// -- as_str --

#[test]
fn as_str_round_trips() {
    for mode in &[
        AgentExecMode::Build,
        AgentExecMode::Ask,
        AgentExecMode::Plan,
        AgentExecMode::Debug,
        AgentExecMode::Review,
        AgentExecMode::Wingman,
    ] {
        assert_eq!(AgentExecMode::parse(mode.as_str()), Some(*mode));
    }
}

// -- policy_layer --

#[test]
fn build_mode_denies_create_plan() {
    let policy = AgentExecMode::Build.policy_layer().unwrap();
    assert!(
        policy.allow.is_none(),
        "Build must use deny-delta (allow=None)"
    );
    assert!(
        policy.deny.contains(&"create_plan".to_string()),
        "Build mode must deny create_plan to force suggest_mode_switch"
    );
}

#[test]
fn plan_mode_uses_deny_delta() {
    let policy = AgentExecMode::Plan.policy_layer().unwrap();
    assert!(
        policy.allow.is_none(),
        "Plan must use deny-delta (allow=None), not an independent allow-list"
    );
    let deny = &policy.deny;
    for blocked in &[
        "edit_file",
        "apply_patch",
        "run_shell",
        "await_output",
        "worktree",
        "manage_lsp",
        "setup_repo",
    ] {
        assert!(
            deny.contains(&blocked.to_string()),
            "Plan deny-list must block {blocked}"
        );
    }
    assert!(
        !deny.contains(&"create_plan".to_string()),
        "Plan mode must NOT deny create_plan"
    );
    assert!(
        !deny.contains(&"read_file".to_string()),
        "Plan mode must not deny read-only tools"
    );
}

#[test]
fn ask_mode_uses_deny_delta() {
    let policy = AgentExecMode::Ask.policy_layer().unwrap();
    assert!(
        policy.allow.is_none(),
        "Ask must use deny-delta (allow=None)"
    );
    let deny = &policy.deny;
    assert!(
        deny.contains(&"edit_file".to_string()),
        "Ask must deny edit_file"
    );
    assert!(
        deny.contains(&"create_plan".to_string()),
        "Ask must deny create_plan (Plan-only)"
    );
    assert!(
        !deny.contains(&"read_file".to_string()),
        "Ask must not deny read-only tools"
    );
    assert!(
        !deny.contains(&"ask_user_questions".to_string()),
        "Ask must allow ask_user_questions"
    );
}

#[test]
fn review_mode_uses_deny_delta() {
    let policy = AgentExecMode::Review.policy_layer().unwrap();
    assert!(
        policy.allow.is_none(),
        "Review must use deny-delta (allow=None)"
    );
    let deny = &policy.deny;
    assert!(
        deny.contains(&"edit_file".to_string()),
        "Review must deny edit_file"
    );
    assert!(
        deny.contains(&"create_plan".to_string()),
        "Review must deny create_plan"
    );
    assert!(
        !deny.contains(&"manage_work_item".to_string()),
        "Review must allow manage_work_item"
    );
    assert!(
        !deny.contains(&"read_file".to_string()),
        "Review must allow read_file"
    );
}

#[test]
fn wingman_mode_has_no_policy_layer() {
    assert!(
        AgentExecMode::Wingman.policy_layer().is_none(),
        "Wingman has no exec-mode policy — the agent definition's systemRestrictToTools is the sole gate"
    );
}

// -- effective_max_iterations (via UnifiedMessageProcessor) --
//
// AgentExecMode no longer owns a max_iterations() method.
// The effective cap is computed in UnifiedMessageProcessor::effective_max_iterations(),
// which takes the lower of (session_model cap, mode cap).
// Tests for the processor helper live in execute.rs.
// Here we only document the expected mode caps for reference.

// -- system_prompt_suffix --

#[test]
fn system_prompt_suffix_nonempty() {
    for mode in &[
        AgentExecMode::Build,
        AgentExecMode::Ask,
        AgentExecMode::Plan,
        AgentExecMode::Debug,
        AgentExecMode::Review,
        AgentExecMode::Wingman,
    ] {
        assert!(!mode.system_prompt_suffix().is_empty());
    }
}

#[test]
fn plan_suffix_instructs_llm_to_call_create_plan_as_submission() {
    let suffix = AgentExecMode::Plan.system_prompt_suffix();
    assert!(
        suffix.contains("create_plan"),
        "Plan prompt must instruct the LLM to use create_plan"
    );
    assert!(
        !suffix.contains("exit_plan_mode"),
        "exit_plan_mode was — prompt must not reference it"
    );
    assert!(
        suffix.contains("IS the submission") || suffix.contains("is the submission"),
        "Plan prompt must make clear that calling create_plan IS the submission step"
    );
    assert!(
        suffix.contains("call `create_plan` immediately"),
        "Plan prompt must prevent post-research drift when approval/buildable plan submission is explicit"
    );
    assert!(
        suffix.contains("treat research as complete after reading that file once and submit the plan now"),
        "Plan prompt must submit directly when the user message already contains enough plan inputs"
    );
}

/// Plan mode is top-level only: subagents spawned from Plan mode run in Build.
/// The prompt should steer the LLM toward `builtin:explore` for subagent
/// research instead of letting it try to delegate plan authoring, matching
/// the hardcoded `Build` mode in `AgentTool::execute`.
#[test]
fn plan_suffix_for_pending_feedback_requires_create_plan_before_search() {
    let suffix = AgentExecMode::Plan.system_prompt_suffix();
    assert!(
        suffix.contains("do NOT search first"),
        "Plan prompt must prevent search-first behavior for pending-plan feedback"
    );
    assert!(
        suffix.contains("revision request for the current pending plan"),
        "Plan prompt must classify follow-up feedback as pending-plan revision"
    );
    assert!(
        suffix.contains("call `create_plan` again"),
        "Plan prompt must require a new create_plan revision for pending-plan feedback"
    );
    assert!(
        suffix.contains("new file path") && suffix.contains("fresh evidence"),
        "Plan prompt must narrowly scope when read/search is allowed before create_plan"
    );
}

#[test]
fn plan_suffix_tells_llm_subagents_run_in_build() {
    let suffix = AgentExecMode::Plan.system_prompt_suffix();
    assert!(
        suffix.contains("subagent") || suffix.contains("subagents"),
        "Plan prompt must mention subagents at least once"
    );
    assert!(
        suffix.contains("Build mode") || suffix.contains("run in Build"),
        "Plan prompt must clarify subagents always run in Build mode"
    );
    assert!(
        suffix.contains("builtin:explore"),
        "Plan prompt must recommend builtin:explore for read-only subagent research"
    );
}

#[test]
fn build_suffix_limits_mode_switch_to_plan() {
    let suffix = AgentExecMode::Build.system_prompt_suffix();
    assert!(suffix.contains("target_mode=\"plan\""));
    assert!(
        !suffix.contains("target_mode=\"explore\""),
        "Explore is gone — Build prompt must not reference it"
    );
}

// After the user approves a plan, the LLM should fall into Build mode
#[test]
fn build_suffix_instructs_direct_file_edits_for_explicit_file_requests() {
    let suffix = AgentExecMode::Build.system_prompt_suffix();
    assert!(
        suffix.contains("exact file path/name and exact content"),
        "Build prompt must make direct file creation/edit requests tool-imperative"
    );
    assert!(
        suffix.contains("use the file editing tool immediately"),
        "Build prompt must prevent post-request thinking drift for explicit file edits"
    );
}

// and execute the approved plan directly. It may use todos for genuinely
// complex work, but the continuation must not force a checklist before
// acting because simple approved plans should go straight to coding tools.
#[test]
fn build_suffix_includes_post_plan_continuation_guidance() {
    let suffix = AgentExecMode::Build.system_prompt_suffix();
    assert!(
        suffix.contains("Post-Plan Continuation"),
        "Build prompt must include the post-plan section header"
    );
    assert!(
        suffix.contains("execute the approved plan directly"),
        "Build prompt must tell the LLM to execute the approved plan"
    );
    assert!(
        suffix.contains("Use `manage_todo` only when"),
        "Build prompt must keep todo usage conditional"
    );
    assert!(
        suffix.contains("create_plan"),
        "Build prompt must name the trigger (last turn ended with create_plan)"
    );
    assert!(
        !suffix.contains("exit_plan_mode"),
        "exit_plan_mode was — Build prompt must not reference it"
    );
}

// Plan mode's submit-step text must reflect the non-blocking flow: no explicit
// reject, user iteration is just a chat reply.
#[test]
fn plan_suffix_describes_nonblocking_submit_flow() {
    let suffix = AgentExecMode::Plan.system_prompt_suffix();
    assert!(
        !suffix.contains("approve, reject, or edit-and-approve"),
        "Plan prompt must drop the old blocking approve/reject/edit wording"
    );
    assert!(
        suffix.contains("Build"),
        "Plan prompt must name the UI action users see (Build button)"
    );
    assert!(
        suffix.contains("no explicit \"reject\"") || suffix.contains("no explicit reject"),
        "Plan prompt must clarify there is no reject action"
    );
}

// -- Display + Default --

#[test]
fn display_matches_as_str() {
    assert_eq!(format!("{}", AgentExecMode::Build), "build");
    assert_eq!(format!("{}", AgentExecMode::Plan), "plan");
    assert_eq!(format!("{}", AgentExecMode::Ask), "ask");
}

#[test]
fn default_is_build() {
    assert_eq!(AgentExecMode::default(), AgentExecMode::Build);
}

// -- Serialize/Deserialize --

#[test]
fn serde_round_trip() {
    let mode = AgentExecMode::Review;
    let json = serde_json::to_string(&mode).unwrap();
    assert_eq!(json, "\"review\"");
    let parsed: AgentExecMode = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, mode);
}

#[test]
fn ask_serde_round_trip() {
    let mode = AgentExecMode::Ask;
    let json = serde_json::to_string(&mode).unwrap();
    assert_eq!(json, "\"ask\"");
    let parsed: AgentExecMode = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, mode);
}

// -- TurnConfig.max_iterations semantics --
//
// `UnifiedProcessor::effective_max_iterations()` takes the lower of the
// session-model cap and the exec-mode cap. Tests for that helper live in
// execute.rs (processor tests). The constants used there are:
//   Plan / Ask / Review => 30
//   Build / Debug / Wingman     => no mode cap (session model governs alone)
