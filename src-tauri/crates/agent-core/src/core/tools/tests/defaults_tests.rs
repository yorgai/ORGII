//! Tests for tool defaults: role-scoped support metadata, subagent
//! deny/forbidden lists, and `derive_disabled_tools`.
//!
//! Runtime availability is materialized from capability-derived defaults plus
//! explicit `restrict_to` / `excluded` lists on `ResolvedToolSelection`.
//! Management tools are intentionally not advertised for SDE workers.

use crate::tools::builtin_tools::BUILTIN_TOOLS;
use crate::tools::defaults::*;
use crate::tools::names as tool_names;
use crate::tools::ui_metadata::AgentKind;
use std::collections::HashSet;

// -- supported_agents_for ---------------------------------------------------

#[test]
fn management_tools_are_not_supported_on_sde_worker_kind() {
    for tool_name in [
        tool_names::MANAGE_SESSION,
        tool_names::MANAGE_PROJECT,
        tool_names::MANAGE_WORK_ITEM,
        tool_names::MANAGE_AGENT_DEF,
    ] {
        let agents = supported_agents_for(tool_name);
        assert!(agents.contains(&AgentKind::Os), "{tool_name} on OS");
        assert!(agents.contains(&AgentKind::Custom), "{tool_name} on Custom");
        assert!(!agents.contains(&AgentKind::Sde), "{tool_name} not on SDE");
    }
}

#[test]
fn non_management_tools_supported_on_every_parent_agent_kind() {
    for entry in BUILTIN_TOOLS.iter().filter(|entry| {
        !matches!(
            entry.name,
            tool_names::MANAGE_SESSION
                | tool_names::MANAGE_PROJECT
                | tool_names::MANAGE_WORK_ITEM
                | tool_names::MANAGE_AGENT_DEF
        )
    }) {
        let agents = supported_agents_for(entry.name);
        for kind in [AgentKind::Os, AgentKind::Sde, AgentKind::Custom] {
            assert!(
                agents.contains(&kind),
                "{} should be reported as supported on {:?}",
                entry.name,
                kind,
            );
        }
    }
}

// -- Subagent defaults ------------------------------------------------------

#[test]
fn subagent_disabled_list_not_empty() {
    assert!(
        !DEFAULT_SUBAGENT_DISABLED.is_empty(),
        "Subagent disabled defaults should contain at least one tool"
    );
}

#[test]
fn subagent_disabled_no_duplicates() {
    let mut seen = HashSet::new();
    for name in DEFAULT_SUBAGENT_DISABLED {
        assert!(
            seen.insert(name),
            "Duplicate in DEFAULT_SUBAGENT_DISABLED: {name}"
        );
    }
}

#[test]
fn subagent_forbidden_contains_user_interaction_tools() {
    let forbidden: HashSet<&str> = SUBAGENT_FORBIDDEN_TOOLS.iter().copied().collect();
    for expected in &[
        "send_message",
        "manage_session",
        "ask_user_questions",
        "suggest_mode_switch",
        "agent",
        "create_plan",
    ] {
        assert!(
            forbidden.contains(expected),
            "SUBAGENT_FORBIDDEN_TOOLS missing: {expected}"
        );
    }
}

#[test]
fn subagent_forbidden_and_default_disabled_disjoint() {
    let forbidden: HashSet<&str> = SUBAGENT_FORBIDDEN_TOOLS.iter().copied().collect();
    let disabled: HashSet<&str> = DEFAULT_SUBAGENT_DISABLED.iter().copied().collect();
    let overlap: Vec<&&str> = forbidden.intersection(&disabled).collect();
    assert!(
        overlap.is_empty(),
        "SUBAGENT_FORBIDDEN_TOOLS and DEFAULT_SUBAGENT_DISABLED must be disjoint, but share: {overlap:?}"
    );
}

#[test]
fn retired_aliases_disjoint_from_forbidden_and_default_disabled() {
    let forbidden: HashSet<&str> = SUBAGENT_FORBIDDEN_TOOLS.iter().copied().collect();
    let disabled: HashSet<&str> = DEFAULT_SUBAGENT_DISABLED.iter().copied().collect();
    let aliases: HashSet<&str> = SUBAGENT_RETIRED_TOOL_ALIASES.iter().copied().collect();
    assert!(
        forbidden.is_disjoint(&aliases),
        "An alias in SUBAGENT_RETIRED_TOOL_ALIASES is also a real \
         forbidden tool — fold it into SUBAGENT_FORBIDDEN_TOOLS instead"
    );
    assert!(
        disabled.is_disjoint(&aliases),
        "An alias in SUBAGENT_RETIRED_TOOL_ALIASES is also default-disabled \
         — keep retired-only names out of the live tool registry"
    );
}

#[test]
fn retired_aliases_have_no_live_tool_registration() {
    let live: HashSet<&str> = BUILTIN_TOOLS.iter().map(|e| e.name).collect();
    for alias in SUBAGENT_RETIRED_TOOL_ALIASES {
        assert!(
            !live.contains(alias),
            "Retired alias {alias:?} now collides with a live BUILTIN_TOOLS \
             entry — either rename the new tool or remove it from \
             SUBAGENT_RETIRED_TOOL_ALIASES"
        );
    }
}

#[test]
fn subagent_helpers_return_owned() {
    let forbidden = subagent_forbidden_tools();
    assert_eq!(forbidden.len(), SUBAGENT_FORBIDDEN_TOOLS.len());
    for (owned, static_ref) in forbidden.iter().zip(SUBAGENT_FORBIDDEN_TOOLS.iter()) {
        assert_eq!(owned.as_str(), *static_ref);
    }

    let disabled = default_subagent_disabled_tools();
    assert_eq!(disabled.len(), DEFAULT_SUBAGENT_DISABLED.len());
    for (owned, static_ref) in disabled.iter().zip(DEFAULT_SUBAGENT_DISABLED.iter()) {
        assert_eq!(owned.as_str(), *static_ref);
    }
}

// -- derive_disabled_tools --------------------------------------------------

#[test]
fn derive_capabilities_no_longer_gate_tools() {
    // With no restrict/exclude lists, no tool is disabled.
    let disabled = derive_disabled_tools(&[], &[]);
    assert!(
        !disabled.contains(tool_names::EDIT_FILE),
        "edit_file must NOT be disabled just because coding capability is absent"
    );
    assert!(
        !disabled.contains(tool_names::CONTROL_DESKTOP_WITH_PEEKABOO),
        "control_desktop_with_peekaboo must NOT be disabled just because desktop capability is absent"
    );
    assert!(
        !disabled.contains(tool_names::MANAGE_PROJECT),
        "derive_disabled_tools only applies explicit restrict/exclude lists; capability defaults own management gating"
    );
}

#[test]
fn derive_explicit_allowlist_restricts() {
    let allowlist = vec![
        tool_names::READ_FILE.to_string(),
        tool_names::LIST_DIR.to_string(),
    ];
    let disabled = derive_disabled_tools(&allowlist, &[]);
    assert!(
        !disabled.contains(tool_names::READ_FILE),
        "read_file is in the allowlist — should be enabled"
    );
    assert!(
        disabled.contains(tool_names::RUN_SHELL),
        "run_shell is not in the allowlist — should be disabled"
    );
    assert!(
        disabled.contains(tool_names::LIST_KNOWN_WORKSPACES),
        "non-builtin registered channel tools must also respect strict allowlists"
    );
}

#[test]
fn derive_explicit_denylist_disables_tool() {
    let denylist = vec![tool_names::EDIT_FILE.to_string()];
    let disabled = derive_disabled_tools(&[], &denylist);
    assert!(
        disabled.contains(tool_names::EDIT_FILE),
        "edit_file is in the denylist — should be disabled"
    );
}

#[test]
fn derive_empty_allowlist_means_no_restriction() {
    let disabled_with_empty = derive_disabled_tools(&[], &[]);
    let disabled_without = derive_disabled_tools(&[], &[]);
    assert_eq!(disabled_with_empty, disabled_without);
}
