//! Build a Cursor `AgentRunRequest` from an OpenAI-style `messages[]` array.
//!
//! The shape Cursor's server expects is substantially more structured than
//! OpenAI chat-completions:
//!
//! - The system prompt is a binary blob, not a string. The request references
//!   it by SHA-256 ID (`rootPromptMessagesJson`) and the server asks us for
//!   the bytes back mid-stream via a `KvServerMessage::GetBlobArgs` roundtrip.
//!   We keep the raw bytes in a [`BlobStore`] so the response handler can
//!   satisfy those lookups.
//! - Prior turns aren't flat messages. Each turn is an
//!   `AgentConversationTurnStructure` with a pre-encoded `UserMessage` and a
//!   list of pre-encoded `ConversationStep`s (one per assistant utterance /
//!   tool call / thinking block), stored as a blob and referenced by hash.
//! - The *current* user message is not a turn but a `ConversationAction ::
//!   UserMessageAction`. Putting it in `turns` instead would work for one
//!   round but the server re-uses `action` for resume / cancel / summarise
//!   paths.
//!
//! Reference: opencode-cursor `src/proxy.ts:440-575` (message splitting) and
//! `:614-715` (protobuf construction). This is a Rust port of the same logic,
//! minus the checkpoint/tool branches which land in subsequent commits.

use std::collections::HashMap;

use prost::Message;
use sha2::{Digest, Sha256};
use tracing::info;

use super::proto::agent_v1 as pb;
use super::tools::{encode_tool_call_step, HistoricToolCall};
use crate::tools::names as tool_names;

/// Blob ID → raw bytes, for satisfying `KvServerMessage::GetBlobArgs`.
///
/// Keyed by the 32-byte SHA-256 hash (Cursor addresses blobs by hash).
pub type BlobStore = HashMap<Vec<u8>, Vec<u8>>;

/// Conversation roles ORGII supplies in the `messages[]` array.
///
/// Everything else (function, tool, etc.) is handled separately — tool
/// results are matched against open tool-call IDs and packaged into
/// `InteractionResponse`s, not stuffed into turns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    System,
    User,
    Assistant,
    Tool,
}

fn parse_role(value: &serde_json::Value) -> Option<Role> {
    match value.get("role")?.as_str()? {
        "system" | "developer" => Some(Role::System),
        "user" => Some(Role::User),
        "assistant" => Some(Role::Assistant),
        "tool" | "function" => Some(Role::Tool),
        _ => None,
    }
}

/// Pull plain text out of a message's `content` field.
///
/// Accepts either the string form (`"hi"`) or the structured-content form
/// OpenAI uses for multimodal input (`[{ "type": "text", "text": "hi" }, ...]`).
/// Non-text segments are dropped — Cursor's text-only API can't represent
/// images / audio anyway, and the alternative (panicking or injecting a
/// placeholder) would just hide the lossy conversion from the caller.
fn message_text(msg: &serde_json::Value) -> String {
    let Some(content) = msg.get("content") else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(parts) = content.as_array() {
        let mut out = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(text);
            }
        }
        return out;
    }
    String::new()
}

fn preview(text: &str) -> String {
    let mut output = String::new();
    for ch in crate::utils::safe_truncate_chars(text, 120).chars() {
        if ch.is_control() && ch != '\n' && ch != '\t' {
            continue;
        }
        output.push(ch);
    }
    output.replace('\n', "\\n")
}

fn log_request_summary(messages: &[serde_json::Value], split: &MessageSplit) {
    let action_name = match &split.current_action {
        CurrentAction::EmptyUser => "empty_user",
        CurrentAction::User(_) => "user",
        CurrentAction::ContinueAfterToolResults(_) => "continue_after_tool_results",
    };
    let action_preview = match &split.current_action {
        CurrentAction::User(text) | CurrentAction::ContinueAfterToolResults(text) => preview(text),
        CurrentAction::EmptyUser => String::new(),
    };
    let recent = messages
        .iter()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|msg| {
            let role = msg
                .get("role")
                .and_then(|value| value.as_str())
                .unwrap_or("?");
            let text = message_text(msg);
            let tool_calls = msg
                .get("tool_calls")
                .and_then(|value| value.as_array())
                .map_or(0, Vec::len);
            let tool_call_id = msg
                .get("tool_call_id")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            format!(
                "{role}:len={} calls={} tool_id={} text={:?}",
                text.len(),
                tool_calls,
                tool_call_id,
                preview(&text)
            )
        })
        .collect::<Vec<_>>()
        .join(" | ");
    info!(
        "[cursor] build_run_request action={} action_text={:?} turns={} messages={} recent=[{}]",
        action_name,
        action_preview,
        split.turns.len(),
        messages.len(),
        recent
    );
}

/// One completed user → assistant exchange, ready to serialise into a
/// `ConversationStep` list on the replayed turn.
#[derive(Debug, Default, Clone)]
struct HistoryTurn {
    user_text: String,
    /// Plain text the assistant said (concatenated across any text-only
    /// segments — Cursor's turn model has one `AssistantMessage` per step
    /// boundary, but we collapse them for the MVP).
    assistant_text: String,
    /// Each tool call the assistant made, along with the result orgii
    /// returned in the following `role: "tool"` message. Order preserved.
    tool_calls: Vec<HistoricToolCall>,
}

/// The action Cursor should take after replaying the conversation state.
#[derive(Debug, Default)]
enum CurrentAction {
    #[default]
    EmptyUser,
    User(String),
    ContinueAfterToolResults(String),
}

/// Split ORGII's flat messages into what `AgentRunRequest` needs: a system
/// prompt string, zero-or-more historical turns (each with its tool
/// exchanges), and the action Cursor should perform now.
#[derive(Debug, Default)]
struct MessageSplit {
    system_prompt: String,
    turns: Vec<HistoryTurn>,
    current_action: CurrentAction,
}

/// Parse the `tool_calls` array from an assistant message. Each entry
/// matches OpenAI's chat-completions shape:
/// `{ id, type: "function", function: { name, arguments } }` where
/// `arguments` is a JSON-encoded string the model emitted.
fn is_local_terminal_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        tool_names::CREATE_PLAN | tool_names::SUGGEST_MODE_SWITCH
    )
}

fn extract_tool_calls(msg: &serde_json::Value) -> Vec<(String, String, serde_json::Value)> {
    let Some(calls) = msg.get("tool_calls").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(calls.len());
    for entry in calls {
        let id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let function = entry.get("function").cloned().unwrap_or_default();
        let name = function
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        // Arguments are a JSON-encoded string in OpenAI's wire shape; the
        // agent loop may also pass a structured value directly. Handle both.
        let arguments = match function.get("arguments") {
            Some(serde_json::Value::String(s)) => {
                serde_json::from_str(s).unwrap_or(serde_json::Value::Null)
            }
            Some(other) => other.clone(),
            None => serde_json::Value::Null,
        };
        if !id.is_empty() && !name.is_empty() && !is_local_terminal_tool(&name) {
            out.push((id, name, arguments));
        }
    }
    out
}

fn tool_result_continuation_prompt(turn: &HistoryTurn) -> String {
    let completed_tools = turn
        .tool_calls
        .iter()
        .filter(|call| !call.result_text.trim().is_empty())
        .map(|call| {
            let mut section = format!(
                "Tool: {}\nResult:\n{}",
                call.tool_name,
                call.result_text.trim()
            );
            if call.tool_name == tool_names::AGENT {
                let prompt = arg_string(&call.arguments, "prompt");
                if !prompt.trim().is_empty() {
                    section.push_str("\nSubagent prompt:\n");
                    section.push_str(prompt.trim());
                }
            }
            section
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    format!(
        "Continue answering the original user request using the completed tool results below. Do not start a new unrelated task.\n\nOriginal user request:\n{}\n\nCompleted tool results:\n{}",
        turn.user_text, completed_tools
    )
}

fn arg_string(arguments: &serde_json::Value, key: &str) -> String {
    arguments
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn split_messages(messages: &[serde_json::Value]) -> MessageSplit {
    let mut system_chunks: Vec<String> = Vec::new();
    let mut turns: Vec<HistoryTurn> = Vec::new();
    let mut pending_user: Option<String> = None;
    // In-flight turn: user came in, assistant either hasn't replied yet or
    // replied and we're collecting tool results into the assistant's steps.
    let mut pending_assistant: Option<HistoryTurn> = None;
    // Map tool_call_id → index into pending_assistant.tool_calls so later
    // `role: "tool"` messages can patch the right entry.
    let mut pending_tool_results: HashMap<String, usize> = HashMap::new();
    // Tracks the role of the most recently processed message. Used at
    // finalisation to disambiguate "continue after tool execution" from
    // "regenerate the previous assistant reply".
    let mut last_role: Option<Role> = None;

    for msg in messages {
        let Some(role) = parse_role(msg) else {
            continue;
        };
        match role {
            Role::System => {
                let text = message_text(msg);
                if !text.is_empty() {
                    system_chunks.push(text);
                }
            }
            Role::User => {
                // Flush any complete-enough prior turn into history.
                if let Some(assistant_turn) = pending_assistant.take() {
                    turns.push(assistant_turn);
                    pending_tool_results.clear();
                } else if let Some(prev_user) = pending_user.take() {
                    // Two users in a row → flush the first with no reply.
                    turns.push(HistoryTurn {
                        user_text: prev_user,
                        ..Default::default()
                    });
                }
                pending_user = Some(message_text(msg));
            }
            Role::Assistant => {
                let text = message_text(msg);
                let tool_calls = extract_tool_calls(msg);
                // Without a preceding user, stitch this onto the most-recent
                // assistant turn (multi-step tool-using replies arrive as
                // successive assistant messages in the history).
                let turn = pending_assistant.get_or_insert_with(|| HistoryTurn {
                    user_text: pending_user.take().unwrap_or_default(),
                    ..Default::default()
                });
                if !text.is_empty() && tool_calls.is_empty() {
                    if !turn.assistant_text.is_empty() {
                        turn.assistant_text.push('\n');
                    }
                    turn.assistant_text.push_str(&text);
                }
                for (id, name, arguments) in tool_calls {
                    let index = turn.tool_calls.len();
                    turn.tool_calls.push(HistoricToolCall {
                        tool_call_id: id.clone(),
                        tool_name: name,
                        arguments,
                        result_text: String::new(),
                    });
                    pending_tool_results.insert(id, index);
                }
            }
            Role::Tool => {
                let Some(turn) = pending_assistant.as_mut() else {
                    continue;
                };
                let tool_call_id = msg
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let Some(&index) = pending_tool_results.get(tool_call_id) else {
                    continue;
                };
                if let Some(slot) = turn.tool_calls.get_mut(index) {
                    slot.result_text = message_text(msg);
                }
            }
        }
        last_role = Some(role);
    }

    // Resolve the next Cursor action at end-of-messages. Four shapes show up:
    //
    // 1. Trailing user with no assistant reply → send a UserMessageAction.
    //    This is the ordinary "agent loop has a fresh user question" path.
    // 2. Last message was a tool result → encode the completed tool exchange
    //    into history and emit a simulated user continuation. Cursor native's
    //    ResumeAction can reconnect to unrelated server-side state, so the
    //    current action must explicitly carry the original user request.
    // 3. Last message was a completed assistant reply with no new user
    //    after: the only reason to call us is a regenerate. Replay the
    //    preceding user question as current and drop the assistant side so
    //    we don't prime the model with the answer it's supposed to retry.
    // 4. Nothing at all → empty user action.
    let current_action = if let Some(text) = pending_user.take() {
        if let Some(turn) = pending_assistant.take() {
            turns.push(turn);
        }
        CurrentAction::User(text)
    } else if let Some(turn) = pending_assistant.take() {
        match last_role {
            Some(Role::Tool) => {
                let prompt = tool_result_continuation_prompt(&turn);
                turns.push(turn);
                CurrentAction::ContinueAfterToolResults(prompt)
            }
            _ => {
                // Trailing assistant with no tool follow-up: regenerate.
                CurrentAction::User(turn.user_text)
            }
        }
    } else {
        CurrentAction::EmptyUser
    };

    MessageSplit {
        system_prompt: system_chunks.join("\n\n"),
        turns,
        current_action,
    }
}

/// Hash bytes with SHA-256; returns the 32-byte digest as a `Vec<u8>`.
///
/// Cursor addresses blobs by their SHA-256 content-hash, matching
/// `createHash("sha256").update(bytes).digest()` in opencode-cursor.
fn sha256_bytes(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

/// Result of building a Run request: the wire-ready
/// [`pb::AgentClientMessage`] plus the [`BlobStore`] the response handler
/// must keep alive to satisfy mid-stream KV lookups.
pub struct BuiltRunRequest {
    pub client_message: pb::AgentClientMessage,
    pub blobs: BlobStore,
    pub conversation_id: String,
}

/// Build the opening `AgentClientMessage::RunRequest`.
///
/// Prior tool exchanges in `messages` (assistant with `tool_calls` followed
/// by matching `role: "tool"` messages) are replayed into each historical
/// turn's `ConversationStep` list so Cursor's server can reconstruct the
/// conversation state from scratch — this is what lets ORGII drive the
/// stateless provider trait against Cursor's otherwise stream-persistent
/// protocol.
///
pub fn build_run_request(messages: &[serde_json::Value], model_id: &str) -> BuiltRunRequest {
    build_run_request_with_context(messages, model_id, uuid::Uuid::new_v4().to_string(), None)
}

/// Build the Cursor `RunRequest` plus blob store.
///
/// On ordinary user turns, Cursor can ask for tool definitions via the
/// `RequestContextArgs` side-channel. If a RunRequest must be reconstructed
/// from history after a completed tool exchange, the reconstructed simulated
/// continuation still exposes the same request context side-channel.
pub fn build_run_request_with_context(
    messages: &[serde_json::Value],
    model_id: &str,
    conversation_id: String,
    request_context: Option<pb::RequestContext>,
) -> BuiltRunRequest {
    let split = split_messages(messages);
    log_request_summary(messages, &split);

    // Store the system prompt as a SHA-256-addressed blob. The server
    // fetches it back via GetBlobArgs part-way through the stream.
    let mut blobs = BlobStore::new();
    let system_blob_id = {
        let wrapper = serde_json::json!({
            "role": "system",
            "content": split.system_prompt,
        });
        let bytes = serde_json::to_vec(&wrapper).expect("serialize system blob");
        let id = sha256_bytes(&bytes);
        blobs.insert(id.clone(), bytes);
        id
    };

    let turn_blob_ids: Vec<Vec<u8>> = split
        .turns
        .iter()
        .map(|turn| {
            let bytes = encode_turn(turn, &mut blobs);
            let id = sha256_bytes(&bytes);
            blobs.insert(id.clone(), bytes);
            id
        })
        .collect();

    let conversation_state = pb::ConversationStateStructure {
        root_prompt_messages_json: vec![system_blob_id],
        turns: turn_blob_ids,
        ..Default::default()
    };

    if let Some(context) = &request_context {
        let names = context
            .tools
            .iter()
            .map(|definition| {
                format!(
                    "{}:{}:{}",
                    definition.provider_identifier,
                    definition.tool_name,
                    definition.input_schema.len()
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        info!(
            "[cursor] request_context tools count={} defs=[{}]",
            context.tools.len(),
            names
        );
    }

    let action = match split.current_action {
        CurrentAction::User(text) => pb::ConversationAction {
            action: Some(pb::conversation_action::Action::UserMessageAction(
                pb::UserMessageAction {
                    user_message: Some(pb::UserMessage {
                        text,
                        message_id: uuid::Uuid::new_v4().to_string(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
        },
        CurrentAction::ContinueAfterToolResults(text) => pb::ConversationAction {
            action: Some(pb::conversation_action::Action::UserMessageAction(
                pb::UserMessageAction {
                    user_message: Some(pb::UserMessage {
                        text,
                        message_id: uuid::Uuid::new_v4().to_string(),
                        is_simulated_msg: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
        },
        CurrentAction::EmptyUser => pb::ConversationAction {
            action: Some(pb::conversation_action::Action::UserMessageAction(
                pb::UserMessageAction {
                    user_message: Some(pb::UserMessage {
                        text: String::new(),
                        message_id: uuid::Uuid::new_v4().to_string(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
        },
    };

    let model_details = pb::ModelDetails {
        model_id: model_id.to_string(),
        display_model_id: model_id.to_string(),
        display_name: model_id.to_string(),
        ..Default::default()
    };

    let run = pb::AgentRunRequest {
        conversation_state: Some(conversation_state),
        action: Some(action),
        model_details: Some(model_details),
        conversation_id: Some(conversation_id.clone()),
        ..Default::default()
    };

    let client_message = pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::RunRequest(run)),
    };

    BuiltRunRequest {
        client_message,
        blobs,
        conversation_id,
    }
}

fn store_blob(bytes: Vec<u8>, blobs: &mut BlobStore) -> Vec<u8> {
    let id = sha256_bytes(&bytes);
    blobs.insert(id.clone(), bytes);
    id
}

/// Encode one historical turn as a `ConversationTurnStructure` byte blob.
///
/// Steps are emitted in order: the assistant's text (if any), followed by
/// one `ToolCall` step per historical tool exchange. Empty turns (user
/// with no assistant reply) produce zero steps — the server tolerates this
/// for interrupted turns.
fn encode_turn(turn: &HistoryTurn, blobs: &mut BlobStore) -> Vec<u8> {
    let user_message = pb::UserMessage {
        text: turn.user_text.clone(),
        message_id: uuid::Uuid::new_v4().to_string(),
        ..Default::default()
    };
    let mut user_buf = Vec::with_capacity(user_message.encoded_len());
    user_message
        .encode(&mut user_buf)
        .expect("prost encode UserMessage");
    let user_blob_id = store_blob(user_buf, blobs);

    let mut steps: Vec<Vec<u8>> = Vec::new();
    if !turn.assistant_text.is_empty() {
        let step = pb::ConversationStep {
            message: Some(pb::conversation_step::Message::AssistantMessage(
                pb::AssistantMessage {
                    text: turn.assistant_text.clone(),
                },
            )),
        };
        let mut step_buf = Vec::with_capacity(step.encoded_len());
        step.encode(&mut step_buf).expect("prost encode step");
        steps.push(store_blob(step_buf, blobs));
    }
    for call in &turn.tool_calls {
        steps.push(store_blob(encode_tool_call_step(call), blobs));
    }

    let agent_turn = pb::AgentConversationTurnStructure {
        user_message: user_blob_id,
        steps,
        ..Default::default()
    };
    let turn_structure = pb::ConversationTurnStructure {
        turn: Some(pb::conversation_turn_structure::Turn::AgentConversationTurn(agent_turn)),
    };

    let mut out = Vec::with_capacity(turn_structure.encoded_len());
    turn_structure
        .encode(&mut out)
        .expect("prost encode turn structure");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn extract_run(msg: &pb::AgentClientMessage) -> &pb::AgentRunRequest {
        match &msg.message {
            Some(pb::agent_client_message::Message::RunRequest(r)) => r,
            _ => panic!("expected RunRequest variant"),
        }
    }

    fn current_user_text(run: &pb::AgentRunRequest) -> &str {
        match &run.action.as_ref().unwrap().action {
            Some(pb::conversation_action::Action::UserMessageAction(action)) => {
                &action.user_message.as_ref().unwrap().text
            }
            _ => panic!("expected UserMessageAction"),
        }
    }

    fn is_resume_action(run: &pb::AgentRunRequest) -> bool {
        matches!(
            run.action
                .as_ref()
                .and_then(|action| action.action.as_ref()),
            Some(pb::conversation_action::Action::ResumeAction(_))
        )
    }

    /// Single user message: the entire system is empty, the one message
    /// becomes the current user turn, no history.
    #[test]
    fn single_user_message_becomes_current_turn() {
        let messages = vec![json!({"role": "user", "content": "hello"})];
        let built = build_run_request(&messages, "default");
        let run = extract_run(&built.client_message);

        assert_eq!(current_user_text(run), "hello");
        let state = run.conversation_state.as_ref().unwrap();
        assert!(state.turns.is_empty(), "no prior history");
        assert_eq!(state.root_prompt_messages_json.len(), 1);
    }

    /// System prompt is stored as a blob; the blob ID matches what the
    /// server will later ask for via GetBlobArgs.
    #[test]
    fn system_prompt_is_sha256_blob() {
        let messages = vec![
            json!({"role": "system", "content": "you are helpful"}),
            json!({"role": "user", "content": "hi"}),
        ];
        let built = build_run_request(&messages, "default");
        let run = extract_run(&built.client_message);

        let state = run.conversation_state.as_ref().unwrap();
        let blob_id = state.root_prompt_messages_json.first().expect("has id");
        assert_eq!(blob_id.len(), 32, "SHA-256 produces 32 bytes");

        // blob_id must key into the blob store with the exact bytes we
        // told the server about — otherwise GetBlobArgs will miss.
        let stored = built.blobs.get(blob_id).expect("blob present");
        let wrapper: serde_json::Value = serde_json::from_slice(stored).unwrap();
        assert_eq!(wrapper["role"], "system");
        assert_eq!(wrapper["content"], "you are helpful");
    }

    /// Multi-turn history without tool calls: every completed (user,
    /// assistant) pair becomes one encoded turn blob whose single step is
    /// the assistant text; the current user message is the unpaired
    /// trailing user.
    #[test]
    fn history_splits_into_pairs() {
        let messages = vec![
            json!({"role": "user", "content": "u1"}),
            json!({"role": "assistant", "content": "a1"}),
            json!({"role": "user", "content": "u2"}),
            json!({"role": "assistant", "content": "a2"}),
            json!({"role": "user", "content": "u3"}),
        ];
        let built = build_run_request(&messages, "default");
        let run = extract_run(&built.client_message);

        let state = run.conversation_state.as_ref().unwrap();
        assert_eq!(state.turns.len(), 2, "two completed pairs");
        assert_eq!(current_user_text(run), "u3");

        // Each turn reference should point to a blob that decodes back to a
        // ConversationTurnStructure with matching user + assistant text.
        for (i, (expected_u, expected_a)) in [("u1", "a1"), ("u2", "a2")].iter().enumerate() {
            let turn_blob_id = &state.turns[i];
            assert_eq!(turn_blob_id.len(), 32, "turns are SHA-256 blob ids");
            let turn_bytes = built.blobs.get(turn_blob_id).expect("turn blob present");
            let turn =
                pb::ConversationTurnStructure::decode(turn_bytes.as_slice()).expect("turn decodes");
            let agent = match turn.turn.unwrap() {
                pb::conversation_turn_structure::Turn::AgentConversationTurn(a) => a,
                _ => panic!("expected agent turn"),
            };
            assert_eq!(agent.user_message.len(), 32, "user_message is a blob id");
            let user_bytes = built
                .blobs
                .get(&agent.user_message)
                .expect("user message blob present");
            let user = pb::UserMessage::decode(user_bytes.as_slice()).unwrap();
            assert_eq!(user.text, *expected_u);
            assert_eq!(agent.steps.len(), 1, "one assistant step");
            assert_eq!(agent.steps[0].len(), 32, "step is a blob id");
            let step_bytes = built.blobs.get(&agent.steps[0]).expect("step blob present");
            let step = pb::ConversationStep::decode(step_bytes.as_slice()).unwrap();
            match step.message.unwrap() {
                pb::conversation_step::Message::AssistantMessage(m) => {
                    assert_eq!(m.text, *expected_a);
                }
                _ => panic!("expected AssistantMessage"),
            }
        }
    }

    /// Structured content array (OpenAI multimodal shape) flattens into
    /// newline-joined text — images and non-text parts are dropped for
    /// text-only Cursor. Text segments are separated by '\n' to match the
    /// multi-assistant-message join behaviour in `split_messages`.
    #[test]
    fn structured_content_flattens_to_text() {
        let messages = vec![json!({
            "role": "user",
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "image_url", "image_url": {"url": "data:..."}},
                {"type": "text", "text": "world"}
            ]
        })];
        let built = build_run_request(&messages, "default");
        assert_eq!(
            current_user_text(extract_run(&built.client_message)),
            "hello\nworld"
        );
    }

    /// Final message is assistant (rare — resume/re-run): re-use the
    /// preceding user text as the "current" so Cursor gets a user-style
    /// action to respond to. Matches opencode-cursor proxy.ts:569-572.
    #[test]
    fn trailing_assistant_replays_previous_user() {
        let messages = vec![
            json!({"role": "user", "content": "ask"}),
            json!({"role": "assistant", "content": "answer"}),
        ];
        let built = build_run_request(&messages, "default");
        assert_eq!(current_user_text(extract_run(&built.client_message)), "ask");
        // And turns is empty because the only pair got consumed.
        let state = extract_run(&built.client_message)
            .conversation_state
            .as_ref()
            .unwrap();
        assert!(state.turns.is_empty());
    }

    /// Model ID is mirrored into displayModelId and displayName — Cursor
    /// accepts either-or, but sending just model_id empirically causes some
    /// model routing fallback paths to misfire.
    #[test]
    fn model_id_populates_display_fields() {
        let messages = vec![json!({"role": "user", "content": "x"})];
        let built = build_run_request(&messages, "composer-1");
        let details = extract_run(&built.client_message)
            .model_details
            .as_ref()
            .unwrap();
        assert_eq!(details.model_id, "composer-1");
        assert_eq!(details.display_model_id, "composer-1");
        assert_eq!(details.display_name, "composer-1");
    }

    /// Empty `messages` is a degenerate case (no system, no user).
    /// We still produce a valid wire-ready message rather than panicking —
    /// the caller is responsible for sanity input.
    #[test]
    fn empty_messages_produces_empty_turn() {
        let built = build_run_request(&[], "default");
        let run = extract_run(&built.client_message);
        assert_eq!(current_user_text(run), "");
        assert!(run.conversation_state.as_ref().unwrap().turns.is_empty());
    }

    /// Assistant-with-tool-calls + tool result pair is replayed as a single
    /// turn whose steps list contains `AssistantMessage` + `ToolCall
    /// (McpToolCall)`. This is the load-bearing path for multi-turn agent
    /// conversations with tools: if it breaks, the server sees the tool
    /// call as never-happened and the model loops.
    #[test]
    fn tool_call_history_flows_into_turn_steps() {
        let messages = vec![
            json!({"role": "user", "content": "search rust"}),
            json!({
                "role": "assistant",
                "content": "sure",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "arguments": "{\"query\":\"rust\"}"
                    }
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call_1",
                "content": "found 3 links"
            }),
            json!({"role": "user", "content": "pick one"}),
        ];
        let built = build_run_request(&messages, "default");
        let run = extract_run(&built.client_message);
        let state = run.conversation_state.as_ref().unwrap();

        assert_eq!(state.turns.len(), 1);
        assert_eq!(current_user_text(run), "pick one");

        let turn_bytes = built.blobs.get(&state.turns[0]).expect("turn blob present");
        let turn = pb::ConversationTurnStructure::decode(turn_bytes.as_slice()).unwrap();
        let agent = match turn.turn.unwrap() {
            pb::conversation_turn_structure::Turn::AgentConversationTurn(a) => a,
            _ => panic!("expected agent turn"),
        };
        assert_eq!(
            agent.steps.len(),
            1,
            "tool exchange is replayed as one tool step"
        );

        assert_eq!(agent.steps[0].len(), 32, "step0 is a blob id");
        let step0_bytes = built
            .blobs
            .get(&agent.steps[0])
            .expect("step0 blob present");
        let step0 = pb::ConversationStep::decode(step0_bytes.as_slice()).unwrap();
        match step0.message.unwrap() {
            pb::conversation_step::Message::ToolCall(tc) => match tc.tool.unwrap() {
                pb::tool_call::Tool::McpToolCall(mcp) => {
                    let args = mcp.args.unwrap();
                    assert_eq!(args.tool_call_id, "call_1");
                    assert_eq!(args.tool_name, "web_search");
                    assert!(mcp.result.is_some(), "tool result embedded");
                }
                _ => panic!("expected McpToolCall"),
            },
            _ => panic!("expected ToolCall step"),
        }
    }

    #[test]
    fn second_user_after_tool_history_stays_user_action() {
        let messages = vec![
            json!({"role": "user", "content": "inspect files"}),
            json!({
                "role": "assistant",
                "content": "I will list the directory.",
                "tool_calls": [{
                    "id": "call_ls",
                    "type": "function",
                    "function": {"name": "list_dir", "arguments": "{\"path\":\".\"}"}
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call_ls",
                "content": "Cargo.toml\nREADME.md"
            }),
            json!({"role": "user", "content": "now summarize what you saw"}),
        ];

        let built = build_run_request(&messages, "composer-2");
        let run = extract_run(&built.client_message);
        assert_eq!(current_user_text(run), "now summarize what you saw");
        assert!(!is_resume_action(run));
        assert_eq!(run.conversation_state.as_ref().unwrap().turns.len(), 1);
    }

    #[test]
    fn agent_tool_result_history_continues_with_task_result_context() {
        let messages = vec![
            json!({"role": "user", "content": "Use explore and report marker"}),
            json!({
                "role": "assistant",
                "content": "Launching explore.",
                "tool_calls": [{
                    "id": "call_agent",
                    "type": "function",
                    "function": {
                        "name": tool_names::AGENT,
                        "arguments": "{\"agent_id\":\"builtin:explore\",\"prompt\":\"read marker\"}"
                    }
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call_agent",
                "content": "CURSOR_NATIVE_SUBAGENT_MARKER=opal-subagent-731"
            }),
        ];

        let built = build_run_request(&messages, "composer-2");
        let run = extract_run(&built.client_message);
        assert!(!is_resume_action(run));
        let text = current_user_text(run);
        assert!(text.contains("Continue answering the original user request"));
        assert!(text.contains("opal-subagent-731"));
    }

    /// Cold-start replay after a completed tool exchange uses an explicit
    /// simulated continuation so Cursor cannot attach unrelated server state.
    #[test]
    fn tool_result_history_replay_uses_simulated_continuation() {
        let prompt = "Inspect this repository and summarize its purpose.";
        let messages = vec![
            json!({"role": "user", "content": prompt}),
            json!({
                "role": "assistant",
                "content": "I will inspect the repository files.",
                "tool_calls": [{
                    "id": "call_explore",
                    "type": "function",
                    "function": {"name": "list_dir", "arguments": "{\"path\":\".\"}"}
                }]
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call_explore",
                "content": "Cargo.toml\nREADME.md"
            }),
        ];

        let built = build_run_request(&messages, "composer-2");
        let run = extract_run(&built.client_message);
        let state = run.conversation_state.as_ref().unwrap();

        assert_eq!(state.turns.len(), 1);
        assert!(!is_resume_action(run));
        let text = current_user_text(run);
        assert!(text.contains("Continue answering the original user request"));
        assert!(text.contains(prompt));
        assert!(text.contains("Cargo.toml"));
    }

    /// Assistant tool-call without a preceding user (multi-step tool reply)
    /// gets stitched onto the in-flight assistant turn rather than dropped.
    #[test]
    fn multi_step_assistant_tool_calls_stitch_onto_same_turn() {
        let messages = vec![
            json!({"role": "user", "content": "do two things"}),
            json!({
                "role": "assistant",
                "content": "step 1",
                "tool_calls": [{
                    "id": "a",
                    "type": "function",
                    "function": {"name": "t", "arguments": "{}"}
                }]
            }),
            json!({"role": "tool", "tool_call_id": "a", "content": "r1"}),
            json!({
                "role": "assistant",
                "content": "step 2",
                "tool_calls": [{
                    "id": "b",
                    "type": "function",
                    "function": {"name": "t", "arguments": "{}"}
                }]
            }),
            json!({"role": "tool", "tool_call_id": "b", "content": "r2"}),
        ];
        let built = build_run_request(&messages, "default");
        let run = extract_run(&built.client_message);
        let state = run.conversation_state.as_ref().unwrap();

        // No new user message; the in-flight assistant turn flushes to
        // history and the current action carries an explicit simulated
        // continuation with the original request and completed results.
        assert_eq!(state.turns.len(), 1);
        assert!(!is_resume_action(run));
        assert!(current_user_text(run).contains("Continue answering the original user request"));
        let turn_bytes = built.blobs.get(&state.turns[0]).expect("turn blob present");
        let turn = pb::ConversationTurnStructure::decode(turn_bytes.as_slice()).unwrap();
        let agent = match turn.turn.unwrap() {
            pb::conversation_turn_structure::Turn::AgentConversationTurn(a) => a,
            _ => panic!("expected agent turn"),
        };
        assert_eq!(agent.steps.len(), 2, "both tool calls are replayed");
        for step_id in &agent.steps {
            let step_bytes = built.blobs.get(step_id).expect("step blob present");
            let step = pb::ConversationStep::decode(step_bytes.as_slice()).unwrap();
            assert!(matches!(
                step.message,
                Some(pb::conversation_step::Message::ToolCall(_))
            ));
        }
    }

    /// The returned AgentClientMessage must actually round-trip through
    /// prost encode/decode — catches any schema mismatches or required
    /// fields we forgot to set.
    #[test]
    fn built_message_round_trips_through_prost() {
        let messages = vec![
            json!({"role": "system", "content": "sys"}),
            json!({"role": "user", "content": "u1"}),
            json!({"role": "assistant", "content": "a1"}),
            json!({"role": "user", "content": "u2"}),
        ];
        let built = build_run_request(&messages, "default");
        let mut buf = Vec::with_capacity(built.client_message.encoded_len());
        built.client_message.encode(&mut buf).unwrap();
        let decoded = pb::AgentClientMessage::decode(buf.as_slice()).unwrap();
        assert_eq!(current_user_text(extract_run(&decoded)), "u2");
    }
}
