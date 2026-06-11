//! Integration-style tests exercising drive_run against a synthetic server.
//!
//! Exercised via provider.rs: #[cfg(test)] #[path = "pipeline_tests.rs"] mod pipeline_tests;

use super::*;
use crate::providers::cursor_native::client::ServerMessageStream;
use crate::providers::cursor_native::request::BlobStore;
use async_stream::try_stream;
use prost::Message;
use std::sync::{Arc, Mutex};

/// Assemble a response stream that yields the given messages in order,
/// then ends cleanly. Each message is cloned into the stream (owned at
/// call time so the test body can assert on copies later).
fn canned_responses(messages: Vec<pb::AgentServerMessage>) -> ServerMessageStream {
    Box::pin(try_stream! {
        for msg in messages {
            yield msg;
        }
    })
}

/// Simple deltas accumulator wrapped in Arc<Mutex> so the on_delta
/// closure can push into it and the test body can read it out.
fn collector() -> (
    Arc<Mutex<Vec<StreamDelta>>>,
    impl Fn(StreamDelta) + Send + Sync,
) {
    let store: Arc<Mutex<Vec<StreamDelta>>> = Arc::new(Mutex::new(Vec::new()));
    let clone = store.clone();
    (store, move |delta: StreamDelta| {
        clone.lock().unwrap().push(delta);
    })
}

fn text_delta(text: &str) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::TextDelta(
                    pb::TextDeltaUpdate {
                        text: text.to_string(),
                    },
                )),
            },
        )),
    }
}

fn thinking_delta(text: &str) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::ThinkingDelta(
                    pb::ThinkingDeltaUpdate {
                        text: text.to_string(),
                    },
                )),
            },
        )),
    }
}

fn token_delta(tokens: i32) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::TokenDelta(
                    pb::TokenDeltaUpdate { tokens },
                )),
            },
        )),
    }
}

fn turn_ended() -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::TurnEnded(
                    pb::TurnEndedUpdate {},
                )),
            },
        )),
    }
}

fn mcp_tool_call(
    tool_call_id: &str,
    name: &str,
    args_map: HashMap<String, Vec<u8>>,
) -> pb::ToolCall {
    pb::ToolCall {
        tool: Some(pb::tool_call::Tool::McpToolCall(pb::McpToolCall {
            args: Some(pb::McpArgs {
                name: name.to_string(),
                args: args_map,
                tool_call_id: tool_call_id.to_string(),
                provider_identifier: "orgii".to_string(),
                tool_name: name.to_string(),
            }),
            result: None,
        })),
    }
}

fn tool_call_started(cursor_call_id: &str, tool_call: pb::ToolCall) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::ToolCallStarted(
                    pb::ToolCallStartedUpdate {
                        call_id: cursor_call_id.to_string(),
                        model_call_id: cursor_call_id.to_string(),
                        tool_call: Some(tool_call),
                    },
                )),
            },
        )),
    }
}

fn partial_tool_call(
    cursor_call_id: &str,
    tool_call: pb::ToolCall,
    args_text_delta: &str,
) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::PartialToolCall(
                    pb::PartialToolCallUpdate {
                        call_id: cursor_call_id.to_string(),
                        model_call_id: cursor_call_id.to_string(),
                        tool_call: Some(tool_call),
                        args_text_delta: args_text_delta.to_string(),
                    },
                )),
            },
        )),
    }
}

fn tool_call_completed(
    cursor_call_id: &str,
    tool_call: pb::ToolCall,
) -> pb::AgentServerMessage {
    pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::InteractionUpdate(
            pb::InteractionUpdate {
                message: Some(pb::interaction_update::Message::ToolCallCompleted(
                    pb::ToolCallCompletedUpdate {
                        call_id: cursor_call_id.to_string(),
                        model_call_id: cursor_call_id.to_string(),
                        tool_call: Some(tool_call),
                    },
                )),
            },
        )),
    }
}

/// Happy-path text chat: a few TextDelta updates + ThinkingDelta +
/// TokenDelta + TurnEnded → aggregated content, reasoning, usage, and
/// finish_reason = STOP.
#[tokio::test]
async fn drive_run_aggregates_text_turn() {
    let responses = canned_responses(vec![
        thinking_delta("let me think…"),
        text_delta("Hello, "),
        text_delta("world!"),
        token_delta(7),
        turn_ended(),
    ]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (collected, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.content.as_deref(), Some("Hello, world!"));
    assert_eq!(result.reasoning_content.as_deref(), Some("let me think…"));
    assert_eq!(result.finish_reason, finish_reason::STOP);
    assert_eq!(
        result.usage.get(usage_key::COMPLETION_TOKENS).copied(),
        Some(7)
    );
    assert!(result.tool_calls.is_empty());

    // Deltas emitted in order: reasoning, two text, and a final stop.
    let deltas = collected.lock().unwrap();
    assert_eq!(deltas.len(), 4);
    assert!(deltas[0].reasoning.is_some());
    assert_eq!(deltas[1].content.as_deref(), Some("Hello, "));
    assert_eq!(deltas[2].content.as_deref(), Some("world!"));
    assert_eq!(
        deltas[3].finish_reason.as_deref(),
        Some(finish_reason::STOP)
    );
}

#[tokio::test]
async fn drive_run_streams_partial_interaction_tool_args_before_completion() {
    let mut args_map = std::collections::HashMap::new();
    args_map.insert(
        "title".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan title"),
        ),
    );
    args_map.insert(
        "content".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan body"),
        ),
    );
    let completed_tool_call = mcp_tool_call("orgii-call-1", "create_plan", args_map);
    let started_tool_call = completed_tool_call.clone();
    let first_partial_tool_call = completed_tool_call.clone();
    let second_partial_tool_call = completed_tool_call.clone();
    let responses = canned_responses(vec![
        tool_call_started("cursor-call-1", started_tool_call),
        partial_tool_call(
            "cursor-call-1",
            first_partial_tool_call,
            r#"{"title":"Plan title""#,
        ),
        partial_tool_call(
            "cursor-call-1",
            second_partial_tool_call,
            r#", "content":"Plan body"}"#,
        ),
        tool_call_completed("cursor-call-1", completed_tool_call),
    ]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (collected, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.finish_reason, finish_reason::TOOL_CALLS);
    assert_eq!(result.tool_calls.len(), 1);
    assert_eq!(result.tool_calls[0].id, "orgii-call-1");
    assert_eq!(result.tool_calls[0].name, "create_plan");

    let deltas = collected.lock().unwrap();
    let tool_arg_deltas = deltas
        .iter()
        .filter_map(|delta| delta.tool_call_delta.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(tool_arg_deltas.len(), 2);
    assert!(tool_arg_deltas.iter().all(|delta| {
        delta.id.as_deref() == Some("orgii-call-1")
            && delta.name.as_deref() == Some("create_plan")
    }));
    assert_eq!(
        tool_arg_deltas
            .iter()
            .filter_map(|delta| delta.arguments_delta.as_deref())
            .collect::<String>(),
        r#"{"title":"Plan title", "content":"Plan body"}"#
    );
}

#[tokio::test]
async fn drive_run_splits_complete_only_create_plan_into_title_and_content_deltas() {
    let mut args_map = std::collections::HashMap::new();
    args_map.insert(
        "title".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan title"),
        ),
    );
    args_map.insert(
        "content".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan body"),
        ),
    );
    let completed_tool_call = mcp_tool_call("orgii-call-1", "create_plan", args_map);
    let responses = canned_responses(vec![tool_call_completed(
        "cursor-call-1",
        completed_tool_call,
    )]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (collected, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.finish_reason, finish_reason::TOOL_CALLS);
    assert_eq!(result.tool_calls.len(), 1);
    assert_eq!(result.tool_calls[0].id, "orgii-call-1");
    assert_eq!(result.tool_calls[0].name, "create_plan");

    let deltas = collected.lock().unwrap();
    let tool_arg_deltas = deltas
        .iter()
        .filter_map(|delta| delta.tool_call_delta.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(tool_arg_deltas.len(), 2);
    assert_eq!(
        tool_arg_deltas[0].arguments_delta.as_deref(),
        Some(r#"{"title":"Plan title""#)
    );
    assert_eq!(
        tool_arg_deltas[1].arguments_delta.as_deref(),
        Some(r#","content":"Plan body"}"#)
    );
}

#[tokio::test]
async fn drive_run_splits_exec_mcp_create_plan_into_title_and_content_deltas() {
    let mut args_map = std::collections::HashMap::new();
    args_map.insert(
        "title".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan title"),
        ),
    );
    args_map.insert(
        "content".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Plan body"),
        ),
    );
    let exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 1,
                exec_id: "exec_1".to_string(),
                message: Some(pb::exec_server_message::Message::McpArgs(pb::McpArgs {
                    name: "mcp_orgii_create_plan".to_string(),
                    args: args_map,
                    tool_call_id: "call_1".to_string(),
                    provider_identifier: "orgii".to_string(),
                    tool_name: "create_plan".to_string(),
                })),
                ..Default::default()
            },
        )),
    };

    let responses = canned_responses(vec![exec]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (collected, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.finish_reason, finish_reason::TOOL_CALLS);
    assert_eq!(result.tool_calls.len(), 1);
    assert_eq!(result.tool_calls[0].id, "call_1");
    assert_eq!(result.tool_calls[0].name, "create_plan");

    let deltas = collected.lock().unwrap();
    let tool_arg_deltas = deltas
        .iter()
        .filter_map(|delta| delta.tool_call_delta.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(tool_arg_deltas.len(), 2);
    assert_eq!(
        tool_arg_deltas[0].arguments_delta.as_deref(),
        Some(r#"{"title":"Plan title""#)
    );
    assert_eq!(
        tool_arg_deltas[1].arguments_delta.as_deref(),
        Some(r#","content":"Plan body"}"#)
    );
}

/// Tool-call path: the server issues `McpArgs`; drive_run must emit a
/// tool_call_delta, populate LLMResponse.tool_calls, and return
/// finish_reason = TOOL_CALLS without waiting for TurnEnded.
#[tokio::test]
async fn drive_run_short_circuits_on_mcp_args() {
    let mut args_map = std::collections::HashMap::new();
    args_map.insert(
        "query".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("rust"),
        ),
    );
    let exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 1,
                exec_id: "exec_1".to_string(),
                message: Some(pb::exec_server_message::Message::McpArgs(pb::McpArgs {
                    name: "web_search".to_string(),
                    args: args_map,
                    tool_call_id: "call_1".to_string(),
                    provider_identifier: "orgii".to_string(),
                    tool_name: "web_search".to_string(),
                })),
                ..Default::default()
            },
        )),
    };

    let responses = canned_responses(vec![text_delta("searching…"), exec]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (collected, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.finish_reason, finish_reason::TOOL_CALLS);
    assert_eq!(result.tool_calls.len(), 1);
    let call = &result.tool_calls[0];
    assert_eq!(call.id, "call_1");
    assert_eq!(call.name, "web_search");
    assert_eq!(call.arguments["query"], "rust");

    // Deltas include the text AND a tool_call_delta for the call.
    let deltas = collected.lock().unwrap();
    assert!(deltas
        .iter()
        .any(|delta| delta.content.as_deref() == Some("searching…")));
    assert!(deltas.iter().any(|delta| delta
        .tool_call_delta
        .as_ref()
        .is_some_and(|tcd| tcd.id.as_deref() == Some("call_1"))));
}

#[tokio::test]
async fn drive_run_pauses_immediately_on_empty_mcp_exec_args() {
    let empty_exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 9,
                exec_id: "exec_mcp".to_string(),
                message: Some(pb::exec_server_message::Message::McpArgs(pb::McpArgs {
                    name: "mcp__orgii__org_send_message".to_string(),
                    args: HashMap::new(),
                    tool_call_id: "call_mcp".to_string(),
                    provider_identifier: "orgii".to_string(),
                    tool_name: String::new(),
                })),
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![empty_exec]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    assert_eq!(result.finish_reason, finish_reason::TOOL_CALLS);
    assert_eq!(result.tool_calls.len(), 1);
    let call = &result.tool_calls[0];
    assert_eq!(call.id, "call_mcp");
    assert_eq!(call.name, "org_send_message");
    assert_eq!(call.arguments, serde_json::json!({}));
    let paused = result.paused_run.as_ref().expect("same-stream MCP pause");
    assert_eq!(paused.exec_id, "exec_mcp");
    assert_eq!(paused.exec_message_id, 9);
}

#[test]
fn mcp_exec_args_require_same_stream_result() {
    let mut args_map = HashMap::new();
    args_map.insert(
        "recipient_member_id".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("planner"),
        ),
    );
    args_map.insert(
        "kind".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("plain"),
        ),
    );
    args_map.insert(
        "text".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Begin research"),
        ),
    );
    let message = pb::exec_server_message::Message::McpArgs(pb::McpArgs {
        name: "mcp__orgii__org_send_message".to_string(),
        args: args_map,
        tool_call_id: "call_mcp".to_string(),
        provider_identifier: "orgii".to_string(),
        tool_name: tool_names::ORG_SEND_MESSAGE.to_string(),
    });

    let (tool_call, requires_same_stream_result, result_kind) =
        cursor_exec_to_tool_call(&message).expect("mcp exec maps to tool");
    assert_eq!(tool_call.name, tool_names::ORG_SEND_MESSAGE);
    assert!(requires_same_stream_result);
    assert_eq!(result_kind, ToolResultKind::Mcp);
}

#[tokio::test]
async fn paused_mcp_tool_result_is_sent_as_mcp_result_on_same_exec_stream() {
    let mut args_map = HashMap::new();
    args_map.insert(
        "pattern".to_string(),
        crate::providers::cursor_native::tools::encode_json_as_pb_value_bytes(
            &serde_json::json!("Nebula"),
        ),
    );
    let exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 11,
                exec_id: "exec_mcp_search".to_string(),
                message: Some(pb::exec_server_message::Message::McpArgs(pb::McpArgs {
                    name: tool_names::CODE_SEARCH.to_string(),
                    args: args_map,
                    tool_call_id: "mcp_search_1".to_string(),
                    provider_identifier: "orgii".to_string(),
                    tool_name: tool_names::CODE_SEARCH.to_string(),
                })),
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![exec]);
    let (stream, mut receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let outcome = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        Some("Find the Nebula marker and answer with it.".to_string()),
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");
    let paused = outcome
        .paused_run
        .as_ref()
        .expect("run paused for MCP tool result");
    assert_eq!(paused.result_kind, ToolResultKind::Mcp);
    send_tool_result_to_paused_run(
        paused,
        &serde_json::json!({
            "role": "tool",
            "tool_call_id": "mcp_search_1",
            "content": "README.md: Nebula Widget Service"
        }),
    )
    .expect("tool result sent");

    let sent = receiver.try_recv().expect("exec result was sent");
    let payload = &sent[5..];
    let client_msg = pb::AgentClientMessage::decode(payload).expect("valid client msg");
    let exec_reply = match client_msg.message.unwrap() {
        pb::agent_client_message::Message::ExecClientMessage(exec_reply) => exec_reply,
        other => panic!("expected ExecClientMessage, got {other:?}"),
    };
    assert_eq!(exec_reply.id, 11);
    assert_eq!(exec_reply.exec_id, "exec_mcp_search");
    let mcp_result = match exec_reply.message.unwrap() {
        pb::exec_client_message::Message::McpResult(result) => result,
        other => panic!("expected McpResult, got {other:?}"),
    };
    let success = match mcp_result.result {
        Some(pb::mcp_result::Result::Success(success)) => success,
        other => panic!("expected MCP success, got {other:?}"),
    };
    let first = success.content.first().expect("MCP content item");
    let text = match first.content.as_ref().expect("MCP text content") {
        pb::mcp_tool_result_content_item::Content::Text(text) => text.text.as_str(),
        other => panic!("expected text content, got {other:?}"),
    };
    assert!(text.contains("README.md: Nebula Widget Service"));
    assert!(text.contains("<current_user_request>"));
    assert!(text.contains("Find the Nebula marker and answer with it."));
}

#[tokio::test]
async fn paused_native_tool_result_is_sent_on_same_exec_stream() {
    let exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 7,
                exec_id: "exec_read".to_string(),
                message: Some(pb::exec_server_message::Message::ReadArgs(pb::ReadArgs {
                    path: "/repo/Cargo.toml".to_string(),
                    tool_call_id: "read_1".to_string(),
                })),
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![exec]);
    let (stream, mut receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let outcome = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");
    assert_eq!(outcome.finish_reason, finish_reason::TOOL_CALLS);
    let paused = outcome
        .paused_run
        .as_ref()
        .expect("run paused for tool result");
    send_tool_result_to_paused_run(
        paused,
        &serde_json::json!({
            "role": "tool",
            "tool_call_id": "read_1",
            "content": "[package]\nname = \"demo\"\n"
        }),
    )
    .expect("tool result sent");

    let sent = receiver.try_recv().expect("exec result was sent");
    let payload = &sent[5..];
    let client_msg = pb::AgentClientMessage::decode(payload).expect("valid client msg");
    let exec_reply = match client_msg.message.unwrap() {
        pb::agent_client_message::Message::ExecClientMessage(exec_reply) => exec_reply,
        other => panic!("expected ExecClientMessage, got {other:?}"),
    };
    assert_eq!(exec_reply.id, 7);
    assert_eq!(exec_reply.exec_id, "exec_read");
    let read_result = match exec_reply.message.unwrap() {
        pb::exec_client_message::Message::ReadResult(result) => result,
        other => panic!("expected ReadResult, got {other:?}"),
    };
    let success = match read_result.result.unwrap() {
        pb::read_result::Result::Success(success) => success,
        other => panic!("expected ReadSuccess, got {other:?}"),
    };
    assert_eq!(success.path, "/repo/Cargo.toml");
    match success.output.unwrap() {
        pb::read_success::Output::Content(content) => {
            assert!(content.contains("name = \"demo\""));
        }
        other => panic!("expected content output, got {other:?}"),
    }

    let control = receiver.try_recv().expect("exec stream close was sent");
    let payload = &control[5..];
    let client_msg = pb::AgentClientMessage::decode(payload).expect("valid client msg");
    match client_msg.message.unwrap() {
        pb::agent_client_message::Message::ExecClientControlMessage(control) => {
            match control.message.unwrap() {
                pb::exec_client_control_message::Message::StreamClose(close) => {
                    assert_eq!(close.id, 7);
                }
                other => panic!("expected StreamClose, got {other:?}"),
            }
        }
        other => panic!("expected ExecClientControlMessage, got {other:?}"),
    }
}

#[test]
fn native_exec_args_map_to_orgii_tools() {
    let cases = [
        (
            pb::exec_server_message::Message::ShellArgs(pb::ShellArgs {
                command: "pwd".to_string(),
                working_directory: "/tmp".to_string(),
                tool_call_id: "shell_1".to_string(),
                ..Default::default()
            }),
            tool_names::RUN_SHELL,
            "shell_1",
        ),
        (
            pb::exec_server_message::Message::ShellStreamArgs(pb::ShellArgs {
                command: "cargo test".to_string(),
                working_directory: "/repo".to_string(),
                tool_call_id: "shell_stream_1".to_string(),
                ..Default::default()
            }),
            tool_names::RUN_SHELL,
            "shell_stream_1",
        ),
        (
            pb::exec_server_message::Message::WriteArgs(pb::WriteArgs {
                path: "a.txt".to_string(),
                file_text: "hello".to_string(),
                tool_call_id: "write_1".to_string(),
                ..Default::default()
            }),
            tool_names::EDIT_FILE,
            "write_1",
        ),
        (
            pb::exec_server_message::Message::DeleteArgs(pb::DeleteArgs {
                path: "a.txt".to_string(),
                tool_call_id: "delete_1".to_string(),
            }),
            tool_names::DELETE_FILE,
            "delete_1",
        ),
    ];

    for (message, expected_name, expected_id) in cases {
        let (tool_call, _requires_same_stream_result, result_kind) =
            cursor_exec_to_tool_call(&message).expect("native exec maps to tool");
        assert_eq!(result_kind, ToolResultKind::Native);
        assert_eq!(tool_call.name, expected_name);
        assert_eq!(tool_call.id, expected_id);
    }
}

#[test]
fn handle_exec_maps_native_write_before_mcp_fallback_rejection() {
    let tool_definitions = build_tool_definitions(&[serde_json::json!({
        "type": "function",
        "function": {
            "name": tool_names::ORG_SEND_MESSAGE,
            "description": "Send a message",
            "parameters": { "type": "object", "properties": {} }
        }
    })]);
    let (stream, mut receiver) = client::RunStream::for_testing(canned_responses(Vec::new()));
    let exec = pb::ExecServerMessage {
        id: 7,
        exec_id: "exec_write".to_string(),
        message: Some(pb::exec_server_message::Message::WriteArgs(pb::WriteArgs {
            path: "a.txt".to_string(),
            file_text: "hello".to_string(),
            tool_call_id: "write_lookup".to_string(),
            ..Default::default()
        })),
        ..Default::default()
    };

    let pause = handle_exec_server_message(&stream, exec, &tool_definitions, None)
        .expect("native write should be handled")
        .expect("native write should pause for ORGII tool execution");

    assert_eq!(pause.tool_call.name, tool_names::EDIT_FILE);
    assert_eq!(pause.tool_call.id, "write_lookup");
    assert_eq!(pause.result_kind, ToolResultKind::Native);
    assert!(receiver.try_recv().is_err());
}

#[test]
fn mcp_tools_trigger_native_cursor_tool_rejection() {
    let tool_definitions = build_tool_definitions(&[serde_json::json!({
        "type": "function",
        "function": {
            "name": tool_names::ORG_SEND_MESSAGE,
            "description": "Send a message",
            "parameters": { "type": "object", "properties": {} }
        }
    })]);

    let grep_message = pb::exec_server_message::Message::GrepArgs(pb::GrepArgs {
        path: Some("/repo".to_string()),
        pattern: "org_send_message".to_string(),
        glob: None,
        tool_call_id: "schema_lookup".to_string(),
        ..Default::default()
    });
    let result = mcp_native_fallback_result(&grep_message, &tool_definitions)
        .expect("native grep receives a rejection when MCP tools exist");
    let pb::exec_client_message::Message::GrepResult(result) = result else {
        panic!("expected grep result");
    };
    let pb::grep_result::Result::Error(error) = result.result.expect("grep result payload")
    else {
        panic!("expected grep error");
    };
    assert_eq!(error.error, MCP_NATIVE_FALLBACK_REJECTION);

    let shell_message = pb::exec_server_message::Message::ShellStreamArgs(pb::ShellArgs {
        command: "pwd".to_string(),
        tool_call_id: "shell_lookup".to_string(),
        ..Default::default()
    });
    let result = mcp_native_fallback_result(&shell_message, &tool_definitions)
        .expect("native shell receives a rejection when MCP tools exist");
    let pb::exec_client_message::Message::ShellResult(result) = result else {
        panic!("expected shell result");
    };
    let pb::shell_result::Result::Rejected(rejected) =
        result.result.expect("shell result payload")
    else {
        panic!("expected shell rejection payload");
    };
    assert_eq!(rejected.reason, MCP_NATIVE_FALLBACK_REJECTION);
    assert!(!rejected.is_readonly);

    let write_message = pb::exec_server_message::Message::WriteArgs(pb::WriteArgs {
        path: "a.txt".to_string(),
        file_text: "hello".to_string(),
        tool_call_id: "write_lookup".to_string(),
        ..Default::default()
    });
    assert!(matches!(
        mcp_native_fallback_result(&write_message, &tool_definitions),
        Some(pb::exec_client_message::Message::WriteResult(_))
    ));

    let switch_mode_message = pb::exec_server_message::Message::McpArgs(pb::McpArgs {
        name: "SwitchMode".to_string(),
        args: HashMap::new(),
        tool_call_id: "switch_mode_1".to_string(),
        provider_identifier: String::new(),
        tool_name: String::new(),
    });
    let result = mcp_native_fallback_result(&switch_mode_message, &tool_definitions)
        .expect("non-orgii Cursor MCP tool receives a rejection when MCP tools exist");
    let pb::exec_client_message::Message::McpResult(result) = result else {
        panic!("expected MCP result");
    };
    let pb::mcp_result::Result::Success(success) = result.result.expect("MCP result payload")
    else {
        panic!("expected MCP success-shaped error payload");
    };
    assert!(success.is_error);
    let content = success.content.first().expect("MCP error content");
    let Some(pb::mcp_tool_result_content_item::Content::Text(text)) = &content.content else {
        panic!("expected text error content");
    };
    assert_eq!(text.text, MCP_NATIVE_FALLBACK_REJECTION);

    for visible_name in ["mcp__orgii__org_send_message", "mcp_orgii_org_send_message"] {
        let orgii_mcp_message = pb::exec_server_message::Message::McpArgs(pb::McpArgs {
            name: visible_name.to_string(),
            args: HashMap::new(),
            tool_call_id: "orgii_mcp_1".to_string(),
            provider_identifier: CURSOR_MCP_PROVIDER_IDENTIFIER.to_string(),
            tool_name: String::new(),
        });
        assert!(mcp_native_fallback_result(&orgii_mcp_message, &tool_definitions).is_none());
    }

    let read_without_mcp = pb::exec_server_message::Message::ReadArgs(pb::ReadArgs {
        path: "/repo/Cargo.toml".to_string(),
        tool_call_id: "read_1".to_string(),
    });
    assert!(mcp_native_fallback_result(&read_without_mcp, &[]).is_none());
}

#[tokio::test]
async fn drive_run_ignores_empty_exec_server_message() {
    let empty_exec = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 1,
                exec_id: String::new(),
                message: None,
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![empty_exec, text_delta("ok"), turn_ended()]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");
    assert_eq!(result.content.as_deref(), Some("ok"));
}

/// RequestContextArgs side-channel: drive_run replies on the send
/// channel with a RequestContextResult carrying our tool list.
#[tokio::test]
async fn drive_run_answers_request_context_with_tools() {
    let req_ctx = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::ExecServerMessage(
            pb::ExecServerMessage {
                id: 42,
                exec_id: "ctx_1".to_string(),
                message: Some(pb::exec_server_message::Message::RequestContextArgs(
                    pb::RequestContextArgs::default(),
                )),
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![req_ctx, turn_ended()]);
    let (stream, mut receiver) = client::RunStream::for_testing(responses);
    let (_collected, on_delta) = collector();

    let tool_defs =
        crate::providers::cursor_native::tools::build_tool_definitions(&[serde_json::json!({
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "search",
                "parameters": { "type": "object", "properties": {} }
            }
        })]);

    let result = drive_run(
        stream,
        BlobStore::new(),
        tool_defs,
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");
    assert_eq!(result.finish_reason, finish_reason::STOP);

    // The receiver should have one framed ExecClientMessage with the
    // RequestContextResult + our tool definition.
    let sent = receiver.try_recv().expect("reply was sent");
    // Drop Connect 5-byte envelope prefix.
    assert!(sent.len() > 5);
    let payload = &sent[5..];
    let client_msg = pb::AgentClientMessage::decode(payload).expect("valid client msg");
    let exec_reply = match client_msg.message.unwrap() {
        pb::agent_client_message::Message::ExecClientMessage(e) => e,
        other => panic!("expected ExecClientMessage, got {:?}", other),
    };
    assert_eq!(exec_reply.id, 42);
    assert_eq!(exec_reply.exec_id, "ctx_1");
    let reply_result = match exec_reply.message.unwrap() {
        pb::exec_client_message::Message::RequestContextResult(r) => r,
        other => panic!("expected RequestContextResult, got {:?}", other),
    };
    let context = match reply_result.result.unwrap() {
        pb::request_context_result::Result::Success(s) => s.request_context.unwrap(),
        _ => panic!("expected Success"),
    };
    assert_eq!(context.tools.len(), 1);
    assert_eq!(context.tools[0].name, "web_search");
    assert_eq!(context.tools[0].tool_name, "web_search");
}

/// KV GetBlobArgs: drive_run must reply with the blob bytes from the
/// store. Missing blob should produce a blob_data=None reply, not a
/// stream error (matches opencode-cursor behaviour).
#[tokio::test]
async fn drive_run_answers_kv_blob_get() {
    let mut blobs = BlobStore::new();
    blobs.insert(b"blob-id-bytes".to_vec(), b"blob contents".to_vec());

    let kv_get = pb::AgentServerMessage {
        message: Some(pb::agent_server_message::Message::KvServerMessage(
            pb::KvServerMessage {
                id: 5,
                message: Some(pb::kv_server_message::Message::GetBlobArgs(
                    pb::GetBlobArgs {
                        blob_id: b"blob-id-bytes".to_vec(),
                    },
                )),
                ..Default::default()
            },
        )),
    };
    let responses = canned_responses(vec![kv_get, turn_ended()]);
    let (stream, mut receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let _ = drive_run(
        stream,
        blobs,
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");

    let sent = receiver.try_recv().expect("blob reply sent");
    let payload = &sent[5..];
    let client_msg = pb::AgentClientMessage::decode(payload).expect("valid client msg");
    let kv_reply = match client_msg.message.unwrap() {
        pb::agent_client_message::Message::KvClientMessage(k) => k,
        other => panic!("expected KvClientMessage, got {:?}", other),
    };
    assert_eq!(kv_reply.id, 5);
    match kv_reply.message.unwrap() {
        pb::kv_client_message::Message::GetBlobResult(r) => {
            assert_eq!(r.blob_data.as_deref(), Some(b"blob contents".as_ref()));
        }
        _ => panic!("expected GetBlobResult"),
    }
}

/// Cancellation: setting the flag mid-stream must abort and return
/// `ProviderError::Cancelled` — no further deltas after the flag flips.
#[tokio::test]
async fn drive_run_honors_cancel_flag() {
    use std::sync::atomic::{AtomicBool, Ordering};

    // The stream has infinite text deltas — only cancellation stops it.
    let responses: ServerMessageStream = Box::pin(try_stream! {
        for i in 0..1000 {
            yield text_delta(&format!("chunk {} ", i));
        }
    });
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let flag = AtomicBool::new(false);

    // Trip the flag after a short yield so the stream has emitted some
    // content first. Using a raw pointer dance would be cleaner; the
    // simpler approach is to flip the flag synchronously after a few
    // polls in the on_delta callback.
    let flag_ref = &flag;
    let on_delta = move |_: StreamDelta| {
        flag_ref.store(true, Ordering::Relaxed);
    };

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        Some(&flag),
        None,
    )
    .await;
    assert!(matches!(result, Err(ProviderError::Cancelled)));
}

/// A response body that ends without TurnEnded (rare server abort):
/// drive_run returns whatever content it accumulated with finish = STOP.
/// This matches the "graceful degradation" tradeoff — the alternative
/// (erroring on unclean termination) would blow up every time Cursor
/// does a maintenance restart mid-stream.
#[tokio::test]
async fn drive_run_tolerates_stream_end_without_turn_ended() {
    let responses = canned_responses(vec![text_delta("partial")]);
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let result = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect("drive_run ok");
    assert_eq!(result.content.as_deref(), Some("partial"));
    assert_eq!(result.finish_reason, finish_reason::STOP);
}

/// A stream error mid-flight surfaces as the mapped ProviderError —
/// specifically, a ConnectEnd trailer bubbles up through the normal
/// translation path.
#[tokio::test]
async fn drive_run_propagates_connect_end_errors() {
    let responses: ServerMessageStream = Box::pin(try_stream! {
        yield text_delta("started…");
        Err(ClientError::ConnectEnd {
            code: "resource_exhausted".to_string(),
            message: "over quota".to_string(),
        })?;
        #[allow(unreachable_code)]
        { yield turn_ended(); }
    });
    let (stream, _receiver) = client::RunStream::for_testing(responses);
    let (_, on_delta) = collector();

    let err = drive_run(
        stream,
        BlobStore::new(),
        Vec::new(),
        None,
        None,
        &HashSet::new(),
        &on_delta,
        None,
        None,
    )
    .await
    .expect_err("stream error must surface");
    assert!(matches!(err, ProviderError::RateLimited { .. }));
}
