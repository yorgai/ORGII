//! `CursorNativeClient`: the [`LLMProvider`] adapter over Cursor's
//! `agent.v1.AgentService/Run` Connect RPC.
//!
//! Responsibilities:
//! - Hold a reusable `reqwest::Client` configured for HTTP/2 + rustls (see
//!   `factory.rs` for construction — we inherit the reqwest default plus
//!   whatever ALPN negotiates, which empirically picks HTTP/2 against
//!   `api2.cursor.sh`).
//! - Translate ORGII `chat_streaming` calls into an opening [`pb::AgentRunRequest`],
//!   hand it to [`client::start_run`], and drive the resulting bidirectional
//!   stream.
//! - Respond to mid-stream server side-channel requests (blob lookups,
//!   request-context asks) so the server doesn't stall waiting on us.
//! - Surface streamed text/thinking/usage as `StreamDelta`s and translate
//!   Connect / transport errors into [`ProviderError`].
//!
//! Native built-in tool invocations arrive through the exec side-channel. MCP
//! tools can also arrive as interaction-level tool lifecycle payloads, which
//! are translated into ORGII tool requests when no exec payload is needed.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};

use super::auth;
use super::client::{self, ClientError, RunStream};
use super::proto::agent_v1 as pb;
use super::request::{build_run_request_with_context, BlobStore};
use super::tools::{
    build_tool_definitions, encode_exec_tool_result_message, encode_mcp_exec_tool_result_message,
    mcp_args_to_tool_call, HistoricToolCall, CURSOR_MCP_PROVIDER_IDENTIFIER,
};
use crate::definitions::builtin::{EXPLORE_AGENT_ID, GENERAL_AGENT_ID};
use crate::providers::traits::{
    finish_reason, usage_key, LLMProvider, LLMResponse, ProviderConfig, ProviderError,
    SideQueryExecution, StreamDelta, ToolCallDelta, ToolCallRequest,
};
use crate::tools::names as tool_names;

/// Cursor's agent-mode auto-router model. Matches the `default` entry in
/// `agent.v1.AgentService/GetUsableModels`; the server picks an appropriate
/// composer-class model based on the user's subscription.
pub const DEFAULT_MODEL: &str = "default";

/// Provider name used in logs / telemetry and for [`LLMProvider::provider_name`].
pub const PROVIDER_NAME: &str = "cursor";

/// Total wall-clock cap on a single Run RPC. Cursor can legitimately stream
/// for minutes on long tool-using turns, but text-only replies finish in
/// seconds; for MVP we cap at 5 minutes so a hung stream eventually surfaces
/// a timeout error rather than blocking the agent loop forever.
const OVERALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Per-message idle cap while consuming the Cursor Run stream. Once the server
/// has accepted the Run, a completely silent stream for this long indicates a
/// protocol/tool-surface stall; returning a provider error lets callers persist
/// a failed turn instead of letting the HTTP debug endpoint time out and emit
/// an undecodable body.
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
const COMPLETE_TOOL_CALL_DRAFT_FLUSH_DELAY: Duration = Duration::from_millis(80);

fn stable_conversation_id(session_id: &str) -> String {
    let digest = Sha256::digest(format!("orgii:cursor-native:{session_id}").as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Public constructor surface.
pub struct CursorNativeProvider {
    config: ProviderConfig,
    http: Client,
    default_model: String,
    conversation_id: Mutex<String>,
    workspace_context: Option<CursorNativeWorkspaceContext>,
    active_turn: Mutex<Option<ContinuationToken>>,
    pending_run: Mutex<Option<PendingCursorRun>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContinuationToken {
    session_id: String,
    turn_id: String,
    kind: ContinuationKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ContinuationKind {
    SameStreamToolResult,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ToolContinuationPolicy {
    ContinueSameStream,
    EndLogicalTurn,
}

struct PendingCursorRun {
    token: Option<ContinuationToken>,
    stream: RunStream,
    blobs: BlobStore,
    tool_definitions: Vec<pb::McpToolDefinition>,
    exec_id: String,
    exec_message_id: u32,
    tool_call: ToolCallRequest,
    result_kind: ToolResultKind,
    current_user_request: Option<String>,
}

struct CursorRunOutcome {
    response: LLMResponse,
    paused_run: Option<PendingCursorRun>,
}

impl std::ops::Deref for CursorRunOutcome {
    type Target = LLMResponse;

    fn deref(&self) -> &Self::Target {
        &self.response
    }
}

impl std::fmt::Debug for CursorRunOutcome {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CursorRunOutcome")
            .field("response", &self.response)
            .field("paused_run", &self.paused_run.is_some())
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ToolResultKind {
    Mcp,
    Native,
}

struct ExecToolPause {
    exec_id: String,
    exec_message_id: u32,
    tool_call: ToolCallRequest,
    requires_same_stream_result: bool,
    result_kind: ToolResultKind,
}

#[derive(Clone, Debug)]
pub struct CursorNativeWorkspaceContext {
    pub project_folder: PathBuf,
    pub workspace_paths: Vec<PathBuf>,
}

impl CursorNativeProvider {
    fn active_token(&self) -> Result<Option<ContinuationToken>, ProviderError> {
        self.active_turn
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| {
                ProviderError::RequestFailed("Cursor native active turn lock poisoned".to_string())
            })
    }

    fn take_pending_run(&self) -> Result<Option<PendingCursorRun>, ProviderError> {
        let active_token = self.active_token()?;
        let mut guard = self.pending_run.lock().map_err(|_| {
            ProviderError::RequestFailed("Cursor native pending run lock poisoned".to_string())
        })?;
        let Some(pending) = guard.take() else {
            return Ok(None);
        };
        if pending.token.is_none() || active_token == pending.token {
            Ok(Some(pending))
        } else {
            if let Some(token) = pending.token.as_ref() {
                info!(
                    "[cursor] dropping pending run at logical turn boundary (pending_session={} pending_turn={})",
                    token.session_id, token.turn_id
                );
            }
            Ok(None)
        }
    }

    fn store_paused_run(&self, paused_run: Option<PendingCursorRun>) -> Result<(), ProviderError> {
        *self.pending_run.lock().map_err(|_| {
            ProviderError::RequestFailed("Cursor native pending run lock poisoned".to_string())
        })? = paused_run;
        Ok(())
    }

    fn conversation_id(&self) -> Result<String, ProviderError> {
        self.conversation_id
            .lock()
            .map(|id| id.clone())
            .map_err(|_| {
                ProviderError::RequestFailed(
                    "Cursor native conversation id lock poisoned".to_string(),
                )
            })
    }

    fn set_stable_conversation_id(&self, session_id: &str) {
        let trimmed = session_id.trim();
        if trimmed.is_empty() {
            return;
        }
        let stable_id = stable_conversation_id(trimmed);
        match self.conversation_id.lock() {
            Ok(mut id) => {
                *id = stable_id;
            }
            Err(_) => {
                warn!("[cursor] failed to set stable conversation id: lock poisoned");
            }
        }
    }

    pub fn from_session_token(session_token: &str) -> Result<Self, ProviderError> {
        Self::from_session_token_with_workspace(session_token, None)
    }

    pub fn from_session_token_with_workspace(
        session_token: &str,
        workspace_context: Option<CursorNativeWorkspaceContext>,
    ) -> Result<Self, ProviderError> {
        let jwt = auth::extract_jwt(session_token);
        if jwt.trim().is_empty() {
            return Err(ProviderError::AuthError(
                "Cursor native provider requires a non-empty session token".to_string(),
            ));
        }
        if auth::is_web_session_token(session_token) {
            return Err(ProviderError::AuthError(
                "Cursor web login tokens cannot be used for native chat; please sign in again"
                    .to_string(),
            ));
        }
        Ok(Self::new_with_workspace(
            ProviderConfig {
                api_key: session_token.to_string(),
                api_base: Some(auth::CURSOR_API_BASE.to_string()),
                extra_headers: HashMap::new(),
                is_azure: false,
            },
            workspace_context,
        ))
    }

    /// Build a client from a resolved [`ProviderConfig`]. `config.api_key`
    /// must hold the session JWT (raw or URL-encoded `userId::jwt`). The
    /// caller — `factory.rs` — handles credential resolution.
    pub fn new(config: ProviderConfig) -> Self {
        Self::new_with_workspace(config, None)
    }

    pub fn new_with_workspace(
        config: ProviderConfig,
        workspace_context: Option<CursorNativeWorkspaceContext>,
    ) -> Self {
        let http = Client::builder()
            .user_agent(format!("cursor/{}", auth::cursor_client_version()))
            // Explicitly force rustls over the default TLS backend. reqwest
            // 0.11 only ships both backends as compile-time options; the
            // runtime default is native-tls, whose macOS SecureTransport
            // backend does not advertise `h2` in ALPN. api2.cursor.sh's
            // ALB routes `/agent.v1.AgentService/Run` to an HTTP/2-only
            // target group and returns HTTP 464 ("incompatible protocol
            // versions") when it sees an HTTP/1.1 request. Rustls's ALPN
            // config advertises both `h2` and `http/1.1`, so the server
            // picks HTTP/2 and the request is routed correctly.
            .use_rustls_tls()
            .build()
            // Fall back to the global default if custom-build fails — should
            // never happen in practice since we only set user-agent.
            .unwrap_or_else(|_| Client::new());
        Self {
            config,
            http,
            default_model: DEFAULT_MODEL.to_string(),
            conversation_id: Mutex::new(uuid::Uuid::new_v4().to_string()),
            workspace_context,
            active_turn: Mutex::new(None),
            pending_run: Mutex::new(None),
        }
    }
}

#[async_trait]
impl LLMProvider for CursorNativeProvider {
    /// Non-streaming variant: drive [`Self::chat_streaming`] with a no-op
    /// delta callback and return the aggregated response. Saves us from
    /// duplicating the Run loop for callers that don't want per-chunk
    /// events.
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        let noop = |_: StreamDelta| {};
        self.chat_streaming(messages, tools, model, max_tokens, temperature, &noop, None)
            .await
    }

    async fn chat_streaming(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        _max_tokens: u32,
        _temperature: f32,
        on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
        cancel_flag: Option<&AtomicBool>,
    ) -> Result<LLMResponse, ProviderError> {
        let jwt = auth::extract_jwt(&self.config.api_key);
        if jwt.is_empty() {
            return Err(ProviderError::AuthError(
                "Cursor account has no session token — sign into Cursor Desktop first".to_string(),
            ));
        }

        let effective_model = if model.is_empty() {
            self.default_model.as_str()
        } else {
            model
        };

        let should_manage_tool_continuation = tools.is_some();
        let tool_definitions = tools
            .map(build_tool_definitions)
            .unwrap_or_default()
            .into_iter()
            .filter(|definition| should_expose_as_cursor_native_mcp_tool(&definition.tool_name))
            .collect::<Vec<_>>();

        info!(
            "[cursor] chat_streaming: model={}, messages={}, tools={}, workspace={}",
            effective_model,
            messages.len(),
            tool_definitions.len(),
            self.workspace_context
                .as_ref()
                .map(describe_workspace_context)
                .unwrap_or_else(|| "<none>".to_string())
        );

        let current_user_request = current_user_request_from_messages(messages);
        let active_token = self.active_token()?;
        let pending_run = if should_manage_tool_continuation {
            self.take_pending_run()?
        } else {
            None
        };
        let outcome = if let Some(pending) = pending_run {
            let Some(tool_result) = find_tool_result(messages, &pending.tool_call.id) else {
                let available_tool_results: Vec<String> = messages
                    .iter()
                    .filter(|message| message.get("role").and_then(Value::as_str) == Some("tool"))
                    .filter_map(|message| {
                        let id = message.get("tool_call_id").and_then(Value::as_str)?;
                        let name = message
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("<unknown>");
                        Some(format!("{id}:{name}"))
                    })
                    .collect();
                return Err(ProviderError::RequestFailed(format!(
                    "Cursor native pending tool result missing for {} (pending_name={}, available_tool_results={:?}, message_count={})",
                    pending.tool_call.id,
                    pending.tool_call.name,
                    available_tool_results,
                    messages.len()
                )));
            };
            info!(
                "[cursor] continuing paused run with tool result id={} name={}",
                pending.tool_call.id, pending.tool_call.name
            );
            send_tool_result_to_paused_run(&pending, tool_result)?;
            if continuation_policy_for_tool(&pending.tool_call.name)
                == ToolContinuationPolicy::EndLogicalTurn
            {
                info!(
                    "[cursor] completed terminal tool result for {}; ending logical turn without resuming Cursor stream",
                    pending.tool_call.name
                );
                return Ok(LLMResponse {
                    content: None,
                    tool_calls: Vec::new(),
                    finish_reason: finish_reason::STOP.to_string(),
                    usage: HashMap::new(),
                    reasoning_content: None,
                    blocks: Vec::new(),
                    stream_error_kind: None,
                    retry_after_ms: None,
                });
            }
            let completed_same_stream_tool_ids = HashSet::from([pending.tool_call.id.clone()]);
            drive_run(
                pending.stream,
                pending.blobs,
                pending.tool_definitions,
                self.workspace_context.as_ref(),
                pending.current_user_request.clone(),
                &completed_same_stream_tool_ids,
                on_delta,
                cancel_flag,
                pending.token.clone(),
            )
            .await?
        } else {
            let request_context =
                build_request_context(&tool_definitions, self.workspace_context.as_ref());
            if !tool_definitions.is_empty() {
                let tool_names = tool_definitions
                    .iter()
                    .map(|definition| definition.tool_name.as_str())
                    .collect::<Vec<_>>()
                    .join(",");
                info!(
                    "[cursor] mcp tool definitions count={} names=[{}] request_context={}",
                    tool_definitions.len(),
                    tool_names,
                    request_context.is_some()
                );
            }
            let built = build_run_request_with_context(
                messages,
                effective_model,
                self.conversation_id()?,
                request_context,
            );
            let stream = match tokio::time::timeout(
                OVERALL_TIMEOUT,
                client::start_run(&self.http, &jwt, built.client_message),
            )
            .await
            {
                Ok(Ok(stream)) => stream,
                Ok(Err(err)) => return Err(map_client_error(err)),
                Err(_elapsed) => {
                    return Err(ProviderError::RequestFailed(
                        "Cursor Run RPC did not respond within 5 minutes".to_string(),
                    ));
                }
            };

            drive_run(
                stream,
                built.blobs,
                tool_definitions,
                self.workspace_context.as_ref(),
                current_user_request,
                &HashSet::new(),
                on_delta,
                cancel_flag,
                active_token.clone(),
            )
            .await?
        };
        if should_manage_tool_continuation {
            self.store_paused_run(outcome.paused_run)?;
        }
        Ok(outcome.response)
    }

    fn default_model(&self) -> &str {
        &self.default_model
    }

    fn provider_name(&self) -> &str {
        PROVIDER_NAME
    }

    fn set_session_context(&self, session_id: &str) {
        self.set_stable_conversation_id(session_id);
    }

    fn begin_logical_turn(&self, session_id: &str, turn_id: &str) {
        let token = ContinuationToken {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            kind: ContinuationKind::SameStreamToolResult,
        };
        match self.active_turn.lock() {
            Ok(mut active_turn) => {
                *active_turn = Some(token.clone());
            }
            Err(_) => {
                warn!("[cursor] active turn lock poisoned while beginning logical turn");
                return;
            }
        }
        if let Ok(mut pending_run) = self.pending_run.lock() {
            let should_drop = pending_run
                .as_ref()
                .and_then(|pending| pending.token.as_ref())
                .is_some_and(|pending_token| pending_token != &token);
            if should_drop {
                info!(
                    "[cursor] invalidating pending continuation for new logical turn (session={} turn={})",
                    session_id, turn_id
                );
                *pending_run = None;
            }
        }
    }

    fn side_query_execution(&self) -> SideQueryExecution {
        SideQueryExecution::IsolatedSession
    }
}

/// Consume the live Run stream: translate server messages into `StreamDelta`,
/// satisfy KV / exec side-channel requests, accumulate the final
/// `LLMResponse`.
///
/// `tool_definitions` are the `McpToolDefinition` list we hand back when the
/// server asks via `ExecServerMessage::RequestContextArgs`. Empty when the
/// caller didn't pass tools.
async fn drive_run(
    mut stream: RunStream,
    mut blobs: BlobStore,
    tool_definitions: Vec<pb::McpToolDefinition>,
    workspace_context: Option<&CursorNativeWorkspaceContext>,
    current_user_request: Option<String>,
    completed_same_stream_tool_ids: &HashSet<String>,
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
    cancel_flag: Option<&AtomicBool>,
    continuation_token: Option<ContinuationToken>,
) -> Result<CursorRunOutcome, ProviderError> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut total_output_tokens: i64 = 0;
    let mut saw_turn_end = false;
    let mut pending_tool_calls: Vec<ToolCallRequest> = Vec::new();
    let mut interaction_tool_streams = InteractionToolStreamState::default();
    let mut exec_tool_pause: Option<ExecToolPause> = None;

    loop {
        let result = match tokio::time::timeout(STREAM_IDLE_TIMEOUT, stream.responses.next()).await
        {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_elapsed) => {
                return Err(ProviderError::RequestFailed(format!(
                    "Cursor Run stream timed out: no server message received for {}s \
                     (content_len={}, reasoning_len={}, pending_tools={}, saw_turn_end={})",
                    STREAM_IDLE_TIMEOUT.as_secs(),
                    content.len(),
                    reasoning.len(),
                    pending_tool_calls.len(),
                    saw_turn_end
                )));
            }
        };

        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            debug!("[cursor] cancel requested; dropping run stream");
            return Err(ProviderError::Cancelled);
        }

        let message = match result {
            Ok(m) => m,
            Err(err) => return Err(map_client_error(err)),
        };

        let Some(inner) = message.message else {
            continue;
        };

        let variant_name = server_message_variant_name(&inner);
        debug!("[cursor] server message variant: {variant_name}");

        match inner {
            pb::agent_server_message::Message::InteractionUpdate(update) => {
                debug!(
                    "[cursor] interaction update variant: {}",
                    interaction_update_variant_name(&update)
                );
                if let Some(tool_call) = handle_interaction_update(
                    update,
                    &mut content,
                    &mut reasoning,
                    &mut total_output_tokens,
                    &mut saw_turn_end,
                    completed_same_stream_tool_ids,
                    &mut interaction_tool_streams,
                    on_delta,
                ) {
                    let index = interaction_tool_streams.index_for_orgii_call_id(&tool_call.id);
                    if !interaction_tool_streams.has_emitted_partial(&tool_call.id) {
                        let argument_deltas = complete_tool_call_argument_deltas(&tool_call);
                        let argument_delta_count = argument_deltas.len();
                        for (delta_offset, arguments_delta) in
                            argument_deltas.into_iter().enumerate()
                        {
                            on_delta(StreamDelta {
                                content: None,
                                reasoning: None,
                                tool_call_delta: Some(ToolCallDelta {
                                    index,
                                    id: Some(tool_call.id.clone()),
                                    name: Some(tool_call.name.clone()),
                                    arguments_delta: Some(arguments_delta),
                                }),
                                finish_reason: None,
                                usage: None,
                            });
                            if argument_delta_count > 1 && delta_offset + 1 < argument_delta_count {
                                tokio::time::sleep(COMPLETE_TOOL_CALL_DRAFT_FLUSH_DELAY).await;
                            }
                        }
                    }
                    info!(
                        "[cursor] interaction requested MCP tool call: id={} name={}",
                        tool_call.id, tool_call.name
                    );
                    pending_tool_calls.push(tool_call);
                    break;
                }
                if saw_turn_end {
                    break;
                }
            }
            pb::agent_server_message::Message::KvServerMessage(kv) => {
                if let Err(err) = reply_to_kv(&stream, kv, &mut blobs) {
                    return Err(map_client_error(err));
                }
            }
            pb::agent_server_message::Message::ExecServerMessage(exec) => {
                match handle_exec_server_message(
                    &stream,
                    exec,
                    &tool_definitions,
                    workspace_context,
                ) {
                    Ok(Some(pause)) => {
                        let index = pending_tool_calls.len();
                        let argument_deltas = complete_tool_call_argument_deltas(&pause.tool_call);
                        let argument_delta_count = argument_deltas.len();
                        for (delta_offset, arguments_delta) in
                            argument_deltas.into_iter().enumerate()
                        {
                            on_delta(StreamDelta {
                                content: None,
                                reasoning: None,
                                tool_call_delta: Some(ToolCallDelta {
                                    index,
                                    id: Some(pause.tool_call.id.clone()),
                                    name: Some(pause.tool_call.name.clone()),
                                    arguments_delta: Some(arguments_delta),
                                }),
                                finish_reason: None,
                                usage: None,
                            });
                            if argument_delta_count > 1 && delta_offset + 1 < argument_delta_count {
                                tokio::time::sleep(COMPLETE_TOOL_CALL_DRAFT_FLUSH_DELAY).await;
                            }
                        }
                        pending_tool_calls.push(pause.tool_call.clone());
                        exec_tool_pause = Some(pause);
                        break;
                    }
                    Ok(None) => {}
                    Err(err) => return Err(map_client_error(err)),
                }
            }
            pb::agent_server_message::Message::ConversationCheckpointUpdate(_) => {}
            // ExecServerControlMessage / InteractionQuery arrive on advanced
            // flows (plan mode, worker summaries). Ignoring them is safe for
            // the MVP request/reply pattern.
            other => {
                debug!("[cursor] unhandled server message variant: {:?}", other);
            }
        }
    }

    let has_tool_calls = !pending_tool_calls.is_empty();
    if !saw_turn_end && !has_tool_calls {
        // Unexpected but tolerable: server closed the stream without a
        // terminal update. Surface accumulated content rather than panicking.
        debug!(
            "[cursor] stream ended without TurnEndedUpdate and no tool calls (content_len={})",
            content.len()
        );
    }

    let mut usage = HashMap::new();
    if total_output_tokens > 0 {
        usage.insert(
            usage_key::COMPLETION_TOKENS.to_string(),
            total_output_tokens,
        );
        usage.insert(usage_key::TOTAL_TOKENS.to_string(), total_output_tokens);
    }

    // finish_reason reflects which terminal condition fired:
    // - tool_calls when the server asked us to invoke one or more tools
    //   (ORGII's agent loop will execute them and call us again).
    // - stop otherwise.
    let resolved_finish = if has_tool_calls {
        finish_reason::TOOL_CALLS.to_string()
    } else {
        finish_reason::STOP.to_string()
    };

    let response = LLMResponse {
        content: (!content.is_empty()).then_some(content),
        tool_calls: pending_tool_calls,
        finish_reason: resolved_finish,
        usage,
        reasoning_content: (!reasoning.is_empty()).then_some(reasoning),
        blocks: Vec::new(),
        stream_error_kind: None,
        retry_after_ms: None,
    };
    let paused_run = exec_tool_pause.and_then(|pause| {
        if !pause.requires_same_stream_result {
            return None;
        }
        if continuation_policy_for_tool(&pause.tool_call.name)
            == ToolContinuationPolicy::EndLogicalTurn
        {
            info!(
                "[cursor] dropping same-stream continuation for local end-turn tool {}",
                pause.tool_call.name
            );
            return None;
        }
        Some(PendingCursorRun {
            token: continuation_token,
            stream,
            blobs,
            tool_definitions,
            exec_id: pause.exec_id,
            exec_message_id: pause.exec_message_id,
            tool_call: pause.tool_call,
            result_kind: pause.result_kind,
            current_user_request,
        })
    });
    Ok(CursorRunOutcome {
        response,
        paused_run,
    })
}

fn continuation_policy_for_tool(tool_name: &str) -> ToolContinuationPolicy {
    match tool_name {
        tool_names::CREATE_PLAN | tool_names::SUGGEST_MODE_SWITCH => {
            ToolContinuationPolicy::EndLogicalTurn
        }
        _ => ToolContinuationPolicy::ContinueSameStream,
    }
}

fn find_tool_result<'a>(messages: &'a [Value], tool_call_id: &str) -> Option<&'a Value> {
    messages.iter().rev().find(|message| {
        message.get("role").and_then(Value::as_str) == Some("tool")
            && message.get("tool_call_id").and_then(Value::as_str) == Some(tool_call_id)
    })
}

fn current_user_request_from_messages(messages: &[Value]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .map(message_content_text)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn message_content_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<String>(),
        _ => String::new(),
    }
}

fn tool_result_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

fn mcp_same_stream_result_text(result_text: &str, current_user_request: Option<&str>) -> String {
    let Some(request) = current_user_request
        .map(str::trim)
        .filter(|request| !request.is_empty())
    else {
        return result_text.to_string();
    };
    format!("{result_text}\n\n<current_user_request>\n{request}\n</current_user_request>")
}

fn send_tool_result_to_paused_run(
    pending: &PendingCursorRun,
    tool_result: &Value,
) -> Result<(), ProviderError> {
    let result_text = match pending.result_kind {
        ToolResultKind::Mcp => mcp_same_stream_result_text(
            &tool_result_text(tool_result),
            pending.current_user_request.as_deref(),
        ),
        ToolResultKind::Native => tool_result_text(tool_result),
    };
    let call = HistoricToolCall {
        tool_call_id: pending.tool_call.id.clone(),
        tool_name: pending.tool_call.name.clone(),
        arguments: pending.tool_call.arguments.clone(),
        result_text,
    };
    let result_message = match pending.result_kind {
        ToolResultKind::Mcp => encode_mcp_exec_tool_result_message(&call),
        ToolResultKind::Native => encode_exec_tool_result_message(&call),
    };
    pending
        .stream
        .send(&pb::AgentClientMessage {
            message: Some(pb::agent_client_message::Message::ExecClientMessage(
                pb::ExecClientMessage {
                    id: pending.exec_message_id,
                    exec_id: pending.exec_id.clone(),
                    message: Some(result_message),
                },
            )),
        })
        .map_err(map_client_error)?;
    pending
        .stream
        .send(&pb::AgentClientMessage {
            message: Some(pb::agent_client_message::Message::ExecClientControlMessage(
                pb::ExecClientControlMessage {
                    message: Some(pb::exec_client_control_message::Message::StreamClose(
                        pb::ExecClientStreamClose {
                            id: pending.exec_message_id,
                        },
                    )),
                },
            )),
        })
        .map_err(map_client_error)
}

fn interaction_update_variant_name(update: &pb::InteractionUpdate) -> &'static str {
    match update.message.as_ref() {
        Some(pb::interaction_update::Message::TextDelta(_)) => "TextDelta",
        Some(pb::interaction_update::Message::PartialToolCall(_)) => "PartialToolCall",
        Some(pb::interaction_update::Message::ToolCallDelta(_)) => "ToolCallDelta",
        Some(pb::interaction_update::Message::ToolCallStarted(_)) => "ToolCallStarted",
        Some(pb::interaction_update::Message::ToolCallCompleted(_)) => "ToolCallCompleted",
        Some(pb::interaction_update::Message::ThinkingDelta(_)) => "ThinkingDelta",
        Some(pb::interaction_update::Message::ThinkingCompleted(_)) => "ThinkingCompleted",
        Some(pb::interaction_update::Message::UserMessageAppended(_)) => "UserMessageAppended",
        Some(pb::interaction_update::Message::TokenDelta(_)) => "TokenDelta",
        Some(pb::interaction_update::Message::Summary(_)) => "Summary",
        Some(pb::interaction_update::Message::SummaryStarted(_)) => "SummaryStarted",
        Some(pb::interaction_update::Message::SummaryCompleted(_)) => "SummaryCompleted",
        Some(pb::interaction_update::Message::ShellOutputDelta(_)) => "ShellOutputDelta",
        Some(pb::interaction_update::Message::Heartbeat(_)) => "Heartbeat",
        Some(pb::interaction_update::Message::TurnEnded(_)) => "TurnEnded",
        Some(pb::interaction_update::Message::StepStarted(_)) => "StepStarted",
        Some(pb::interaction_update::Message::StepCompleted(_)) => "StepCompleted",
        None => "None",
    }
}

fn server_message_variant_name(message: &pb::agent_server_message::Message) -> &'static str {
    match message {
        pb::agent_server_message::Message::InteractionUpdate(_) => "InteractionUpdate",
        pb::agent_server_message::Message::ExecServerMessage(_) => "ExecServerMessage",
        pb::agent_server_message::Message::ExecServerControlMessage(_) => {
            "ExecServerControlMessage"
        }
        pb::agent_server_message::Message::ConversationCheckpointUpdate(_) => {
            "ConversationCheckpointUpdate"
        }
        pb::agent_server_message::Message::KvServerMessage(_) => "KvServerMessage",
        pb::agent_server_message::Message::InteractionQuery(_) => "InteractionQuery",
    }
}

fn exec_message_variant_name(message: &pb::exec_server_message::Message) -> &'static str {
    match message {
        pb::exec_server_message::Message::RequestContextArgs(_) => "RequestContextArgs",
        pb::exec_server_message::Message::McpArgs(_) => "McpArgs",
        pb::exec_server_message::Message::ReadArgs(_) => "ReadArgs",
        pb::exec_server_message::Message::LsArgs(_) => "LsArgs",
        pb::exec_server_message::Message::GrepArgs(_) => "GrepArgs",
        pb::exec_server_message::Message::WriteArgs(_) => "WriteArgs",
        pb::exec_server_message::Message::DeleteArgs(_) => "DeleteArgs",
        pb::exec_server_message::Message::ShellArgs(_) => "ShellArgs",
        pb::exec_server_message::Message::ShellStreamArgs(_) => "ShellStreamArgs",
        pb::exec_server_message::Message::BackgroundShellSpawnArgs(_) => "BackgroundShellSpawnArgs",
        pb::exec_server_message::Message::WriteShellStdinArgs(_) => "WriteShellStdinArgs",
        pb::exec_server_message::Message::DiagnosticsArgs(_) => "DiagnosticsArgs",
        pb::exec_server_message::Message::ListMcpResourcesExecArgs(_) => "ListMcpResourcesExecArgs",
        pb::exec_server_message::Message::ReadMcpResourceExecArgs(_) => "ReadMcpResourceExecArgs",
        pb::exec_server_message::Message::FetchArgs(_) => "FetchArgs",
        pb::exec_server_message::Message::RecordScreenArgs(_) => "RecordScreenArgs",
        pb::exec_server_message::Message::ComputerUseArgs(_) => "ComputerUseArgs",
    }
}

fn should_expose_as_cursor_native_mcp_tool(_tool_name: &str) -> bool {
    true
}

fn build_request_context(
    tool_definitions: &[pb::McpToolDefinition],
    workspace_context: Option<&CursorNativeWorkspaceContext>,
) -> Option<pb::RequestContext> {
    if tool_definitions.is_empty() && workspace_context.is_none() {
        return None;
    }

    Some(pb::RequestContext {
        env: workspace_context.map(|context| pb::RequestContextEnv {
            workspace_paths: context
                .workspace_paths
                .iter()
                .map(|path| display_path(path))
                .collect(),
            project_folder: display_path(&context.project_folder),
            shell: default_shell(),
            os_version: std::env::consts::OS.to_string(),
            sandbox_enabled: false,
            terminals_folder: String::new(),
            agent_shared_notes_folder: String::new(),
            agent_conversation_notes_folder: String::new(),
            time_zone: String::new(),
            agent_transcripts_folder: String::new(),
        }),
        tools: tool_definitions.to_vec(),
        mcp_instructions: Vec::new(),
        ..Default::default()
    })
}

fn describe_workspace_context(context: &CursorNativeWorkspaceContext) -> String {
    format!(
        "project={}, roots=[{}]",
        display_path(&context.project_folder),
        context
            .workspace_paths
            .iter()
            .map(|path| display_path(path))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(unix)]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(windows)]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[derive(Clone)]
struct InteractionToolStreamEntry {
    orgii_call_id: String,
    tool_name: Option<String>,
    index: usize,
}

#[derive(Default)]
struct InteractionToolStreamState {
    entries_by_cursor_call_id: HashMap<String, InteractionToolStreamEntry>,
    partial_orgii_call_ids: HashSet<String>,
    next_index: usize,
}

fn complete_tool_call_argument_deltas(tool_call: &ToolCallRequest) -> Vec<String> {
    if tool_call.name == tool_names::CREATE_PLAN {
        let title = tool_call.arguments.get("title").and_then(Value::as_str);
        let content = tool_call.arguments.get("content").and_then(Value::as_str);
        if let (Some(title), Some(content)) = (title, content) {
            let encoded_title = serde_json::to_string(title)
                .expect("serializing create_plan title string cannot fail");
            let encoded_content = serde_json::to_string(content)
                .expect("serializing create_plan content string cannot fail");
            return vec![
                format!("{{\"title\":{encoded_title}"),
                format!(",\"content\":{encoded_content}}}"),
            ];
        }
    }

    vec![tool_call.arguments.to_string()]
}

impl InteractionToolStreamState {
    fn register(&mut self, cursor_call_id: &str, tool_call: Option<&pb::ToolCall>) {
        let orgii_call_id = tool_call
            .and_then(extract_mcp_args)
            .map(|args| {
                if args.tool_call_id.is_empty() {
                    cursor_call_id.to_string()
                } else {
                    args.tool_call_id.clone()
                }
            })
            .unwrap_or_else(|| cursor_tool_call_id(cursor_call_id));
        let tool_name = tool_call.and_then(extract_mcp_args).map(|args| {
            crate::providers::cursor_native::tools::resolve_cursor_mcp_tool_name(
                &args.name,
                &args.tool_name,
            )
        });
        let index = self
            .entries_by_cursor_call_id
            .get(cursor_call_id)
            .map(|entry| entry.index)
            .unwrap_or_else(|| {
                let index = self.next_index;
                self.next_index += 1;
                index
            });
        self.entries_by_cursor_call_id.insert(
            cursor_call_id.to_string(),
            InteractionToolStreamEntry {
                orgii_call_id,
                tool_name,
                index,
            },
        );
    }

    fn entry_for_cursor_call_id(&mut self, cursor_call_id: &str) -> InteractionToolStreamEntry {
        if !self.entries_by_cursor_call_id.contains_key(cursor_call_id) {
            self.register(cursor_call_id, None);
        }
        self.entries_by_cursor_call_id
            .get(cursor_call_id)
            .cloned()
            .expect("interaction tool stream entry registered")
    }

    fn index_for_orgii_call_id(&mut self, orgii_call_id: &str) -> usize {
        if let Some(entry) = self
            .entries_by_cursor_call_id
            .values()
            .find(|entry| entry.orgii_call_id == orgii_call_id)
        {
            entry.index
        } else {
            let index = self.next_index;
            self.next_index += 1;
            index
        }
    }

    fn mark_partial(&mut self, orgii_call_id: &str) {
        self.partial_orgii_call_ids
            .insert(orgii_call_id.to_string());
    }

    fn has_emitted_partial(&self, orgii_call_id: &str) -> bool {
        self.partial_orgii_call_ids.contains(orgii_call_id)
    }
}

/// Dispatch a single `InteractionUpdate` into the accumulators + on_delta.
fn handle_interaction_update(
    update: pb::InteractionUpdate,
    content: &mut String,
    reasoning: &mut String,
    output_tokens: &mut i64,
    saw_turn_end: &mut bool,
    completed_same_stream_tool_ids: &HashSet<String>,
    interaction_tool_streams: &mut InteractionToolStreamState,
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
) -> Option<ToolCallRequest> {
    let inner = update.message?;
    match inner {
        pb::interaction_update::Message::TextDelta(d) => {
            if !d.text.is_empty() {
                content.push_str(&d.text);
                on_delta(StreamDelta {
                    content: Some(d.text),
                    reasoning: None,
                    tool_call_delta: None,
                    finish_reason: None,
                    usage: None,
                });
            }
        }
        pb::interaction_update::Message::ThinkingDelta(d) => {
            if !d.text.is_empty() {
                reasoning.push_str(&d.text);
                on_delta(StreamDelta {
                    content: None,
                    reasoning: Some(d.text),
                    tool_call_delta: None,
                    finish_reason: None,
                    usage: None,
                });
            }
        }
        pb::interaction_update::Message::TokenDelta(d) => {
            *output_tokens = output_tokens.saturating_add(d.tokens as i64);
        }
        pb::interaction_update::Message::TurnEnded(_) => {
            *saw_turn_end = true;
            on_delta(StreamDelta {
                content: None,
                reasoning: None,
                tool_call_delta: None,
                finish_reason: Some(finish_reason::STOP.to_string()),
                usage: None,
            });
        }
        pb::interaction_update::Message::ToolCallStarted(update) => {
            log_interaction_tool_call("started", &update.call_id, update.tool_call.as_ref());
            interaction_tool_streams.register(&update.call_id, update.tool_call.as_ref());
        }
        pb::interaction_update::Message::PartialToolCall(update) => {
            interaction_tool_streams.register(&update.call_id, update.tool_call.as_ref());
            if !update.args_text_delta.is_empty() {
                let entry = interaction_tool_streams.entry_for_cursor_call_id(&update.call_id);
                interaction_tool_streams.mark_partial(&entry.orgii_call_id);
                on_delta(StreamDelta {
                    content: None,
                    reasoning: None,
                    tool_call_delta: Some(ToolCallDelta {
                        index: entry.index,
                        id: Some(entry.orgii_call_id),
                        name: entry.tool_name,
                        arguments_delta: Some(update.args_text_delta),
                    }),
                    finish_reason: None,
                    usage: None,
                });
            }
        }
        pb::interaction_update::Message::ToolCallCompleted(update) => {
            interaction_tool_streams.register(&update.call_id, update.tool_call.as_ref());
            if completed_same_stream_tool_ids.contains(&update.call_id)
                || update
                    .tool_call
                    .as_ref()
                    .and_then(extract_mcp_args)
                    .is_some_and(|args| completed_same_stream_tool_ids.contains(&args.tool_call_id))
            {
                info!(
                    "[cursor] ignoring completed MCP tool-call echo after same-stream result call_id={}",
                    update.call_id
                );
                return None;
            }
            return interaction_tool_call_to_orgii_request(
                &update.call_id,
                update.tool_call.as_ref(),
            );
        }
        // Non-MCP native tools get their authoritative args from
        // `ExecServerMessage`. Delta lifecycle updates are not executable on
        // their own because args may be incomplete.
        _ => {}
    }
    None
}

/// Reply to a server KV request (blob get / set) on the open stream.
fn reply_to_kv(
    stream: &RunStream,
    kv: pb::KvServerMessage,
    blobs: &mut BlobStore,
) -> Result<(), ClientError> {
    let id = kv.id;
    let Some(inner) = kv.message else {
        return Ok(());
    };
    let response = match inner {
        pb::kv_server_message::Message::GetBlobArgs(args) => {
            let blob_data = blobs.get(&args.blob_id).cloned();
            if blob_data.is_none() {
                warn!(
                    "[cursor] server requested unknown blob (id_bytes_len={})",
                    args.blob_id.len()
                );
            }
            pb::KvClientMessage {
                id,
                message: Some(pb::kv_client_message::Message::GetBlobResult(
                    pb::GetBlobResult { blob_data },
                )),
            }
        }
        pb::kv_server_message::Message::SetBlobArgs(args) => {
            blobs.insert(args.blob_id, args.blob_data);
            pb::KvClientMessage {
                id,
                message: Some(pb::kv_client_message::Message::SetBlobResult(
                    pb::SetBlobResult { error: None },
                )),
            }
        }
    };
    stream.send(&pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::KvClientMessage(response)),
    })
}

fn cursor_mcp_tool_name(args: &pb::McpArgs) -> &str {
    if args.tool_name.is_empty() {
        &args.name
    } else {
        &args.tool_name
    }
}

fn extract_mcp_args(tool_call: &pb::ToolCall) -> Option<&pb::McpArgs> {
    match tool_call.tool.as_ref()? {
        pb::tool_call::Tool::McpToolCall(mcp_tool_call) => mcp_tool_call.args.as_ref(),
        _ => None,
    }
}

fn log_interaction_tool_call(stage: &str, call_id: &str, tool_call: Option<&pb::ToolCall>) {
    if let Some(args) = tool_call.and_then(extract_mcp_args) {
        let arg_keys = args.args.keys().cloned().collect::<Vec<_>>().join(",");
        info!(
            "[cursor] interaction {} MCP tool call: call_id={} tool_call_id={} name={} arg_keys=[{}]",
            stage,
            call_id,
            args.tool_call_id,
            cursor_mcp_tool_name(args),
            arg_keys
        );
    }
}

fn interaction_tool_call_to_orgii_request(
    call_id: &str,
    tool_call: Option<&pb::ToolCall>,
) -> Option<ToolCallRequest> {
    let tool_call = tool_call?;
    match tool_call.tool.as_ref()? {
        pb::tool_call::Tool::McpToolCall(mcp_tool_call) => {
            let args = mcp_tool_call.args.as_ref()?;
            let arg_keys = args.args.keys().cloned().collect::<Vec<_>>().join(",");
            info!(
                "[cursor] interaction completed MCP tool call: id={} name={} arg_keys=[{}]",
                call_id,
                cursor_mcp_tool_name(args),
                arg_keys
            );
            if args.args.is_empty() {
                return None;
            }
            Some(mcp_args_to_tool_call(args))
        }
        pb::tool_call::Tool::TaskToolCall(task_tool_call) => task_tool_call
            .args
            .as_ref()
            .map(|args| cursor_task_to_agent_tool_call(call_id, args)),
        _ => None,
    }
}

fn cursor_task_to_agent_tool_call(call_id: &str, args: &pb::TaskArgs) -> ToolCallRequest {
    let agent_id = cursor_subagent_type_to_agent_id(args.subagent_type.as_ref());
    let mut arguments = serde_json::json!({
        "command": "launch",
        "mode": "delegate",
        "agent_id": agent_id,
        "prompt": args.prompt,
        "description": args.description,
    });
    if let Some(model) = args.model.as_ref().filter(|model| !model.is_empty()) {
        arguments["model"] = serde_json::json!(model);
    }
    if let Some(resume) = args.resume.as_ref().filter(|resume| !resume.is_empty()) {
        arguments["resume_session_id"] = serde_json::json!(resume);
    }
    ToolCallRequest {
        id: cursor_tool_call_id(call_id),
        name: tool_names::AGENT.to_string(),
        arguments,
        thought_signature: None,
    }
}

fn cursor_subagent_type_to_agent_id(subagent_type: Option<&pb::SubagentType>) -> &'static str {
    match subagent_type.and_then(|value| value.r#type.as_ref()) {
        Some(pb::subagent_type::Type::Explore(_)) => EXPLORE_AGENT_ID,
        _ => GENERAL_AGENT_ID,
    }
}

const MCP_NATIVE_FALLBACK_REJECTION: &str =
    "Cursor native tools are not available in this environment. Use MCP tools from provider `orgii` instead.";

fn tool_definitions_enable_mcp_native_rejection(
    tool_definitions: &[pb::McpToolDefinition],
) -> bool {
    !tool_definitions.is_empty()
}

fn shell_native_rejection(args: &pb::ShellArgs) -> pb::ShellResult {
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

fn is_orgii_mcp_args(args: &pb::McpArgs) -> bool {
    args.provider_identifier == CURSOR_MCP_PROVIDER_IDENTIFIER
        || args.name.starts_with("mcp__orgii__")
        || args.name.starts_with("mcp_orgii_")
}

fn mcp_fallback_rejection_result() -> pb::exec_client_message::Message {
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

fn mcp_native_fallback_result(
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

fn cursor_exec_to_tool_call(
    inner: &pb::exec_server_message::Message,
) -> Option<(ToolCallRequest, bool, ToolResultKind)> {
    match inner {
        pb::exec_server_message::Message::McpArgs(args) => {
            let arg_keys = args.args.keys().cloned().collect::<Vec<_>>().join(",");
            info!(
                "[cursor] native MCP args name={} tool_call_id={} arg_keys=[{}]",
                cursor_mcp_tool_name(args),
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

fn cursor_tool_call_id(tool_call_id: &str) -> String {
    if tool_call_id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        tool_call_id.to_string()
    }
}

fn cursor_write_content(args: &pb::WriteArgs) -> String {
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
fn handle_exec_server_message(
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
                cursor_mcp_tool_name(args),
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
/// [`ProviderError`] variants the retry layer understands.
///
/// Code mapping informed by Cursor's Connect trailers observed in practice;
/// task #8 exercises additional edge cases against a mock server.
fn map_client_error(err: ClientError) -> ProviderError {
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
                    // `deprecated` would only appear if Cursor deprecates
                    // agent.v1 the same way they did aiserver.v1; if that
                    // happens we'd need to switch endpoints, not fall back.
                    ProviderError::ModelNotFound(detail)
                }
                _ => ProviderError::Other(format!("Cursor Connect error {}: {}", code, message)),
            }
        }
        ClientError::Cancelled => ProviderError::Cancelled,
    }
}

fn summarise(body: String) -> String {
    let trimmed = &body[..body.len().min(300)];
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_error_unauthenticated_becomes_auth_error() {
        let err = ClientError::ConnectEnd {
            code: "unauthenticated".to_string(),
            message: "token expired".to_string(),
        };
        match map_client_error(err) {
            ProviderError::AuthError(msg) => {
                assert!(msg.contains("token expired"), "{}", msg);
                assert!(msg.contains("unauthenticated"), "code appended: {}", msg);
            }
            other => panic!("expected AuthError, got {:?}", other),
        }
    }

    #[test]
    fn map_error_resource_exhausted_becomes_rate_limited() {
        let err = ClientError::ConnectEnd {
            code: "resource_exhausted".to_string(),
            message: "quota".to_string(),
        };
        match map_client_error(err) {
            ProviderError::RateLimited { message, .. } => {
                assert!(message.contains("quota"), "{}", message);
                assert!(message.contains("resource_exhausted"), "code: {}", message);
            }
            other => panic!("expected RateLimited, got {:?}", other),
        }
    }

    /// Cursor's Connect trailers are often terse ("Error" with no
    /// structured detail). The mapper must surface the trailer *code*
    /// even when the message is useless, so operators can tell expired-
    /// JWT ("unauthenticated") apart from missing-subscription
    /// ("permission_denied") when reading logs.
    #[test]
    fn map_error_terse_server_message_still_includes_code() {
        let err = ClientError::ConnectEnd {
            code: "unauthenticated".to_string(),
            message: "Error".to_string(),
        };
        match map_client_error(err) {
            ProviderError::AuthError(msg) => {
                assert!(
                    msg.contains("unauthenticated"),
                    "trailer code in message: {}",
                    msg
                );
            }
            other => panic!("expected AuthError, got {:?}", other),
        }
    }

    /// `unavailable` is Cursor's overload signal — the retry layer uses a
    /// shorter budget for this class. Keep the mapping stable.
    #[test]
    fn map_error_unavailable_becomes_overloaded() {
        let err = ClientError::ConnectEnd {
            code: "unavailable".to_string(),
            message: "backend busy".to_string(),
        };
        assert!(matches!(
            map_client_error(err),
            ProviderError::Overloaded { .. }
        ));
    }

    #[test]
    fn map_error_not_found_becomes_model_not_found() {
        let err = ClientError::ConnectEnd {
            code: "not_found".to_string(),
            message: "model retired".to_string(),
        };
        assert!(matches!(
            map_client_error(err),
            ProviderError::ModelNotFound(_)
        ));
    }

    /// HTTP 401 before any stream data = JWT rejected at the HTTP layer
    /// (typically expired). Must produce `AuthError`, not `RequestFailed`.
    #[test]
    fn map_error_http_401_becomes_auth_error() {
        let err = ClientError::Status {
            status: 401,
            http_version: "HTTP/2.0".to_string(),
            body: "unauthorised".to_string(),
        };
        assert!(matches!(map_client_error(err), ProviderError::AuthError(_)));
    }

    /// HTTP 464 is AWS ALB's "incompatible protocol versions" signal —
    /// surfaced as a generic RequestFailed with the negotiated HTTP
    /// version embedded in the message so regressions are obvious.
    #[test]
    fn map_error_http_464_includes_protocol_version() {
        let err = ClientError::Status {
            status: 464,
            http_version: "HTTP/1.1".to_string(),
            body: String::new(),
        };
        match map_client_error(err) {
            ProviderError::RequestFailed(msg) => {
                assert!(msg.contains("464"), "status code preserved: {}", msg);
                assert!(
                    msg.contains("HTTP/1.1"),
                    "http version surfaced to caller: {}",
                    msg
                );
            }
            other => panic!("expected RequestFailed, got {:?}", other),
        }
    }

    #[test]
    fn map_error_cancelled_becomes_cancelled() {
        assert!(matches!(
            map_client_error(ClientError::Cancelled),
            ProviderError::Cancelled
        ));
    }

    #[test]
    fn request_context_advertises_mcp_tools_without_file_system_descriptors() {
        let definitions = build_tool_definitions(&[serde_json::json!({
            "type": "function",
            "function": {
                "name": tool_names::ORG_SEND_MESSAGE,
                "description": "Send a message",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "recipient_member_id": {
                            "type": "string",
                            "enum": ["coordinator"]
                        }
                    }
                }
            }
        })]);
        let context = build_request_context(&definitions, None).expect("request context");

        assert_eq!(context.tools.len(), 1);
        assert_eq!(context.tools[0].tool_name, tool_names::ORG_SEND_MESSAGE);
        assert!(context.mcp_file_system_options.is_none());
        assert!(context.mcp_instructions.is_empty());
    }

    #[test]
    fn map_error_permission_denied_becomes_auth_error() {
        let err = ClientError::ConnectEnd {
            code: "permission_denied".to_string(),
            message: "denied".to_string(),
        };
        assert!(matches!(map_client_error(err), ProviderError::AuthError(_)));
    }

    #[test]
    fn stable_conversation_id_is_session_scoped() {
        let first = stable_conversation_id("sdeagent-session-1");
        let same = stable_conversation_id("sdeagent-session-1");
        let different = stable_conversation_id("sdeagent-session-2");

        assert_eq!(first, same);
        assert_ne!(first, different);
        assert_eq!(first.len(), 36);
    }

    /// An unknown Connect trailer code shouldn't be lost — it needs to
    /// surface as a generic provider error with both code and message so
    /// the user can see what the server said.
    #[test]
    fn map_error_unknown_code_becomes_other_with_context() {
        let err = ClientError::ConnectEnd {
            code: "internal".to_string(),
            message: "boom".to_string(),
        };
        match map_client_error(err) {
            ProviderError::Other(msg) => {
                assert!(msg.contains("internal"), "code preserved: {}", msg);
                assert!(msg.contains("boom"), "message preserved: {}", msg);
            }
            other => panic!("expected Other, got {:?}", other),
        }
    }
}

// ==========================================================================
// Integration-style tests exercising drive_run against a synthetic server.
//
// These live below the other tests because they pull in more of the module
// graph (client::RunStream, request-side helpers) and assert on the full
// request/response dance. The goal is to catch regressions in the response-
// side state machine without needing a live HTTP/2 stack or a real JWT.
// ==========================================================================

#[cfg(test)]
mod pipeline_tests {
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
}
