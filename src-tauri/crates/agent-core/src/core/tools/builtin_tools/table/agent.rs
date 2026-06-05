//! Unified agent / orchestration tool entries (visible to the LLM).
//!
//! `manage_project`, `manage_work_item`, and `manage_agent_def` are
//! first-class parent-agent tools. OS Agent ships with them on by default;
//! custom coordinator agents can opt in when their definition declares the
//! management capability.

use super::aliases::*;
use super::macros::action_sub;

pub(super) static TOOLS: &[ToolEntry] = &[
    ToolEntry {
        name: tool_names::AGENT,
        description: "Launch a subagent to handle a task autonomously.",
        description_detail: "Invoke any built-in or custom agent as a subagent. Built-in: builtin:explore (read-only search), builtin:general (full tools). Pass an agent_id and a detailed prompt.",
        category: tool_categories::AGENT,
        icon_id: "infinity",
        simulator_app: AppBackgroundTasks,
        app_subtool: SubSubagent,
        chat_block: CbSubagent,
        human_tool_key: Some(Sessions),
        label_running: "tools.subagentRunning",
        label_done: "tools.subagentDone",
        label_failed: "tools.subagentFailed",
        actions: &[
            action_sub!(
                "assign",
                "Assigning task to a subagent (pre-start phase)",
                SubSubagent,
                chat: CbTitleOnly,
                labels: "tools.subagentAssigning", "tools.subagentAssigned", "tools.subagentAssignFailed"
            ),
            action_sub!("delegate", "Invoke a named agent by agent_id", SubSubagent, labels: "tools.subagentDelegateRunning", "tools.subagentDelegateDone", "tools.subagentDelegateFailed"),
            action_sub!("shadow", "Clone current agent's setup for parallel subtask", SubSubagent, labels: "tools.subagentShadowRunning", "tools.subagentShadowDone", "tools.subagentShadowFailed"),
            action_sub!("kill", "Abort a running background subagent by handle", SubSubagent, labels: "tools.subagentKillRunning", "tools.subagentKillDone", "tools.subagentKillFailed"),
        ],
        required_capability: CapOrch,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::MANAGE_PROJECT,
        description: "Manage projects in the global project store.",
        description_detail: "CRUD over projects (list, read, create, update, delete) and project members (list_members, list_contributors). Projects and work items live in a global workspace store independent of any single chat session.",
        category: tool_categories::PROJECT,
        icon_id: "layout-list",
        simulator_app: AppProject,
        app_subtool: SubProject,
        chat_block: CbFallback,
        label_running: "tools.manageProjectRunning",
        label_done: "tools.manageProjectDone",
        label_failed: "tools.manageProjectFailed",
        actions: &[
            action_sub!("list", "List all projects", SubProject, labels: "tools.manageProjectListRunning", "tools.manageProjectListDone", "tools.manageProjectListFailed"),
            action_sub!("read", "Read a project's metadata", SubProject, labels: "tools.manageProjectReadRunning", "tools.manageProjectReadDone", "tools.manageProjectReadFailed"),
            action_sub!("create", "Create a new project", SubProject, labels: "tools.manageProjectCreateRunning", "tools.manageProjectCreateDone", "tools.manageProjectCreateFailed"),
            action_sub!("update", "Update project metadata", SubProject, labels: "tools.manageProjectUpdateRunning", "tools.manageProjectUpdateDone", "tools.manageProjectUpdateFailed"),
            action_sub!(
                "delete",
                "Delete a project",
                SubProject,
                labels: "tools.deleteProjectRunning", "tools.deleteProjectDone", "tools.deleteProjectFailed"
            ),
            action_sub!("list_items", "List work items on a project", SubProject, labels: "tools.manageProjectListItemsRunning", "tools.manageProjectListItemsDone", "tools.manageProjectListItemsFailed"),
            action_sub!("read_item", "Read a work item", SubProject, labels: "tools.manageProjectReadItemRunning", "tools.manageProjectReadItemDone", "tools.manageProjectReadItemFailed"),
            action_sub!("create_item", "Create a new work item", SubProject, labels: "tools.manageProjectCreateItemRunning", "tools.manageProjectCreateItemDone", "tools.manageProjectCreateItemFailed"),
            action_sub!("update_item", "Update a work item", SubProject, labels: "tools.manageProjectUpdateItemRunning", "tools.manageProjectUpdateItemDone", "tools.manageProjectUpdateItemFailed"),
            action_sub!(
                "delete_item",
                "Delete a work item",
                SubProject,
                labels: "tools.deleteWorkItemRunning", "tools.deleteWorkItemDone", "tools.deleteWorkItemFailed"
            ),
            action_sub!("start_item", "Dispatch a work item to the SDE agent", SubProject, labels: "tools.manageProjectStartItemRunning", "tools.manageProjectStartItemDone", "tools.manageProjectStartItemFailed"),
            action_sub!("find", "Search projects/work items globally", SubProject, labels: "tools.manageProjectFindRunning", "tools.manageProjectFindDone", "tools.manageProjectFindFailed"),
            action_sub!("list_members", "List team members", SubProject, labels: "tools.manageProjectListMembersRunning", "tools.manageProjectListMembersDone", "tools.manageProjectListMembersFailed"),
            action_sub!("list_contributors", "Sync and list git contributors", SubProject, labels: "tools.manageProjectListContributorsRunning", "tools.manageProjectListContributorsDone", "tools.manageProjectListContributorsFailed"),
        ],
        required_capability: CapManagement,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::MANAGE_WORK_ITEM,
        description: "Manage standalone or project-scoped work items (tasks, issues, bugs).",
        description_detail: "CRUD over Work Items (list/read/create/update/delete), link or unlink sessions, and batch multiple operations. Omit project_slug for standalone Work Items; set project_slug per batch item for multi-project creation.",
        category: tool_categories::PROJECT,
        icon_id: "layout-list",
        simulator_app: AppProject,
        app_subtool: SubProject,
        chat_block: CbFallback,
        label_running: "tools.manageWorkItemRunning",
        label_done: "tools.manageWorkItemDone",
        label_failed: "tools.manageWorkItemFailed",
        actions: &[
            action_sub!("list_items", "List work items on a project", SubProject, labels: "tools.manageWorkItemListItemsRunning", "tools.manageWorkItemListItemsDone", "tools.manageWorkItemListItemsFailed"),
            action_sub!("read_item", "Read a work item", SubProject, labels: "tools.manageWorkItemReadItemRunning", "tools.manageWorkItemReadItemDone", "tools.manageWorkItemReadItemFailed"),
            action_sub!("create_item", "Create a new work item", SubProject, labels: "tools.manageWorkItemCreateItemRunning", "tools.manageWorkItemCreateItemDone", "tools.manageWorkItemCreateItemFailed"),
            action_sub!("update_item", "Update a work item", SubProject, labels: "tools.manageWorkItemUpdateItemRunning", "tools.manageWorkItemUpdateItemDone", "tools.manageWorkItemUpdateItemFailed"),
            action_sub!(
                "delete_item",
                "Delete a work item",
                SubProject,
                labels: "tools.deleteWorkItemRunning", "tools.deleteWorkItemDone", "tools.deleteWorkItemFailed"
            ),
            action_sub!("list", "List work items on a project", SubProject, labels: "tools.manageWorkItemListRunning", "tools.manageWorkItemListDone", "tools.manageWorkItemListFailed"),
            action_sub!("read", "Read a work item", SubProject, labels: "tools.manageWorkItemReadRunning", "tools.manageWorkItemReadDone", "tools.manageWorkItemReadFailed"),
            action_sub!("create", "Create a new work item", SubProject, labels: "tools.manageWorkItemCreateRunning", "tools.manageWorkItemCreateDone", "tools.manageWorkItemCreateFailed"),
            action_sub!("update", "Update a work item", SubProject, labels: "tools.manageWorkItemUpdateRunning", "tools.manageWorkItemUpdateDone", "tools.manageWorkItemUpdateFailed"),
            action_sub!(
                "delete",
                "Delete a work item",
                SubProject,
                labels: "tools.deleteWorkItemRunning", "tools.deleteWorkItemDone", "tools.deleteWorkItemFailed"
            ),
            action_sub!("start_item", "Dispatch a work item to the SDE agent", SubProject, labels: "tools.manageWorkItemStartItemRunning", "tools.manageWorkItemStartItemDone", "tools.manageWorkItemStartItemFailed"),
            action_sub!("batch", "Run multiple standalone or project-scoped Work Item operations", SubProject, labels: "tools.manageWorkItemRunning", "tools.manageWorkItemDone", "tools.manageWorkItemFailed"),
        ],
        required_capability: CapManagement,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::MANAGE_AGENT_DEF,
        description: "Manage custom agent definitions and agent organizations.",
        description_detail: "CRUD over custom agents (list, get, create, update, remove) and agent organizations (list_orgs, get_org, create_org, update_org, remove_org). Use to inspect, create, or modify the user's library of custom agents and orgs.",
        category: tool_categories::AGENT,
        icon_id: "users",
        simulator_app: AppBackgroundTasks,
        app_subtool: OtherTool,
        chat_block: CbFallback,
        label_running: "tools.manageAgentDefRunning",
        label_done: "tools.manageAgentDefDone",
        label_failed: "tools.manageAgentDefFailed",
        action_icons: &[
            ("list", "bot-message-square"),
            ("get", "bot-message-square"),
            ("create", "bot"),
            ("update", "refresh-cw"),
            ("remove", "bot-off"),
            ("list_orgs", "users"),
            ("get_org", "users"),
            ("create_org", "bot"),
            ("update_org", "refresh-cw"),
            ("remove_org", "bot-off"),
        ],
        actions: &[
            action_sub!("list", "List custom agents", OtherTool, labels: "tools.manageAgentDefListRunning", "tools.manageAgentDefListDone", "tools.manageAgentDefListFailed"),
            action_sub!("get", "Get a custom agent definition", OtherTool, labels: "tools.manageAgentDefGetRunning", "tools.manageAgentDefGetDone", "tools.manageAgentDefGetFailed"),
            action_sub!("create", "Create a custom agent", OtherTool, labels: "tools.manageAgentDefCreateRunning", "tools.manageAgentDefCreateDone", "tools.manageAgentDefCreateFailed"),
            action_sub!("update", "Update a custom agent", OtherTool, labels: "tools.manageAgentDefUpdateRunning", "tools.manageAgentDefUpdateDone", "tools.manageAgentDefUpdateFailed"),
            action_sub!("remove", "Delete a custom agent", OtherTool, labels: "tools.manageAgentDefRemoveRunning", "tools.manageAgentDefRemoveDone", "tools.manageAgentDefRemoveFailed"),
            action_sub!("list_orgs", "List agent organizations", OtherTool, labels: "tools.manageAgentDefListOrgsRunning", "tools.manageAgentDefListOrgsDone", "tools.manageAgentDefListOrgsFailed"),
            action_sub!("get_org", "Get an org definition", OtherTool, labels: "tools.manageAgentDefGetOrgRunning", "tools.manageAgentDefGetOrgDone", "tools.manageAgentDefGetOrgFailed"),
            action_sub!("create_org", "Create an org", OtherTool, labels: "tools.manageAgentDefCreateOrgRunning", "tools.manageAgentDefCreateOrgDone", "tools.manageAgentDefCreateOrgFailed"),
            action_sub!("update_org", "Update an org", OtherTool, labels: "tools.manageAgentDefUpdateOrgRunning", "tools.manageAgentDefUpdateOrgDone", "tools.manageAgentDefUpdateOrgFailed"),
            action_sub!("remove_org", "Delete an org", OtherTool, labels: "tools.manageAgentDefRemoveOrgRunning", "tools.manageAgentDefRemoveOrgDone", "tools.manageAgentDefRemoveOrgFailed"),
        ],
        required_capability: CapManagement,
        ..DEFAULT_TOOL_ENTRY
    },
];
