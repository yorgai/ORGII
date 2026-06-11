//! Exec side-channel bridge.
//!
//! Handles `ExecServerMessage` packets: maps supported Cursor native tool
//! invocations to ORGII `ToolCallRequest` values, rejects unsupported probes
//! with appropriate error responses, and answers in-band side-channel queries
//! (e.g. `RequestContextArgs`).

use tracing::info;

use super::super::client::{ClientError, RunStream};
use super::helpers::{
    build_request_context, cursor_mcp_tool_name_from_args, describe_workspace_context,
    exec_message_variant_name,
};
use super::super::proto::agent_v1 as pb;
use super::super::tools::{mcp_args_to_tool_call, CURSOR_MCP_PROVIDER_IDENTIFIER};
use super::super::CursorNativeWorkspaceContext;
use crate::providers::traits::ToolCallRequest;
use crate::tools::names as tool_names;

pub(super) const MCP_NATIVE_FALLBACK_REJECTION: &str =
    "Cursor native tools are not available in this environment. Use MCP tools from provider `orgii` instead.";

/// Opaque pause descriptor returned when `handle_exec_server_message` asks
/// ORGII to execute a tool and feed the result back on the same stream.
pub(super) struct ExecToolPause {
    pub(super) exec_id: String,
    pub(super) exec_message_id: u32,
    pub(super) tool_call: ToolCallRequest,
    pub(super) requires_same_stream_result: bool,
    pub(super) result_kind: ToolResultKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ToolResultKind {
    Mcp,
    Native,
}

pub(super) fn tool_definitions_enable_mcp_native_rejection(
    tool_definitions: &[pb::McpToolDefinition],
) -> bool {
    !tool_definitions.is_empty()
}

pub(super) fn shell_native_rejection(args: &pb::ShellArgs) -> pb::ShellResult {
    pb::ShellResult {
        result: Some(pb::shell_result::Result::Rejected(pb::ShellRejected {
            command: args.command.clone(),
            working_directory: args.working_directory.clone(),
            reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
            is_readonly: false,
        })),
        ..Default::default()
    }
}

pub(super) fn is_orgii_mcp_args(args: &pb::McpArgs) -> bool {
    args.provider_identifier == CURSOR_MCP_PROVIDER_IDENTIFIER
        || args.name.starts_with("mcp__orgii__")
        || args.name.starts_with("mcp_orgii_")
}

pub(super) fn mcp_fallback_rejection_result() -> pb::exec_client_message::Message {
    pb::exec_client_message::Message::McpResult(pb::McpResult {
        result: Some(pb::mcp_result::Result::Success(pb::McpSuccess {
            content: vec![pb::McpToolResultContentItem {
                content: Some(pb::mcp_tool_result_content_item::Content::Text(
                    pb::McpTextContent {
                        text: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                        output_location: None,
                    },
                )),
            }],
            is_error: true,
        })),
    })
}

pub(super) fn mcp_native_fallback_result(
    inner: &pb::exec_server_message::Message,
    tool_definitions: &[pb::McpToolDefinition],
) -> Option<pb::exec_client_message::Message> {
    if !tool_definitions_enable_mcp_native_rejection(tool_definitions) {
        return None;
    }

    match inner {
        pb::exec_server_message::Message::McpArgs(args) if !is_orgii_mcp_args(args) => {
            Some(mcp_fallback_rejection_result())
        }
        pb::exec_server_message::Message::ReadArgs(args) => Some(
            pb::exec_client_message::Message::ReadResult(pb::ReadResult {
                result: Some(pb::read_result::Result::Rejected(pb::ReadRejected {
                    path: args.path.clone(),
                    reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }),
        ),
        pb::exec_server_message::Message::LsArgs(args) => {
            Some(pb::exec_client_message::Message::LsResult(pb::LsResult {
                result: Some(pb::ls_result::Result::Rejected(pb::LsRejected {
                    path: args.path.clone(),
                    reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }))
        }
        pb::exec_server_message::Message::GrepArgs(_) => Some(
            pb::exec_client_message::Message::GrepResult(pb::GrepResult {
                result: Some(pb::grep_result::Result::Error(pb::GrepError {
                    error: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }),
        ),
        pb::exec_server_message::Message::WriteArgs(args) => Some(
            pb::exec_client_message::Message::WriteResult(pb::WriteResult {
                result: Some(pb::write_result::Result::Rejected(pb::WriteRejected {
                    path: args.path.clone(),
                    reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }),
        ),
        pb::exec_server_message::Message::DeleteArgs(args) => Some(
            pb::exec_client_message::Message::DeleteResult(pb::DeleteResult {
                result: Some(pb::delete_result::Result::Rejected(pb::DeleteRejected {
                    path: args.path.clone(),
                    reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }),
        ),
        pb::exec_server_message::Message::ShellArgs(args)
        | pb::exec_server_message::Message::ShellStreamArgs(args) => Some(
            pb::exec_client_message::Message::ShellResult(shell_native_rejection(args)),
        ),
        pb::exec_server_message::Message::BackgroundShellSpawnArgs(args) => Some(
            pb::exec_client_message::Message::BackgroundShellSpawnResult(
                pb::BackgroundShellSpawnResult {
                    result: Some(pb::background_shell_spawn_result::Result::Rejected(
                        pb::ShellRejected {
                            command: args.command.clone(),
                            working_directory: args.working_directory.clone(),
                            reason: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                            is_readonly: false,
                        },
                    )),
                },
            ),
        ),
        pb::exec_server_message::Message::WriteShellStdinArgs(_) => Some(
            pb::exec_client_message::Message::WriteShellStdinResult(pb::WriteShellStdinResult {
                result: Some(pb::write_shell_stdin_result::Result::Error(
                    pb::WriteShellStdinError {
                        error: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                    },
                )),
            }),
        ),
        pb::exec_server_message::Message::FetchArgs(args) => Some(
            pb::exec_client_message::Message::FetchResult(pb::FetchResult {
                result: Some(pb::fetch_result::Result::Error(pb::FetchError {
                    url: args.url.clone(),
                    error: MCP_NATIVE_FALLBACK_REJECTION.to_string(),
                })),
            }),
        ),
        pb::exec_server_message::Message::DiagnosticsArgs(_) => Some(
            pb::exec_client_message::Message::DiagnosticsResult(pb::DiagnosticsResult::default()),
        ),
        pb::exec_server_message::Message::ListMcpResourcesExecArgs(_) => Some(
            pb::exec_client_message::Message::ListMcpResourcesExecResult(
                pb::ListMcpResourcesExecResult::default(),
            ),
        ),
        pb::exec_server_message::Message::ReadMcpResourceExecArgs(_) => {
            Some(pb::exec_client_message::Message::ReadMcpResourceExecResult(
                pb::ReadMcpResourceExecResult::default(),
            ))
        }
        pb::exec_server_message::Message::RecordScreenArgs(_) => Some(
            pb::exec_client_message::Message::RecordScreenResult(pb::RecordScreenResult::default()),
        ),
        pb::exec_server_message::Message::ComputerUseArgs(_) => Some(
            pb::exec_client_message::Message::ComputerUseResult(pb::ComputerUseResult::default()),
        ),
        _ => None,
    }
}

pub(super) fn cursor_exec_to_tool_call(
    inner: &pb::exec_server_message::Message,
) -> Option<(ToolCallRequest, bool, ToolResultKind)> {
    match inner {
        pb::exec_server_message::Message::McpArgs(args) => {
            let arg_keys = args.args.keys().cloned().collect::<Vec<_>>().join(",");
            info!(
                "[cursor] native MCP args name={} tool_call_id={} arg_keys=[{}]",
                cursor_mcp_tool_name_from_args(args),
                args.tool_call_id,
                arg_keys
            );
            Some((mcp_args_to_tool_call(args), true, ToolResultKind::Mcp))
        }
        pb::exec_server_message::Message::LsArgs(args) => {
            info!("[cursor] native ls args path={:?}", args.path);
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::LIST_DIR.to_string(),
                    arguments: serde_json::json!({ "path": args.path }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::ReadArgs(args) => {
            info!("[cursor] native read args path={:?}", args.path);
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::READ_FILE.to_string(),
                    arguments: serde_json::json!({ "path": args.path }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::ShellArgs(args) => {
            info!(
                "[cursor] native shell args command={:?} working_directory={:?}",
                args.command, args.working_directory
            );
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::RUN_SHELL.to_string(),
                    arguments: serde_json::json!({
                        "command": args.command,
                        "description": "Executes Cursor native shell command",
                        "working_dir": args.working_directory,
                    }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::ShellStreamArgs(args) => {
            info!(
                "[cursor] native shell stream args command={:?} working_directory={:?}",
                args.command, args.working_directory
            );
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::RUN_SHELL.to_string(),
                    arguments: serde_json::json!({
                        "command": args.command,
                        "description": "Executes Cursor native shell command",
                        "working_dir": args.working_directory,
                    }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::WriteArgs(args) => {
            info!("[cursor] native write args path={:?}", args.path);
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::EDIT_FILE.to_string(),
                    arguments: serde_json::json!({
                        "file_path": args.path,
                        "content": cursor_write_content(args),
                    }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::DeleteArgs(args) => {
            info!("[cursor] native delete args path={:?}", args.path);
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::DELETE_FILE.to_string(),
                    arguments: serde_json::json!({ "path": args.path }),
                    thought_signature: None,
                },
                true,
                ToolResultKind::Native,
            ))
        }
        pb::exec_server_message::Message::GrepArgs(args) => {
            info!(
                "[cursor] native grep args pattern={:?} path={:?} glob={:?}",
                args.pattern, args.path, args.glob
            );
            let action = if args.pattern.trim().is_empty() && args.glob.is_some() {
                "glob"
            } else {
                "grep"
            };
            let pattern = if action == "glob" {
                args.glob.as_deref().unwrap_or("**/*")
            } else {
                args.pattern.as_str()
            };
            Some((
                ToolCallRequest {
                    id: cursor_tool_call_id(&args.tool_call_id),
                    name: tool_names::CODE_SEARCH.to_string(),
                    arguments: serde_json::json!({
                        "action": action,
                        "pattern": pattern,
                        "repo_path": args.path,
                        "glob": args.glob,
                        "context_lines": args.context,
                        "max_results": args.head_limit.unwrap_or(50),
                    }),
                    thought_signature: None,
                },
                false,
                ToolResultKind::Native,
            ))
        }
        _ => None,
    }
}

pub(super) fn cursor_tool_call_id(tool_call_id: &str) -> String {
    if tool_call_id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        tool_call_id.to_string()
    }
}

pub(super) fn cursor_write_content(args: &pb::WriteArgs) -> String {
    if !args.file_text.is_empty() {
        return args.file_text.clone();
    }
    String::from_utf8_lossy(&args.file_bytes).to_string()
}

/// Handle a server exec side-channel message.
///
/// Returns:
/// - `Ok(Some(pause))` when the server is asking us to invoke a tool. The
///   caller returns that tool call to ORGII while preserving the open stream;
///   the next provider call sends the matching result back on that stream.
/// - `Ok(None)` when the message was handled in-band (reply sent,
///   conversation continues).
/// - `Err(_)` if a reply couldn't be shipped to the server.
pub(super) fn handle_exec_server_message(
    stream: &RunStream,
    exec: pb::ExecServerMessage,
    tool_definitions: &[pb::McpToolDefinition],
    workspace_context: Option<&CursorNativeWorkspaceContext>,
) -> Result<Option<ExecToolPause>, ClientError> {
    let Some(inner) = &exec.message else {
        return Ok(None);
    };

    if let pb::exec_server_message::Message::McpArgs(args) = inner {
        if args.args.is_empty() {
            info!(
                "[cursor] native MCP args empty; treating as callable MCP exec name={} tool_call_id={} exec_message_id={}",
                cursor_mcp_tool_name_from_args(args),
                args.tool_call_id,
                exec.id
            );
        }
    }

    // Tool invocation: don't reply yet. ORGII's agent loop handles the
    // execution, then the provider sends the result back on this same stream.
    // Cursor native commonly prefers its built-in read/write/shell/search
    // exec variants even when ORGII MCP tools are advertised. Accept every
    // native variant that we can map to an ORGII tool; only reject unsupported
    // native probes below so Cursor can fall back to MCP args.
    if let Some((tool_call, requires_same_stream_result, result_kind)) =
        cursor_exec_to_tool_call(inner)
    {
        info!(
            "[cursor] server requested tool call: id={} name={} same_stream={} result_kind={:?}",
            tool_call.id, tool_call.name, requires_same_stream_result, result_kind
        );
        return Ok(Some(ExecToolPause {
            exec_id: exec.exec_id.clone(),
            exec_message_id: exec.id,
            tool_call,
            requires_same_stream_result,
            result_kind,
        }));
    }

    if let Some(result) = mcp_native_fallback_result(inner, tool_definitions) {
        let exec_variant = exec_message_variant_name(inner);
        let mcp_tool_names = tool_definitions
            .iter()
            .map(|definition| definition.tool_name.as_str())
            .collect::<Vec<_>>()
            .join(",");
        info!(
            "[cursor] rejecting unsupported native MCP-probe exec id={} exec_id={} variant={} available_mcp_tools=[{}] so model can fall back to MCP args",
            exec.id, exec.exec_id, exec_variant, mcp_tool_names
        );
        stream.send(&pb::AgentClientMessage {
            message: Some(pb::agent_client_message::Message::ExecClientMessage(
                pb::ExecClientMessage {
                    id: exec.id,
                    exec_id: exec.exec_id,
                    message: Some(result),
                },
            )),
        })?;
        return Ok(None);
    }

    // Otherwise: known side-channel requests we can answer in-band. Unknown
    // exec args must fail fast; leaving them unanswered causes Cursor to keep
    // the stream alive with heartbeats while waiting for a reply.
    let result: Option<pb::exec_client_message::Message> = match inner {
        pb::exec_server_message::Message::RequestContextArgs(args) => {
            info!(
                "[cursor] request context args workspace_id={:?} notes_session_id={:?} workspace={}",
                args.workspace_id,
                args.notes_session_id,
                workspace_context
                    .map(describe_workspace_context)
                    .unwrap_or_else(|| "<none>".to_string())
            );
            let request_context =
                build_request_context(tool_definitions, workspace_context).unwrap_or_default();
            Some(pb::exec_client_message::Message::RequestContextResult(
                pb::RequestContextResult {
                    result: Some(pb::request_context_result::Result::Success(
                        pb::RequestContextSuccess {
                            request_context: Some(request_context),
                        },
                    )),
                },
            ))
        }
        pb::exec_server_message::Message::McpArgs(_) => {
            // Already handled above; unreachable but keeps the match shape
            // explicit for future additions.
            None
        }
        other => {
            return Err(ClientError::Protocol(format!(
                "Unhandled Cursor ExecServerMessage id={} exec_id={} payload={:?}",
                exec.id, exec.exec_id, other
            )));
        }
    };
    let Some(result) = result else {
        return Ok(None);
    };
    let exec_message_id = exec.id;
    stream.send(&pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::ExecClientMessage(
            pb::ExecClientMessage {
                id: exec_message_id,
                exec_id: exec.exec_id,
                message: Some(result),
            },
        )),
    })?;
    stream.send(&pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::ExecClientControlMessage(
            pb::ExecClientControlMessage {
                message: Some(pb::exec_client_control_message::Message::StreamClose(
                    pb::ExecClientStreamClose {
                        id: exec_message_id,
                    },
                )),
            },
        )),
    })?;
    Ok(None)
}

/// Map transport-layer [`ClientError`] to the provider-level
/// [`crate::providers::traits::ProviderError`] variants the retry layer understands.
///
/// Code mapping informed by Cursor's Connect trailers observed in practice.
pub(super) fn map_client_error(
    err: ClientError,
) -> crate::providers::traits::ProviderError {
    use crate::providers::traits::ProviderError;
    match err {
        ClientError::Http(e) => ProviderError::RequestFailed(format!("Cursor HTTP: {}", e)),
        ClientError::Status {
            status,
            http_version,
            body,
        } if status == 401 || status == 403 => ProviderError::AuthError(format!(
            "Cursor rejected session JWT (HTTP {} over {}): {}",
            status,
            http_version,
            summarise(body)
        )),
        ClientError::Status {
            status,
            http_version,
            body,
        } => ProviderError::RequestFailed(format!(
            "Cursor HTTP {} over {}: {}",
            status,
            http_version,
            summarise(body)
        )),
        ClientError::Decode(e) => ProviderError::ParseError(format!("Cursor proto decode: {}", e)),
        ClientError::Protocol(message) => ProviderError::RequestFailed(message),
        ClientError::ConnectEnd { code, message } => {
            // Include the trailer code in every mapped variant's message.
            // Cursor's trailers are often terse (`"Error"` with no detail),
            // so without the code the user just sees "Auth error: Error"
            // and has no way to distinguish expired JWT from wrong header
            // envelope from missing subscription tier.
            let detail = format!("{} ({})", message, code);
            match code.as_str() {
                "unauthenticated" | "permission_denied" => ProviderError::AuthError(detail),
                "resource_exhausted" => ProviderError::RateLimited {
                    message: detail,
                    retry_after_secs: None,
                },
                "unavailable" => ProviderError::Overloaded {
                    message: detail,
                    retry_after_secs: None,
                },
                "not_found" | "unimplemented" | "deprecated" => {
                    ProviderError::ModelNotFound(detail)
                }
                _ => ProviderError::Other(format!("Cursor Connect error {}: {}", code, message)),
            }
        }
        ClientError::Cancelled => ProviderError::Cancelled,
    }
}

pub(super) fn summarise(body: String) -> String {
    let trimmed = &body[..body.len().min(300)];
    trimmed.to_string()
}
