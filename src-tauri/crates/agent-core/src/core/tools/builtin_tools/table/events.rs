//! Event-only tool entries (not invokable tools — UI metadata only, all hidden).
//!
//! Used by the chat panel and replay renderer to look up icon/block dispatch
//! for synthetic events the LLM never calls directly (mode-switch suggestions,
//! permission prompts, thinking traces, raw user/agent messages, subagent
//! containers, MCP-routed calls, fallback `tool_call` rows).

use super::aliases::*;

pub(super) static TOOLS: &[ToolEntry] = &[
    ToolEntry {
        name: tool_names::SUGGEST_MODE_SWITCH,
        description: "Suggest switching the agent execution mode.",
        description_detail: "Proposes a mode switch (e.g., to plan mode) with a reason. The user or system confirms or skips the switch.",
        category: tool_categories::EVENT,
        icon_id: "arrow-right-left",
        simulator_app: AppChannels,
        app_subtool: OtherInteractions,
        chat_block: CbTitleOnly,
        hidden: true,
        label_running: "tools.suggestModeSwitchRunning",
        label_done: "tools.suggestModeSwitchDone",
        label_failed: "tools.suggestModeSwitchFailed",
        status_icons: &[
            ("switched", "check-circle-2"),
            ("skipped", "arrow-right-left"),
        ],
        status_labels: &[
            ("switched", "tools.suggestModeSwitchSwitched"),
            ("skipped", "tools.suggestModeSwitchSkipped"),
        ],
        required_capability: CapOrch,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::ASK_USER_PERMISSIONS,
        description: "Request user approval before executing a tool.",
        description_detail: "Presents a permission prompt for a tool invocation that requires explicit user consent.",
        category: tool_categories::EVENT,
        icon_id: "bell-ring",
        simulator_app: AppChannels,
        app_subtool: OtherInteractions,
        chat_block: CbTitleOnly,
        hidden: true,
        label_running: "tools.askUserPermissionsRunning",
        label_done: "tools.askUserPermissionsDone",
        label_failed: "tools.askUserPermissionsFailed",
        status_icons: &[
            ("approved", "check-circle-2"),
            ("denied", "x-circle"),
        ],
        status_labels: &[
            ("approved", "tools.askUserPermissionsGranted"),
            ("denied", "tools.askUserPermissionsDenied"),
        ],
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: "thinking",
        description: "LLM reasoning / thinking output.",
        description_detail: "Internal model reasoning trace displayed to the user. Not an invokable tool.",
        category: tool_categories::EVENT,
        icon_id: "sparkle",
        simulator_app: AppChannels,
        app_subtool: SubThinking,
        chat_block: CbFallback,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: "agent_message",
        description: "Agent text response to the user.",
        description_detail: "The main conversational output from the agent. Not an invokable tool.",
        category: tool_categories::EVENT,
        icon_id: "message-circle",
        simulator_app: AppChannels,
        app_subtool: Message,
        chat_block: CbFallback,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        // Matches `functionName: "user_message"` emitted by the frontend event
        // builders (`eventBuilders.ts`). Routes user prompts to the Channels
        // chat tab (`AppChannels` + `Message`) so:
        //   1. `buildMessageLists` in Channels/config.ts keeps user events
        //      alongside assistant messages.
        //   2. Replay controls can switch the simulator to Channels when the
        //      user-message event is selected.
        // Symmetric with the `agent_message` entry above.
        name: "user_message",
        description: "User message to the agent.",
        description_detail: "A user-authored message in the conversation. Not an invokable tool.",
        category: tool_categories::EVENT,
        icon_id: "user",
        simulator_app: AppChannels,
        app_subtool: Message,
        chat_block: CbFallback,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: "subagent",
        description: "Subagent execution container.",
        description_detail: "Wraps a delegated subagent's lifecycle (start, progress, completion) in the chat history.",
        category: tool_categories::EVENT,
        icon_id: "infinity",
        simulator_app: AppBackgroundTasks,
        app_subtool: SubSubagent,
        chat_block: CbSubagent,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: "mcp_tool",
        description: "MCP server tool call.",
        description_detail: "Tool call routed to an external Model Context Protocol server.",
        category: tool_categories::EVENT,
        icon_id: "mcp-logo",
        simulator_app: AppCode,
        app_subtool: OtherTool,
        chat_block: CbFallback,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: "tool_call",
        description: "Generic tool call.",
        description_detail: "Fallback renderer for tool calls without a dedicated event component.",
        category: tool_categories::EVENT,
        icon_id: "wrench",
        simulator_app: AppCode,
        app_subtool: OtherTool,
        chat_block: CbFallback,
        hidden: true,
        ..DEFAULT_TOOL_ENTRY
    },
];
