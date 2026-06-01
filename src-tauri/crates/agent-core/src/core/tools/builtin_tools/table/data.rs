//! Data-category tool entries (remote nodes + database).

use super::aliases::*;
use super::macros::action_sub;

pub(super) static TOOLS: &[ToolEntry] = &[
    ToolEntry {
        name: tool_names::MANAGE_NODES,
        description: "Control remote devices (mobile, IoT) connected via WebSocket.",
        description_detail: "Sends commands to remote devices registered through the nodes bridge, such as phones, IoT endpoints, or simulators, over WebSocket.",
        category: tool_categories::DATA,
        icon_id: "network",
        simulator_app: AppCode,
        app_subtool: OtherTool,
        chat_block: CbFallback,
        label_running: "tools.manageNodesRunning",
        label_done: "tools.manageNodesDone",
        label_failed: "tools.manageNodesFailed",
        actions: &[
            action_sub!("status", "Get connection status of all nodes", OtherTool, labels: "tools.manageNodesStatusRunning", "tools.manageNodesStatusDone", "tools.manageNodesStatusFailed"),
            action_sub!("describe", "Get device capabilities and metadata", OtherTool, labels: "tools.manageNodesDescribeRunning", "tools.manageNodesDescribeDone", "tools.manageNodesDescribeFailed"),
            action_sub!("notify", "Send a notification to a device", OtherTool, labels: "tools.manageNodesNotifyRunning", "tools.manageNodesNotifyDone", "tools.manageNodesNotifyFailed"),
            action_sub!("camera_snap", "Take a photo with the device camera", OtherTool, labels: "tools.manageNodesCameraSnapRunning", "tools.manageNodesCameraSnapDone", "tools.manageNodesCameraSnapFailed"),
            action_sub!("camera_list", "List available cameras", OtherTool, labels: "tools.manageNodesCameraListRunning", "tools.manageNodesCameraListDone", "tools.manageNodesCameraListFailed"),
            action_sub!("camera_clip", "Record a short video clip", OtherTool, labels: "tools.manageNodesCameraClipRunning", "tools.manageNodesCameraClipDone", "tools.manageNodesCameraClipFailed"),
            action_sub!("screen_record", "Capture screen recording", OtherTool, labels: "tools.manageNodesScreenRecordRunning", "tools.manageNodesScreenRecordDone", "tools.manageNodesScreenRecordFailed"),
            action_sub!("location_get", "Get device GPS location", OtherTool, labels: "tools.manageNodesLocationGetRunning", "tools.manageNodesLocationGetDone", "tools.manageNodesLocationGetFailed"),
            action_sub!("run", "Execute a command on the device", OtherTool, labels: "tools.manageNodesRunRunning", "tools.manageNodesRunDone", "tools.manageNodesRunFailed"),
            action_sub!("invoke", "Call a custom device capability", OtherTool, labels: "tools.manageNodesInvokeRunning", "tools.manageNodesInvokeDone", "tools.manageNodesInvokeFailed"),
        ],
        required_capability: CapData,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::DB_EXPLORE,
        description: "Explore database connections, tables, and column schemas.",
        description_detail: "Discover configured databases and their structure. Use to understand database layout before writing queries.",
        category: tool_categories::DATA,
        icon_id: "database",
        simulator_app: AppDb,
        app_subtool: SubDb,
        chat_block: CbFallback,
        label_running: "tools.databaseMetaRunning",
        label_done: "tools.databaseMetaDone",
        label_failed: "tools.databaseMetaFailed",
        actions: &[
            action_sub!("list_connections", "Enumerate all configured database connections", SubDb, labels: "tools.databaseMetaListConnectionsRunning", "tools.databaseMetaListConnectionsDone", "tools.databaseMetaListConnectionsFailed"),
            action_sub!("list_tables", "List tables and views in a connection", SubDb, labels: "tools.databaseMetaListTablesRunning", "tools.databaseMetaListTablesDone", "tools.databaseMetaListTablesFailed"),
            action_sub!("schema", "Get column definitions for a specific table", SubDb, labels: "tools.databaseMetaSchemaRunning", "tools.databaseMetaSchemaDone", "tools.databaseMetaSchemaFailed"),
        ],
        required_capability: CapData,
        ..DEFAULT_TOOL_ENTRY
    },
    ToolEntry {
        name: tool_names::DB_RUN,
        description: "Execute SQL queries and mutations against a database.",
        description_detail: "Run SQL against configured database connections. May require user approval for mutations via tool policy.",
        category: tool_categories::DATA,
        icon_id: "database",
        simulator_app: AppDb,
        app_subtool: SubDb,
        chat_block: CbFallback,
        label_running: "tools.databaseQueryRunning",
        label_done: "tools.databaseQueryDone",
        label_failed: "tools.databaseQueryFailed",
        actions: &[
            action_sub!("query", "Read-only SELECT, WITH, EXPLAIN statements", SubDb, labels: "tools.databaseQueryQueryRunning", "tools.databaseQueryQueryDone", "tools.databaseQueryQueryFailed"),
            action_sub!("execute", "INSERT, UPDATE, DELETE, DDL (blocked on read-only connections)", SubDb, labels: "tools.databaseQueryExecuteRunning", "tools.databaseQueryExecuteDone", "tools.databaseQueryExecuteFailed"),
        ],
        required_capability: CapData,
        ..DEFAULT_TOOL_ENTRY
    },
];
