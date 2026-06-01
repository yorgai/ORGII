//! Tool-call ↔ Cursor MCP translation.
//!
//! Cursor's schema makes tool calls feel native — the server issues
//! [`pb::ExecServerMessage::McpArgs`] mid-stream and expects the client to
//! reply with [`pb::ExecClientMessage::McpResult`] on the same open stream.
//! ORGII's [`LLMProvider`] trait is stateless per turn: we have to report
//! tool calls via `LLMResponse.tool_calls`, let the agent loop execute
//! them, then be called again with the results in the message history.
//!
//! To bridge those models we:
//!
//! 1. When the live Run stream sees tool args, the provider translates them
//!    into an ORGII [`ToolCallRequest`] and returns `finish_reason = "tool_calls"`
//!    while keeping the Cursor stream paused in provider state.
//! 2. On the next provider call, the agent loop has appended the matching
//!    tool result to `messages`; the provider converts that result into the
//!    matching native [`pb::ExecClientMessage`] result and sends it on the
//!    same open stream.
//! 3. Historical replay still encodes completed tool exchanges as Cursor
//!    `ConversationStep::ToolCall` blobs for genuinely new Run requests, but
//!    live post-tool continuation must not be expressed as a new RunRequest.
//!
//! The `google.protobuf.Value` well-known type (via `prost-types`) bridges
//! JSON values for tool args, result payloads, and input schemas. Cursor's MCP
//! schema transports those values as raw protobuf-encoded bytes.

use prost::Message;
use prost_types::value::Kind;
use prost_types::{ListValue, NullValue, Struct, Value};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

use super::proto::agent_v1 as pb;
use crate::providers::traits::ToolCallRequest;
use crate::tools::names as tool_names;
use crate::tools::traits::ToolExecuteResult;

/// Stable provider identifier advertised to Cursor. The server uses this to
/// differentiate ORGII-exposed MCP tools from its own built-ins.
pub(super) const CURSOR_MCP_PROVIDER_IDENTIFIER: &str = "orgii";

fn strip_cursor_mcp_definition_prefix(name: &str) -> Option<String> {
    let double_underscore_prefix = format!("mcp__{CURSOR_MCP_PROVIDER_IDENTIFIER}__");
    if let Some(tool_name) = name.strip_prefix(&double_underscore_prefix) {
        return Some(tool_name.to_string());
    }

    let single_underscore_prefix = format!("mcp_{CURSOR_MCP_PROVIDER_IDENTIFIER}_");
    name.strip_prefix(&single_underscore_prefix)
        .map(ToString::to_string)
}

pub fn resolve_cursor_mcp_tool_name(name: &str, tool_name: &str) -> String {
    if tool_name.is_empty() {
        strip_cursor_mcp_definition_prefix(name).unwrap_or_else(|| name.to_string())
    } else {
        tool_name.to_string()
    }
}

// --------------------------------------------------------------------
// JSON ↔ google.protobuf.Value
// --------------------------------------------------------------------

/// Convert a JSON value into a `google.protobuf.Value` in the canonical way
/// the well-known type demands: null → `NullValue::NullValue`, numbers → `f64`,
/// strings → `String`, bools → `Bool`, arrays → `ListValue`, objects →
/// `Struct`. The result byte-encodes identically to what opencode-cursor's
/// `fromJson(ValueSchema, ...)` produces.
pub fn json_to_pb_value(value: &JsonValue) -> Value {
    let kind = match value {
        JsonValue::Null => Kind::NullValue(NullValue::NullValue as i32),
        JsonValue::Bool(b) => Kind::BoolValue(*b),
        JsonValue::Number(n) => {
            // `Value.number_value` is a double. JSON numbers that don't fit
            // become +∞/-∞, which is strictly worse than emitting 0.0 for
            // integer overflow — we keep f64 and accept the precision cap.
            Kind::NumberValue(n.as_f64().unwrap_or(0.0))
        }
        JsonValue::String(s) => Kind::StringValue(s.clone()),
        JsonValue::Array(items) => Kind::ListValue(ListValue {
            values: items.iter().map(json_to_pb_value).collect(),
        }),
        JsonValue::Object(map) => {
            let mut fields = std::collections::BTreeMap::new();
            for (k, v) in map {
                fields.insert(k.clone(), json_to_pb_value(v));
            }
            Kind::StructValue(Struct {
                fields: fields.into_iter().collect(),
            })
        }
    };
    Value { kind: Some(kind) }
}

/// Inverse of [`json_to_pb_value`]: decode a protobuf Value to a
/// `serde_json::Value`. Used when reading Cursor's structured MCP fields.
pub fn pb_value_to_json(value: &Value) -> JsonValue {
    match &value.kind {
        None | Some(Kind::NullValue(_)) => JsonValue::Null,
        Some(Kind::BoolValue(b)) => JsonValue::Bool(*b),
        Some(Kind::NumberValue(n)) => {
            serde_json::Number::from_f64(*n).map_or(JsonValue::Null, JsonValue::Number)
        }
        Some(Kind::StringValue(s)) => JsonValue::String(s.clone()),
        Some(Kind::ListValue(list)) => {
            JsonValue::Array(list.values.iter().map(pb_value_to_json).collect())
        }
        Some(Kind::StructValue(s)) => {
            let mut map = serde_json::Map::new();
            for (k, v) in &s.fields {
                map.insert(k.clone(), pb_value_to_json(v));
            }
            JsonValue::Object(map)
        }
    }
}

/// Encode a JSON value as protobuf-Value bytes for legacy/result payloads that
/// still travel as raw bytes in Cursor's schema.
pub fn encode_json_as_pb_value_bytes(value: &JsonValue) -> Vec<u8> {
    let pb_value = json_to_pb_value(value);
    let mut buf = Vec::with_capacity(pb_value.encoded_len());
    pb_value.encode(&mut buf).expect("encode pb Value");
    buf
}

/// Decode a protobuf Value bytes field to JSON. Kept as a regression helper
/// for legacy raw-byte Cursor payloads captured in older fixtures.
fn decode_pb_value_bytes(bytes: &[u8]) -> JsonValue {
    match Value::decode(bytes) {
        Ok(v) => pb_value_to_json(&v),
        Err(_) => {
            // Older server versions sometimes ship raw JSON strings rather
            // than protobuf-encoded values. Fall through to a best-effort
            // UTF-8 decode + JSON parse; fail open to string.
            if let Ok(s) = std::str::from_utf8(bytes) {
                if let Ok(v) = serde_json::from_str::<JsonValue>(s) {
                    return v;
                }
                return JsonValue::String(s.to_string());
            }
            JsonValue::Null
        }
    }
}

// --------------------------------------------------------------------
// Tool definitions (orgii → McpToolDefinition)
// --------------------------------------------------------------------

fn cursor_mcp_input_schema(_name: &str, parameters: JsonValue) -> JsonValue {
    parameters
}

/// Convert ORGII's OpenAI-shape tool list to Cursor's `McpToolDefinition`
/// vector. Skips non-function entries; orgii only uses `type: "function"`.
pub fn build_tool_definitions(tools: &[JsonValue]) -> Vec<pb::McpToolDefinition> {
    tools
        .iter()
        .filter_map(|tool| {
            let function = tool.get("function")?;
            let name = function.get("name")?.as_str()?.to_string();
            let description = function
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parameters = function.get("parameters").cloned().unwrap_or_else(
                || serde_json::json!({ "type": "object", "properties": {}, "required": [] }),
            );
            let input_schema = cursor_mcp_input_schema(&name, parameters);
            Some(pb::McpToolDefinition {
                name: name.clone(),
                description,
                provider_identifier: CURSOR_MCP_PROVIDER_IDENTIFIER.to_string(),
                tool_name: name,
                input_schema: encode_json_as_pb_value_bytes(&input_schema),
            })
        })
        .collect()
}

// --------------------------------------------------------------------
// McpArgs → orgii ToolCallRequest
// --------------------------------------------------------------------

/// Translate an incoming `ExecServerMessage::McpArgs` into an ORGII
/// [`ToolCallRequest`]. Decodes each protobuf-Value byte payload into JSON so
/// downstream consumers can treat Cursor tool calls the same way they treat
/// OpenAI function calls.
pub fn mcp_args_to_tool_call(args: &pb::McpArgs) -> ToolCallRequest {
    let mut argument_map = serde_json::Map::new();
    for (key, value) in &args.args {
        argument_map.insert(key.clone(), decode_pb_value_bytes(value));
    }
    let tool_name = resolve_cursor_mcp_tool_name(&args.name, &args.tool_name);
    ToolCallRequest {
        id: if args.tool_call_id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            args.tool_call_id.clone()
        },
        name: tool_name,
        arguments: JsonValue::Object(argument_map),
        thought_signature: None,
    }
}

// --------------------------------------------------------------------
// History replay: ORGII tool messages → Cursor ConversationStep::ToolCall
// --------------------------------------------------------------------

/// Historical tool exchange as it appears in a replayed turn: one tool call
/// the assistant made, plus the text result orgii produced.
#[derive(Debug, Clone)]
pub struct HistoricToolCall {
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: JsonValue,
    pub result_text: String,
}

/// Encode a past tool call as a `ConversationStep::ToolCall` byte blob.
pub fn encode_tool_call_step(call: &HistoricToolCall) -> Vec<u8> {
    let tool_call = encode_historic_tool_call(call);

    let step = pb::ConversationStep {
        message: Some(pb::conversation_step::Message::ToolCall(tool_call)),
    };

    let mut buf = Vec::with_capacity(step.encoded_len());
    step.encode(&mut buf).expect("encode tool-call step");
    buf
}

pub fn historic_tool_call_from_result(
    tool_call_id: &str,
    tool_name: &str,
    arguments: JsonValue,
    result: Result<&ToolExecuteResult, &str>,
) -> HistoricToolCall {
    let result_text = match result {
        Ok(output) => output.text.clone(),
        Err(error) => format!("Error: {error}"),
    };
    HistoricToolCall {
        tool_call_id: tool_call_id.to_string(),
        tool_name: tool_name.to_string(),
        arguments,
        result_text,
    }
}

pub fn encode_historic_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    match call.tool_name.as_str() {
        tool_names::LIST_DIR => encode_ls_tool_call(call),
        tool_names::READ_FILE => encode_read_tool_call(call),
        tool_names::CODE_SEARCH => encode_grep_tool_call(call),
        tool_names::RUN_SHELL => encode_shell_tool_call(call),
        tool_names::EDIT_FILE => encode_write_tool_call(call),
        tool_names::DELETE_FILE => encode_delete_tool_call(call),
        tool_names::AGENT => encode_task_tool_call(call),
        _ => encode_mcp_tool_call(call),
    }
}

pub fn encode_mcp_exec_tool_result_message(
    call: &HistoricToolCall,
) -> pb::exec_client_message::Message {
    pb::exec_client_message::Message::McpResult(mcp_result_from_call(call))
}

pub fn encode_exec_tool_result_message(
    call: &HistoricToolCall,
) -> pb::exec_client_message::Message {
    match call.tool_name.as_str() {
        tool_names::LIST_DIR => {
            pb::exec_client_message::Message::LsResult(ls_result_from_call(call))
        }
        tool_names::READ_FILE => {
            pb::exec_client_message::Message::ReadResult(read_result_from_call(call))
        }
        tool_names::CODE_SEARCH => {
            pb::exec_client_message::Message::GrepResult(grep_result_from_call(call))
        }
        tool_names::RUN_SHELL => {
            pb::exec_client_message::Message::ShellResult(shell_result_from_call(call))
        }
        tool_names::EDIT_FILE => {
            pb::exec_client_message::Message::WriteResult(write_result_from_call(call))
        }
        tool_names::DELETE_FILE => {
            pb::exec_client_message::Message::DeleteResult(delete_result_from_call(call))
        }
        _ => pb::exec_client_message::Message::McpResult(mcp_result_from_call(call)),
    }
}

fn encode_task_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let args = pb::TaskArgs {
        description: arg_string(&call.arguments, "description"),
        prompt: arg_string(&call.arguments, "prompt"),
        subagent_type: None,
        model: optional_arg_string(&call.arguments, "model"),
        resume: optional_arg_string(&call.arguments, "resume_session_id"),
    };
    let result = pb::TaskResult {
        result: Some(pb::task_result::Result::Success(pb::TaskSuccess {
            conversation_steps: vec![pb::ConversationStep {
                message: Some(pb::conversation_step::Message::AssistantMessage(
                    pb::AssistantMessage {
                        text: call.result_text.clone(),
                    },
                )),
            }],
            agent_id: optional_arg_string(&call.arguments, "agent_id"),
            is_background: call
                .arguments
                .get("background")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false),
            duration_ms: None,
        })),
    };
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::TaskToolCall(pb::TaskToolCall {
            args: Some(args),
            result: Some(result),
        })),
    }
}

fn encode_mcp_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let mut args_map: HashMap<String, Vec<u8>> = HashMap::new();
    if let JsonValue::Object(obj) = &call.arguments {
        for (key, value) in obj {
            args_map.insert(key.clone(), encode_json_as_pb_value_bytes(value));
        }
    }
    let mcp_args = pb::McpArgs {
        name: call.tool_name.clone(),
        args: args_map,
        tool_call_id: call.tool_call_id.clone(),
        provider_identifier: CURSOR_MCP_PROVIDER_IDENTIFIER.to_string(),
        tool_name: call.tool_name.clone(),
    };
    let mcp_result = pb::McpToolResult {
        result: Some(pb::mcp_tool_result::Result::Success(pb::McpSuccess {
            content: vec![pb::McpToolResultContentItem {
                content: Some(pb::mcp_tool_result_content_item::Content::Text(
                    pb::McpTextContent {
                        text: call.result_text.clone(),
                        output_location: None,
                    },
                )),
            }],
            is_error: false,
        })),
    };
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::McpToolCall(pb::McpToolCall {
            args: Some(mcp_args),
            result: Some(mcp_result),
        })),
    }
}

fn arg_string(arguments: &JsonValue, key: &str) -> String {
    arguments
        .get(key)
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional_arg_string(arguments: &JsonValue, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn mcp_result_from_call(call: &HistoricToolCall) -> pb::McpResult {
    pb::McpResult {
        result: Some(pb::mcp_result::Result::Success(pb::McpSuccess {
            content: vec![pb::McpToolResultContentItem {
                content: Some(pb::mcp_tool_result_content_item::Content::Text(
                    pb::McpTextContent {
                        text: call.result_text.clone(),
                        output_location: None,
                    },
                )),
            }],
            is_error: false,
        })),
    }
}

fn ls_result_from_call(call: &HistoricToolCall) -> pb::LsResult {
    let path = arg_string(&call.arguments, "path");
    let mut children_dirs = Vec::new();
    let mut children_files = Vec::new();
    for line in call.result_text.lines() {
        if let Some(name) = line.strip_prefix("[dir] ") {
            children_dirs.push(pb::LsDirectoryTreeNode {
                abs_path: name.to_string(),
                children_were_processed: false,
                ..Default::default()
            });
        } else if let Some(name) = line.strip_prefix("[file] ") {
            children_files.push(pb::LsDirectoryTreeNodeFile {
                name: name.to_string(),
                terminal_metadata: None,
            });
        }
    }
    let num_files = children_files.len() as i32;
    pb::LsResult {
        result: Some(pb::ls_result::Result::Success(pb::LsSuccess {
            directory_tree_root: Some(pb::LsDirectoryTreeNode {
                abs_path: path,
                children_dirs,
                children_files,
                children_were_processed: true,
                num_files,
                ..Default::default()
            }),
        })),
    }
}

fn encode_ls_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let path = arg_string(&call.arguments, "path");
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::LsToolCall(pb::LsToolCall {
            args: Some(pb::LsArgs {
                path,
                tool_call_id: call.tool_call_id.clone(),
                ..Default::default()
            }),
            result: Some(ls_result_from_call(call)),
        })),
    }
}

fn read_result_from_call(call: &HistoricToolCall) -> pb::ReadResult {
    let path = arg_string(&call.arguments, "path");
    pb::ReadResult {
        result: Some(pb::read_result::Result::Success(pb::ReadSuccess {
            path,
            total_lines: call.result_text.lines().count() as i32,
            file_size: call.result_text.len() as i64,
            truncated: false,
            output_blob_id: None,
            output: Some(pb::read_success::Output::Content(call.result_text.clone())),
        })),
    }
}

fn encode_read_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let path = arg_string(&call.arguments, "path");
    let total_lines = call.result_text.lines().count() as u32;
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::ReadToolCall(pb::ReadToolCall {
            args: Some(pb::ReadToolArgs {
                path,
                offset: None,
                limit: None,
            }),
            result: Some(pb::ReadToolResult {
                result: Some(pb::read_tool_result::Result::Success(pb::ReadToolSuccess {
                    is_empty: call.result_text.is_empty(),
                    exceeded_limit: false,
                    total_lines,
                    file_size: call.result_text.len() as u32,
                    path: arg_string(&call.arguments, "path"),
                    read_range: Some(pb::ReadRange {
                        start_line: 1,
                        end_line: total_lines.max(1),
                    }),
                    output: Some(pb::read_tool_success::Output::Content(
                        call.result_text.clone(),
                    )),
                })),
            }),
        })),
    }
}

fn shell_result_from_call(call: &HistoricToolCall) -> pb::ShellResult {
    let command = arg_string(&call.arguments, "command");
    let working_directory = arg_string(&call.arguments, "working_dir");
    pb::ShellResult {
        result: Some(pb::shell_result::Result::Success(pb::ShellSuccess {
            command,
            working_directory,
            exit_code: 0,
            stdout: call.result_text.clone(),
            ..Default::default()
        })),
        ..Default::default()
    }
}

fn encode_shell_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let command = arg_string(&call.arguments, "command");
    let working_directory = arg_string(&call.arguments, "working_dir");
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::ShellToolCall(pb::ShellToolCall {
            args: Some(pb::ShellArgs {
                command,
                working_directory,
                tool_call_id: call.tool_call_id.clone(),
                ..Default::default()
            }),
            result: Some(shell_result_from_call(call)),
        })),
    }
}

fn write_result_from_call(call: &HistoricToolCall) -> pb::WriteResult {
    let path = arg_string(&call.arguments, "file_path");
    let content = arg_string(&call.arguments, "content");
    pb::WriteResult {
        result: Some(pb::write_result::Result::Success(pb::WriteSuccess {
            path,
            lines_created: content.lines().count() as i32,
            file_size: content.len() as i32,
            file_content_after_write: Some(content),
        })),
    }
}

fn encode_write_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let path = arg_string(&call.arguments, "file_path");
    let content = arg_string(&call.arguments, "content");
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::EditToolCall(pb::EditToolCall {
            args: Some(pb::EditArgs {
                path,
                stream_content: Some(content),
            }),
            result: Some(pb::EditResult::default()),
        })),
    }
}

fn delete_result_from_call(call: &HistoricToolCall) -> pb::DeleteResult {
    let path = arg_string(&call.arguments, "path");
    let deleted_file = std::path::Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    pb::DeleteResult {
        result: Some(pb::delete_result::Result::Success(pb::DeleteSuccess {
            path,
            deleted_file,
            file_size: 0,
            prev_content: String::new(),
        })),
    }
}

fn encode_delete_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let path = arg_string(&call.arguments, "path");
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::DeleteToolCall(pb::DeleteToolCall {
            args: Some(pb::DeleteArgs {
                path,
                tool_call_id: call.tool_call_id.clone(),
            }),
            result: Some(delete_result_from_call(call)),
        })),
    }
}

fn grep_result_from_call(call: &HistoricToolCall) -> pb::GrepResult {
    let action = arg_string(&call.arguments, "action");
    let pattern = arg_string(&call.arguments, "pattern");
    let path = arg_string(&call.arguments, "repo_path");
    let output_mode = if action == "glob" { "files" } else { "content" };
    let union_result = if action == "glob" {
        grep_files_union_result(&call.result_text)
    } else {
        grep_content_union_result(&call.result_text)
    };
    let (workspace_results, active_editor_result) =
        grep_workspace_result(path.as_str(), union_result);
    pb::GrepResult {
        result: Some(pb::grep_result::Result::Success(pb::GrepSuccess {
            pattern,
            path,
            output_mode: output_mode.to_string(),
            workspace_results,
            active_editor_result,
        })),
    }
}

fn encode_grep_tool_call(call: &HistoricToolCall) -> pb::ToolCall {
    let pattern = arg_string(&call.arguments, "pattern");
    let path = arg_string(&call.arguments, "repo_path");
    let glob = call
        .arguments
        .get("glob")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string);
    let output_mode = if arg_string(&call.arguments, "action") == "glob" {
        "files"
    } else {
        "content"
    };

    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::GrepToolCall(pb::GrepToolCall {
            args: Some(pb::GrepArgs {
                pattern,
                path: (!path.is_empty()).then_some(path),
                glob,
                output_mode: Some(output_mode.to_string()),
                tool_call_id: call.tool_call_id.clone(),
                ..Default::default()
            }),
            result: Some(grep_result_from_call(call)),
        })),
    }
}

fn grep_workspace_result(
    path: &str,
    union_result: pb::GrepUnionResult,
) -> (
    HashMap<String, pb::GrepUnionResult>,
    Option<pb::GrepUnionResult>,
) {
    if path.is_empty() {
        return (HashMap::new(), Some(union_result));
    }

    let mut workspace_results = HashMap::new();
    workspace_results.insert(path.to_string(), union_result);
    (workspace_results, None)
}

fn grep_files_union_result(result_text: &str) -> pb::GrepUnionResult {
    let files = result_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| *line != "No files matched." && *line != "No files found.")
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    pb::GrepUnionResult {
        result: Some(pb::grep_union_result::Result::Files(pb::GrepFilesResult {
            total_files: files.len() as i32,
            files,
            client_truncated: false,
            ripgrep_truncated: false,
        })),
    }
}

fn grep_content_union_result(result_text: &str) -> pb::GrepUnionResult {
    let matches = parse_grep_content_matches(result_text);
    let total_lines = matches
        .iter()
        .map(|file_match| file_match.matches.len() as i32)
        .sum();
    pb::GrepUnionResult {
        result: Some(pb::grep_union_result::Result::Content(
            pb::GrepContentResult {
                matches,
                total_lines,
                total_matched_lines: total_lines,
                client_truncated: false,
                ripgrep_truncated: false,
            },
        )),
    }
}

fn parse_grep_content_matches(result_text: &str) -> Vec<pb::GrepFileMatch> {
    let mut by_file: HashMap<String, Vec<pb::GrepContentMatch>> = HashMap::new();
    for line in result_text.lines() {
        if line == "--" || line == "No matches found." {
            continue;
        }
        let Some((file, line_number, content, is_context_line)) = parse_grep_output_line(line)
        else {
            continue;
        };
        by_file.entry(file).or_default().push(pb::GrepContentMatch {
            line_number,
            content,
            content_truncated: false,
            is_context_line,
        });
    }

    by_file
        .into_iter()
        .map(|(file, matches)| pb::GrepFileMatch { file, matches })
        .collect()
}

fn parse_grep_output_line(line: &str) -> Option<(String, i32, String, bool)> {
    let colon = parse_grep_output_line_with_separator(line, ':');
    if colon.is_some() {
        return colon;
    }
    parse_grep_output_line_with_separator(line, '-')
}

fn parse_grep_output_line_with_separator(
    line: &str,
    separator: char,
) -> Option<(String, i32, String, bool)> {
    for (start, current) in line.char_indices() {
        if current != separator {
            continue;
        }
        let digits_start = start + separator.len_utf8();
        let digits = line[digits_start..]
            .chars()
            .take_while(|value| value.is_ascii_digit())
            .collect::<String>();
        if digits.is_empty() {
            continue;
        }
        let digits_end = digits_start + digits.len();
        if !line[digits_end..].starts_with(separator) {
            continue;
        }
        let content_start = digits_end + separator.len_utf8();
        return Some((
            line[..start].to_string(),
            digits.parse::<i32>().ok()?,
            line[content_start..].to_string(),
            separator == '-',
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Value round-trips preserve all JSON primitive and container kinds.
    ///
    /// Integers become floats across the round-trip because
    /// `google.protobuf.Value.number_value` is a `double` with no integer
    /// variant — this is lossy by design, matching opencode-cursor's
    /// behaviour. Test that the structure + primitive shapes survive; the
    /// number-type widening is acceptable.
    #[test]
    fn json_protobuf_value_round_trip() {
        let original = json!({
            "name": "search",
            "limit": 10.0,
            "active": true,
            "tags": ["a", "b"],
            "meta": { "nested": null },
        });
        let bytes = encode_json_as_pb_value_bytes(&original);
        let decoded = decode_pb_value_bytes(&bytes);
        assert_eq!(decoded, original);
    }

    /// Explicit documentation of the integer-widening behaviour: a JSON
    /// integer is encodable and decodable but comes out as a float. This
    /// matters for tool-argument schemas that have `"type": "integer"` —
    /// downstream consumers must re-coerce.
    #[test]
    fn json_integer_widens_to_float_via_protobuf_value() {
        let int_value = json!(42);
        let bytes = encode_json_as_pb_value_bytes(&int_value);
        let decoded = decode_pb_value_bytes(&bytes);
        let n = decoded.as_f64().unwrap();
        assert_eq!(n, 42.0);
        assert!(!decoded.is_i64(), "round-trip loses integer tag");
    }

    /// Arg value bytes that happen to be raw JSON (older server format) still
    /// decode sanely rather than returning Null.
    #[test]
    fn decode_falls_back_to_raw_json_bytes() {
        let raw = br#"{"q":"hi"}"#;
        let decoded = decode_pb_value_bytes(raw);
        assert_eq!(decoded, json!({ "q": "hi" }));
    }

    /// Tool definition conversion: OpenAI shape → McpToolDefinition with
    /// name, description, provider, and schema bytes.
    #[test]
    fn build_tool_definitions_copies_fields() {
        let tools = vec![json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "search the web",
                "parameters": {
                    "type": "object",
                    "properties": { "query": { "type": "string" } },
                    "required": ["query"],
                },
            }
        })];
        let defs = build_tool_definitions(&tools);
        assert_eq!(defs.len(), 1);
        let d = &defs[0];
        assert_eq!(d.name, "web_search");
        assert_eq!(d.tool_name, "web_search");
        assert_eq!(d.provider_identifier, CURSOR_MCP_PROVIDER_IDENTIFIER);
        assert_eq!(d.description, "search the web");

        let decoded = decode_pb_value_bytes(&d.input_schema);
        assert_eq!(decoded["type"], "object");
        assert_eq!(decoded["required"], json!(["query"]));
    }

    #[test]
    fn build_tool_definitions_preserves_org_send_message_dynamic_schema_for_cursor() {
        let tools = vec![json!({
            "type": "function",
            "function": {
                "name": tool_names::ORG_SEND_MESSAGE,
                "description": "Send a typed message to another Agent",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recipient_member_id": {
                            "type": "string",
                            "enum": ["coordinator", "planner"]
                        },
                        "kind": {
                            "type": "string",
                            "enum": ["plain", "shutdown_response"]
                        },
                        "summary": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                        "text": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
                    },
                    "required": ["recipient_member_id", "kind"]
                }
            }
        })];

        let defs = build_tool_definitions(&tools);
        let decoded = decode_pb_value_bytes(&defs[0].input_schema);

        assert_eq!(decoded["required"], json!(["recipient_member_id", "kind"]));
        assert_eq!(
            decoded["properties"]["recipient_member_id"]["enum"],
            json!(["coordinator", "planner"])
        );
        assert_eq!(
            decoded["properties"]["kind"]["enum"],
            json!(["plain", "shutdown_response"])
        );
        assert!(decoded["properties"].get("recipient_agent_id").is_none());
        assert!(decoded["properties"].get("recipient_name").is_none());
    }

    /// Missing description defaults to "", missing parameters defaults to an
    /// empty object schema so the server-side model invocation still works.
    #[test]
    fn build_tool_definitions_uses_safe_defaults() {
        let tools = vec![json!({
            "type": "function",
            "function": { "name": "minimal" }
        })];
        let defs = build_tool_definitions(&tools);
        assert_eq!(defs[0].description, "");
        let decoded = decode_pb_value_bytes(&defs[0].input_schema);
        assert_eq!(decoded["type"], "object");
    }

    /// Non-function tools (future `type: "retrieval"` etc.) are silently
    /// dropped — `filter_map` makes forward-compat additions painless.
    #[test]
    fn build_tool_definitions_skips_non_function_kinds() {
        let tools = vec![json!({"type": "retrieval"})];
        assert!(build_tool_definitions(&tools).is_empty());
    }

    /// McpArgs with a populated tool_call_id comes through verbatim; missing
    /// tool_call_id gets a fresh UUID so orgii can match results.
    #[test]
    fn mcp_args_populates_tool_call_request() {
        let mut args_map = HashMap::new();
        args_map.insert(
            "query".to_string(),
            encode_json_as_pb_value_bytes(&json!("cats")),
        );
        let mcp = pb::McpArgs {
            name: "web_search".to_string(),
            args: args_map,
            tool_call_id: "call_abc".to_string(),
            provider_identifier: CURSOR_MCP_PROVIDER_IDENTIFIER.to_string(),
            tool_name: "web_search".to_string(),
        };
        let tcr = mcp_args_to_tool_call(&mcp);
        assert_eq!(tcr.id, "call_abc");
        assert_eq!(tcr.name, "web_search");
        assert_eq!(tcr.arguments["query"], "cats");
    }

    #[test]
    fn mcp_args_with_missing_call_id_generates_uuid() {
        let mcp = pb::McpArgs {
            name: "x".to_string(),
            args: HashMap::new(),
            tool_call_id: String::new(),
            provider_identifier: String::new(),
            tool_name: "x".to_string(),
        };
        let tcr = mcp_args_to_tool_call(&mcp);
        assert!(!tcr.id.is_empty(), "fresh UUID generated");
        assert_eq!(tcr.id.len(), 36, "UUID v4 canonical form");
    }

    #[test]
    fn mcp_args_strips_cursor_visible_name_when_tool_name_missing() {
        for visible_name in ["mcp__orgii__org_send_message", "mcp_orgii_org_send_message"] {
            let mcp = pb::McpArgs {
                name: visible_name.to_string(),
                args: HashMap::new(),
                tool_call_id: "call_prefixed".to_string(),
                provider_identifier: CURSOR_MCP_PROVIDER_IDENTIFIER.to_string(),
                tool_name: String::new(),
            };
            let tcr = mcp_args_to_tool_call(&mcp);
            assert_eq!(tcr.name, "org_send_message");
        }
    }

    #[test]
    fn mcp_args_keeps_cursor_native_switch_mode_name() {
        let mcp = pb::McpArgs {
            name: "SwitchMode".to_string(),
            args: HashMap::new(),
            tool_call_id: "call_switch".to_string(),
            provider_identifier: String::new(),
            tool_name: String::new(),
        };
        let tcr = mcp_args_to_tool_call(&mcp);
        assert_eq!(tcr.name, "SwitchMode");
    }

    /// Encoding a historical tool call and decoding it back must round-trip
    /// the args JSON and result text unchanged — otherwise Cursor's
    /// conversation-state replay diverges.
    #[test]
    fn native_tool_call_steps_encode_native_variants() {
        let calls = [
            (
                tool_names::RUN_SHELL,
                json!({ "command": "pwd", "working_dir": "/tmp" }),
            ),
            (
                tool_names::EDIT_FILE,
                json!({ "file_path": "a.txt", "content": "hello" }),
            ),
            (tool_names::DELETE_FILE, json!({ "path": "a.txt" })),
            (
                tool_names::AGENT,
                json!({
                    "agent_id": "builtin:explore",
                    "prompt": "inspect marker",
                    "description": "Explore marker",
                    "background": false,
                }),
            ),
        ];

        for (tool_name, arguments) in calls {
            let call = HistoricToolCall {
                tool_call_id: "call_native".to_string(),
                tool_name: tool_name.to_string(),
                arguments,
                result_text: "ok".to_string(),
            };
            let encoded = encode_tool_call_step(&call);
            let step = pb::ConversationStep::decode(encoded.as_slice()).unwrap();
            let tool_call = match step.message.unwrap() {
                pb::conversation_step::Message::ToolCall(tool_call) => tool_call,
                _ => panic!("expected ToolCall step"),
            };

            match (tool_name, tool_call.tool.unwrap()) {
                (tool_names::RUN_SHELL, pb::tool_call::Tool::ShellToolCall(_)) => {}
                (tool_names::EDIT_FILE, pb::tool_call::Tool::EditToolCall(_)) => {}
                (tool_names::DELETE_FILE, pb::tool_call::Tool::DeleteToolCall(_)) => {}
                (tool_names::AGENT, pb::tool_call::Tool::TaskToolCall(task)) => {
                    let result = task.result.unwrap();
                    let success = match result.result.unwrap() {
                        pb::task_result::Result::Success(success) => success,
                        _ => panic!("expected task success"),
                    };
                    assert_eq!(success.agent_id.as_deref(), Some("builtin:explore"));
                    assert_eq!(success.conversation_steps.len(), 1);
                }
                (_, other) => panic!("unexpected native replay variant: {other:?}"),
            }
        }
    }

    #[test]
    fn glob_search_history_replays_as_grep_files_result() {
        let call = HistoricToolCall {
            tool_call_id: "call_glob".to_string(),
            tool_name: tool_names::CODE_SEARCH.to_string(),
            arguments: json!({
                "action": "glob",
                "pattern": "**/*",
                "repo_path": "/tmp/project",
                "glob": "**/*",
            }),
            result_text: "Cargo.toml\nREADME.md".to_string(),
        };
        let encoded = encode_tool_call_step(&call);
        let step = pb::ConversationStep::decode(encoded.as_slice()).unwrap();
        let tool_call = match step.message.unwrap() {
            pb::conversation_step::Message::ToolCall(tool_call) => tool_call,
            _ => panic!("expected ToolCall step"),
        };
        let grep = match tool_call.tool.unwrap() {
            pb::tool_call::Tool::GrepToolCall(grep) => grep,
            other => panic!("expected GrepToolCall, got {other:?}"),
        };
        let result = grep.result.unwrap();
        let success = match result.result.unwrap() {
            pb::grep_result::Result::Success(success) => success,
            _ => panic!("expected grep success"),
        };
        assert_eq!(success.output_mode, "files");
        assert!(success.active_editor_result.is_none());
        let workspace_result = success.workspace_results.get("/tmp/project").unwrap();
        let files = match workspace_result.result.as_ref().unwrap() {
            pb::grep_union_result::Result::Files(files) => files,
            other => panic!("expected files result, got {other:?}"),
        };
        assert_eq!(files.files, vec!["Cargo.toml", "README.md"]);
        assert_eq!(files.total_files, 2);
    }

    #[test]
    fn grep_search_history_replays_as_grouped_content_result() {
        let call = HistoricToolCall {
            tool_call_id: "call_grep".to_string(),
            tool_name: tool_names::CODE_SEARCH.to_string(),
            arguments: json!({
                "action": "grep",
                "pattern": "fn main",
                "repo_path": "/tmp/project",
            }),
            result_text:
                "/tmp/project/src/main.rs:3:fn main() {\n/tmp/project/src/lib.rs-4-// context"
                    .to_string(),
        };
        let encoded = encode_tool_call_step(&call);
        let step = pb::ConversationStep::decode(encoded.as_slice()).unwrap();
        let tool_call = match step.message.unwrap() {
            pb::conversation_step::Message::ToolCall(tool_call) => tool_call,
            _ => panic!("expected ToolCall step"),
        };
        let grep = match tool_call.tool.unwrap() {
            pb::tool_call::Tool::GrepToolCall(grep) => grep,
            other => panic!("expected GrepToolCall, got {other:?}"),
        };
        let success = match grep.result.unwrap().result.unwrap() {
            pb::grep_result::Result::Success(success) => success,
            _ => panic!("expected grep success"),
        };
        assert_eq!(success.output_mode, "content");
        let workspace_result = success.workspace_results.get("/tmp/project").unwrap();
        let content = match workspace_result.result.as_ref().unwrap() {
            pb::grep_union_result::Result::Content(content) => content,
            other => panic!("expected content result, got {other:?}"),
        };
        assert_eq!(content.total_lines, 2);
        assert_eq!(content.matches.len(), 2);
        assert!(content
            .matches
            .iter()
            .any(|file_match| file_match.file == "/tmp/project/src/main.rs"));
        assert!(content
            .matches
            .iter()
            .flat_map(|file_match| file_match.matches.iter())
            .any(|content_match| content_match.is_context_line));
    }

    #[test]
    fn historic_tool_call_step_round_trips() {
        let call = HistoricToolCall {
            tool_call_id: "call_1".to_string(),
            tool_name: "web_search".to_string(),
            arguments: json!({ "query": "rust protobuf" }),
            result_text: "found 3 results".to_string(),
        };
        let encoded = encode_tool_call_step(&call);

        let step = pb::ConversationStep::decode(encoded.as_slice()).unwrap();
        let tool_call = match step.message.unwrap() {
            pb::conversation_step::Message::ToolCall(tc) => tc,
            _ => panic!("expected ToolCall step"),
        };
        let mcp_tool_call = match tool_call.tool.unwrap() {
            pb::tool_call::Tool::McpToolCall(m) => m,
            _ => panic!("expected McpToolCall"),
        };

        let args = mcp_tool_call.args.unwrap();
        assert_eq!(args.tool_call_id, "call_1");
        assert_eq!(args.tool_name, "web_search");
        let query_value = args.args.get("query").unwrap();
        assert_eq!(decode_pb_value_bytes(query_value), json!("rust protobuf"));

        let result_text = match mcp_tool_call.result.unwrap().result.unwrap() {
            pb::mcp_tool_result::Result::Success(success) => {
                let first = success.content.first().unwrap().content.as_ref().unwrap();
                match first {
                    pb::mcp_tool_result_content_item::Content::Text(text) => text.text.clone(),
                    _ => panic!("expected text content"),
                }
            }
            _ => panic!("expected success result"),
        };
        assert_eq!(result_text, "found 3 results");
    }
}
