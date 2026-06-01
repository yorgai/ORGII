//! Agent operations tool registration: session, comms, question, nodes,
//! project, agent definition.
//!
//! Note: The unified `agent` tool is registered separately in OS/SDE init
//! because it requires additional dependencies (LLM provider).

use std::collections::HashSet;
use std::sync::Arc;

use crate::tools::impls::agent_def::AgentDefinitionTool;
use crate::tools::impls::comms::send_message::MessageTool;
use crate::tools::impls::nodes::manage_nodes::NodesTool;
use crate::tools::impls::orchestration::ask_user_questions::{QuestionTool, QuestionToolContext};
use crate::tools::impls::orchestration::manage_session::SessionTool;
use crate::tools::impls::project::manage_project::ProjectTool;
use crate::tools::impls::project::manage_work_item::WorkItemTool;
use crate::tools::registry::ToolRegistry;

use super::{register_if_enabled, ToolDeps};

/// Register all agent-operations tools that `deps` can support.
///
/// Covers: `session`, `message`, `question`, `nodes`,
/// `project`, `agent_definition`.
///
/// Note: The unified `agent` tool is registered separately in OS/SDE agent init
/// because it requires an LLM provider which is created at agent initialization time.
pub fn register(registry: &mut ToolRegistry, deps: &ToolDeps, disabled: &HashSet<String>) {
    // ── Session (SDE agent management / human proxy) ──
    if let (Some(ref bridge), Some(ref current_id)) =
        (&deps.action_bridge, &deps.current_account_id)
    {
        register_if_enabled(
            registry,
            Box::new(SessionTool::new(
                Arc::clone(bridge),
                Arc::clone(current_id),
                deps.agent_model.clone(),
            )),
            disabled,
        );
    }

    // ── Message ──
    if let Some(ref bus) = deps.bus {
        register_if_enabled(registry, Box::new(MessageTool::new(bus.clone())), disabled);
    }

    // ── Question ──
    if let Some(ref qm) = deps.question_manager {
        let ctx = Arc::new(QuestionToolContext::new(Arc::clone(qm)));
        register_if_enabled(registry, Box::new(QuestionTool::new(ctx)), disabled);
    }

    // ── Nodes ──
    if let Some(ref node_reg) = deps.node_registry {
        register_if_enabled(
            registry,
            Box::new(NodesTool::new(node_reg.clone())),
            disabled,
        );
    }

    // ── Project / work items ──
    register_if_enabled(
        registry,
        Box::new(ProjectTool::new(
            deps.app_handle.clone(),
            deps.current_account_id.clone(),
            deps.agent_model.clone(),
        )),
        disabled,
    );
    register_if_enabled(registry, Box::new(WorkItemTool::new()), disabled);

    // ── Agent definition ──
    if let Some(ref handle) = deps.app_handle {
        register_if_enabled(
            registry,
            Box::new(AgentDefinitionTool::new(handle.clone())),
            disabled,
        );
    }
}
