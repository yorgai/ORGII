//! Cursor CLI stdout parser.
//!
//! Cursor is the canonical format — tool names and args pass through unchanged.
//! Cursor CLI uses `--output-format stream-json` and emits one JSON object per line.
//!
//! Event types: system, assistant, thinking, tool_call (started/completed), result

use serde_json::Value;

use super::CliAgentParser;
use crate::agent_sessions::cli::parsers::types::TokenUsage;
use core_types::activity::ActivityChunk;

pub struct CursorParser {
    session_id: String,
    thread_id: Option<String>,
    usage: Option<TokenUsage>,
    /// Accumulated assistant text from streaming deltas.
    ///
    /// With `--stream-partial-output`, the CLI emits many small `assistant`
    /// events (one per token). We accumulate them here and flush a single
    /// complete chunk when the event type changes (tool_call, result, etc.)
    /// or when the process exits.
    pending_text: String,
}

impl CursorParser {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            thread_id: None,
            usage: None,
            pending_text: String::new(),
        }
    }

    /// Flush accumulated assistant text into a single ActivityChunk.
    /// Returns an empty vec if no text was accumulated.
    fn flush_pending_text(&mut self) -> Vec<ActivityChunk> {
        if self.pending_text.is_empty() {
            return vec![];
        }
        let text = std::mem::take(&mut self.pending_text);
        let mut chunk = ActivityChunk::new(&self.session_id, "assistant", "assistant");
        chunk.result = serde_json::json!({
            "observation": text,
            "content": text,
            "role": "assistant",
            "is_delta": false,
            "is_full_content": true,
        });
        if let Some(ref tid) = self.thread_id {
            chunk.thread_id = Some(tid.clone());
        }
        vec![chunk]
    }

    /// Extract tool name, args, result from Cursor's tool_call structure.
    ///
    /// Cursor format: `{ "tool_call": { "shellToolCall": { "args": {...}, "result": {...} } } }`
    /// Tool name is derived by stripping "ToolCall" suffix and capitalizing.
    fn extract_tool(data: &Value) -> (String, Value, Value) {
        if let Some(tool_call) = data.get("tool_call").and_then(|v| v.as_object()) {
            for (key, value) in tool_call {
                if key.ends_with("ToolCall") {
                    let mut name = key.trim_end_matches("ToolCall").to_string();
                    if let Some(first) = name.get_mut(0..1) {
                        first.make_ascii_uppercase();
                    }
                    let args = value
                        .get("args")
                        .cloned()
                        .unwrap_or(Value::Object(Default::default()));
                    let result = value
                        .get("result")
                        .cloned()
                        .unwrap_or(Value::Object(Default::default()));
                    return (name, args, result);
                }
            }
        }
        (
            "unknown".to_string(),
            Value::Object(Default::default()),
            Value::Object(Default::default()),
        )
    }
}

impl CliAgentParser for CursorParser {
    fn parse_line(&mut self, line: &str) -> Vec<ActivityChunk> {
        let data: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return vec![],
        };

        // Capture thread/session ID if present
        if let Some(sid) = data
            .get("session_id")
            .or(data.get("sessionId"))
            .and_then(|v| v.as_str())
        {
            self.thread_id = Some(sid.to_string());
        }

        let event_type = data.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Debug: log event type and top-level JSON keys (usage might be beyond 300-char preview)
        let top_keys: Vec<&str> = data
            .as_object()
            .map(|obj| obj.keys().map(|k| k.as_str()).collect())
            .unwrap_or_default();
        tracing::debug!(
            "[CursorParser] event_type={:?} keys={:?}",
            event_type,
            top_keys
        );

        // Check ALL fields for usage/token data — log the actual field, not truncated content
        if let Some(usage_val) = data
            .get("usage")
            .or(data.get("tokenUsage"))
            .or(data.get("modelUsage"))
        {
            tracing::info!(
                "[CursorParser] USAGE FIELD FOUND in event_type={:?}: {}",
                event_type,
                usage_val
            );
        }
        // Also check inside message object
        if let Some(msg) = data.get("message") {
            if let Some(usage_val) = msg.get("usage") {
                tracing::info!(
                    "[CursorParser] USAGE FIELD IN message for event_type={:?}: {}",
                    event_type,
                    usage_val
                );
            }
        }

        // Flush accumulated assistant text before any non-assistant event.
        // This merges all streaming deltas into a single assistant chunk.
        let mut flushed = if event_type != "assistant" {
            self.flush_pending_text()
        } else {
            vec![]
        };

        match event_type {
            // ── system (init) ────────────────────────────────────
            "system" => {
                let mut chunk =
                    ActivityChunk::new(&self.session_id, "session_start", "session_start");
                chunk.args = serde_json::json!({
                    "model": data.get("model").and_then(|v| v.as_str()),
                    "cwd": data.get("cwd").and_then(|v| v.as_str()),
                });
                chunk.result = serde_json::json!({"success": true});
                if let Some(ref tid) = self.thread_id {
                    chunk.thread_id = Some(tid.clone());
                }
                flushed.push(chunk);
                flushed
            }

            // ── assistant (message or thinking) ──────────────────
            //
            // With --stream-partial-output, the CLI emits many small
            // assistant events (one per streaming token). We accumulate
            // the text and only emit a chunk when the event type changes.
            // Thinking chunks are emitted immediately (they're separate).
            "assistant" => {
                let message = data.get("message").unwrap_or(&Value::Null);
                let content_list = message.get("content").and_then(|v| v.as_array());

                let mut text = String::new();
                let mut thinking = String::new();

                if let Some(items) = content_list {
                    for item in items {
                        match item.get("type").and_then(|v| v.as_str()) {
                            Some("text") => {
                                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                                    text.push_str(t);
                                }
                            }
                            Some("thinking") => {
                                if let Some(t) = item.get("thinking").and_then(|v| v.as_str()) {
                                    thinking.push_str(t);
                                }
                            }
                            _ => {}
                        }
                    }
                }

                // Fallback to top-level content
                if text.is_empty() {
                    if let Some(c) = data.get("content").and_then(|v| v.as_str()) {
                        text = c.to_string();
                    }
                }

                // Accumulate per-message usage if present
                if let Some(usage) = message.get("usage").or(data.get("usage")) {
                    let input = usage
                        .get("input_tokens")
                        .or(usage.get("inputTokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let output = usage
                        .get("output_tokens")
                        .or(usage.get("outputTokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let cache_read = usage
                        .get("cache_read_input_tokens")
                        .or(usage.get("cacheReadTokens"))
                        .or(usage.get("cache_read_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let cache_write = usage
                        .get("cache_creation_input_tokens")
                        .or(usage.get("cacheWriteTokens"))
                        .or(usage.get("cache_write_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    if let Some(ref mut existing) = self.usage {
                        existing.input_tokens += input;
                        existing.output_tokens += output;
                        existing.cache_read_tokens += cache_read;
                        existing.cache_write_tokens += cache_write;
                    } else {
                        self.usage = Some(TokenUsage {
                            input_tokens: input,
                            output_tokens: output,
                            cache_read_tokens: cache_read,
                            cache_write_tokens: cache_write,
                            total_tokens: 0,
                            model: data
                                .get("model")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        });
                    }
                }

                let mut chunks = vec![];

                // Thinking chunks emit immediately (they're independent)
                if !thinking.is_empty() {
                    let mut chunk =
                        ActivityChunk::new(&self.session_id, "llm_thinking", "thinking");
                    chunk.result = serde_json::json!({
                        "thought": thinking,
                        "observation": thinking,
                        "content": thinking,
                    });
                    chunks.push(chunk);
                }

                // Accumulate assistant text and emit a delta for typewriter effect.
                // Cursor CLI (--stream-partial-output) emits many small assistant
                // events (one per streaming token). A final complete event has the
                // full text AND a stop_reason field on the message object.
                //
                // If stop_reason is present this is a completion — overwrite
                // pending_text (the full content is authoritative, deltas already
                // accumulated are a subset). Otherwise treat as streaming delta.
                let is_completion = {
                    let stop = message
                        .get("stop_reason")
                        .or(message.get("stopReason"))
                        .or(data.get("stop_reason"))
                        .or(data.get("stopReason"));
                    match stop {
                        Some(Value::String(s)) => !s.is_empty(),
                        Some(Value::Null) | None => false,
                        Some(_) => true,
                    }
                };

                if !text.is_empty() {
                    if is_completion {
                        self.pending_text = text;
                    } else if !self.pending_text.is_empty()
                        && text.len() >= self.pending_text.len()
                        && text.starts_with(&self.pending_text)
                    {
                        // The incoming text fully contains our accumulated buffer
                        // as a prefix — this is a cumulative snapshot (full text
                        // so far), not a delta token. Replace instead of appending
                        // to prevent doubling.
                        let new_part = &text[self.pending_text.len()..];
                        self.pending_text = text.clone();
                        if !new_part.is_empty() {
                            let mut delta = ActivityChunk::new(
                                &self.session_id,
                                "assistant_delta",
                                "assistant",
                            );
                            delta.result = serde_json::json!({
                                "content": new_part,
                                "observation": new_part,
                                "role": "assistant",
                                "is_delta": true,
                            });
                            delta.broadcast_only = true;
                            if let Some(ref tid) = self.thread_id {
                                delta.thread_id = Some(tid.clone());
                            }
                            chunks.push(delta);
                        }
                    } else {
                        self.pending_text.push_str(&text);
                        let mut delta =
                            ActivityChunk::new(&self.session_id, "assistant_delta", "assistant");
                        delta.result = serde_json::json!({
                            "content": text,
                            "observation": text,
                            "role": "assistant",
                            "is_delta": true,
                        });
                        delta.broadcast_only = true;
                        if let Some(ref tid) = self.thread_id {
                            delta.thread_id = Some(tid.clone());
                        }
                        chunks.push(delta);
                    }
                }

                chunks
            }

            // ── thinking (delta or completed) ────────────────────
            "thinking" => {
                let subtype = data.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
                let content = data
                    .get("text")
                    .or(data.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if content.is_empty() {
                    return flushed;
                }

                let is_delta = subtype == "delta";
                let action_type = if is_delta {
                    "llm_thinking_delta"
                } else {
                    "llm_thinking"
                };
                let mut chunk = ActivityChunk::new(&self.session_id, action_type, "thinking");
                chunk.result = serde_json::json!({
                    "thought": content,
                    "observation": content,
                    "content": content,
                    "is_delta": is_delta,
                });
                chunk.broadcast_only = is_delta;
                flushed.push(chunk);
                flushed
            }

            // ── tool_call (started or completed) ─────────────────
            "tool_call" => {
                let subtype = data.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
                let (tool_name, args, result) = Self::extract_tool(&data);
                let call_id = data
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let mut chunk = ActivityChunk::new(&self.session_id, "tool_call", &tool_name);
                if !call_id.is_empty() {
                    chunk.chunk_id = format!("tool-call-{call_id}");
                }

                let normalized_subtype = match subtype {
                    "started" | "completed" => subtype,
                    _ => data
                        .get("status")
                        .or_else(|| data.get("tool_call_status"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(subtype),
                };

                match normalized_subtype {
                    "started" | "running" => {
                        chunk.args = args;
                        chunk.result = serde_json::json!({"call_id": call_id, "status": "running"});
                    }
                    "completed" | "success" => {
                        chunk.args = args;
                        chunk.result = result;
                        if let Some(obj) = chunk.result.as_object_mut() {
                            obj.insert("call_id".to_string(), Value::String(call_id));
                        }
                    }
                    "failed" | "error" => {
                        chunk.args = args;
                        chunk.result = result;
                        if let Some(obj) = chunk.result.as_object_mut() {
                            obj.insert("call_id".to_string(), Value::String(call_id));
                            obj.entry("status".to_string())
                                .or_insert_with(|| Value::String("failed".to_string()));
                        }
                    }
                    _ => {
                        chunk.args = args;
                        chunk.result = result;
                        if !call_id.is_empty() {
                            if let Some(obj) = chunk.result.as_object_mut() {
                                obj.insert("call_id".to_string(), Value::String(call_id));
                            }
                        }
                    }
                }

                if let Some(ref tid) = self.thread_id {
                    chunk.thread_id = Some(tid.clone());
                }
                flushed.push(chunk);
                flushed
            }

            // ── result (session end) ─────────────────────────────
            "result" => {
                // Capture token usage from result event
                if let Some(usage) = data
                    .get("usage")
                    .or(data.get("tokenUsage"))
                    .or(data.get("modelUsage"))
                {
                    let input = usage
                        .get("input_tokens")
                        .or(usage.get("inputTokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let output = usage
                        .get("output_tokens")
                        .or(usage.get("outputTokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let cache_read = usage
                        .get("cache_read_input_tokens")
                        .or(usage.get("cacheReadTokens"))
                        .or(usage.get("cache_read_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let cache_write = usage
                        .get("cache_creation_input_tokens")
                        .or(usage.get("cacheWriteTokens"))
                        .or(usage.get("cache_write_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let total = usage
                        .get("total_tokens")
                        .or(usage.get("totalTokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    self.usage = Some(TokenUsage {
                        input_tokens: input,
                        output_tokens: output,
                        cache_read_tokens: cache_read,
                        cache_write_tokens: cache_write,
                        total_tokens: total,
                        model: data
                            .get("model")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    });
                }

                let is_error = data
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let error_msg = data
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let duration_ms = data.get("duration_ms").and_then(|v| v.as_u64());
                let duration_api_ms = data.get("duration_api_ms").and_then(|v| v.as_u64());

                let mut chunk = ActivityChunk::new(&self.session_id, "session_end", "session_end");
                chunk.result = serde_json::json!({
                    "success": !is_error,
                    "error_message": error_msg,
                    "duration_ms": duration_ms,
                    "duration_api_ms": duration_api_ms,
                });
                if let Some(ref tid) = self.thread_id {
                    chunk.thread_id = Some(tid.clone());
                }
                flushed.push(chunk);
                flushed
            }

            // "user" events echo user input back — safe to ignore
            "user" => flushed,

            other => {
                if !other.is_empty() {
                    let preview: String = line.chars().take(300).collect();
                    tracing::info!(
                        "[CursorParser] Unhandled event type: {:?} — {}",
                        other,
                        preview
                    );
                }
                flushed
            }
        }
    }

    fn on_exit(&mut self, exit_code: i32) -> Vec<ActivityChunk> {
        // Flush any remaining accumulated assistant text
        let mut chunks = self.flush_pending_text();

        let mut chunk = ActivityChunk::new(&self.session_id, "session_end", "session_end");
        chunk.result = serde_json::json!({
            "success": exit_code == 0,
            "exit_code": exit_code,
        });
        if let Some(ref tid) = self.thread_id {
            chunk.thread_id = Some(tid.clone());
        }
        chunks.push(chunk);
        chunks
    }

    fn token_usage(&self) -> Option<TokenUsage> {
        self.usage.clone()
    }

    fn cli_session_id(&self) -> Option<String> {
        self.thread_id.clone()
    }
}
