//! Gemini CLI stdout parser.
//!
//! Gemini uses `--output-format stream-json`. Format is similar to Claude Code
//! but with different event names: `init`, `message`, `tool_use`, `tool_result`, `result`.
//!
//! Tool IDs encode the tool name: `tool_name-timestamp-hash`.

use serde_json::Value;
use std::collections::HashMap;

use super::CliAgentParser;
use crate::agent_sessions::cli::parsers::normalizer::normalize_tool_name;
use crate::agent_sessions::cli::parsers::types::{CliAgentType, TokenUsage};
use core_types::activity::ActivityChunk;

pub struct GeminiParser {
    session_id: String,
    thread_id: Option<String>,
    usage: Option<TokenUsage>,
    /// Pending tool calls: tool_id → (cursor_name, normalized_args)
    pending_tools: HashMap<String, (String, Value)>,
    assistant_delta_buffer: String,
    thinking_delta_buffer: String,
    got_result: bool,
}

impl GeminiParser {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            thread_id: None,
            usage: None,
            pending_tools: HashMap::new(),
            assistant_delta_buffer: String::new(),
            thinking_delta_buffer: String::new(),
            got_result: false,
        }
    }

    /// Extract tool name from Gemini's tool_id formats:
    /// - older CLI: `tool_name-timestamp-hash`
    /// - newer CLI: `tool_name_timestamp_index`
    fn tool_name_from_id(tool_id: &str) -> &str {
        if let Some((name, _)) = tool_id.split_once('-') {
            return name;
        }
        if let Some((prefix, index)) = tool_id.rsplit_once('_') {
            if index.chars().all(|ch| ch.is_ascii_digit()) {
                if let Some((name, timestamp)) = prefix.rsplit_once('_') {
                    if timestamp.chars().all(|ch| ch.is_ascii_digit()) {
                        return name;
                    }
                }
            }
        }
        tool_id
    }

    /// Normalize Gemini args to Cursor format.
    fn flush_text_buffers(&mut self) -> Vec<ActivityChunk> {
        let mut chunks = Vec::new();
        if !self.thinking_delta_buffer.is_empty() {
            let content = std::mem::take(&mut self.thinking_delta_buffer);
            let mut chunk = ActivityChunk::new(&self.session_id, "llm_thinking", "thinking");
            chunk.result = serde_json::json!({
                "thought": content,
                "observation": content,
                "content": content,
                "is_delta": false,
                "is_full_content": true,
            });
            chunks.push(chunk);
        }
        if !self.assistant_delta_buffer.is_empty() {
            let content = std::mem::take(&mut self.assistant_delta_buffer);
            let mut chunk = ActivityChunk::new(&self.session_id, "assistant", "message");
            chunk.result = serde_json::json!({
                "observation": content,
                "content": content,
                "role": "assistant",
                "is_delta": false,
                "is_full_content": true,
            });
            chunks.push(chunk);
        }
        chunks
    }

    fn normalize_args(cursor_name: &str, args: &Value) -> Value {
        match cursor_name {
            "Shell" => {
                serde_json::json!({
                    "command": args.get("command").and_then(|v| v.as_str()).unwrap_or(""),
                    "workingDirectory": args.get("working_directory").or(args.get("cwd")).and_then(|v| v.as_str()),
                })
            }
            "Edit" => {
                // Gemini can use write_file (full content) or replace (old/new)
                if args.get("old_string").is_some() {
                    serde_json::json!({
                        "path": args.get("file_path").or(args.get("path")).and_then(|v| v.as_str()),
                        "old_string": args.get("old_string").and_then(|v| v.as_str()),
                        "new_string": args.get("new_string").and_then(|v| v.as_str()),
                    })
                } else {
                    serde_json::json!({
                        "path": args.get("file_path").or(args.get("path")).and_then(|v| v.as_str()),
                        "old_string": "",
                        "new_string": args.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                    })
                }
            }
            "Read" => {
                serde_json::json!({
                    "path": args.get("file_path").or(args.get("path")).and_then(|v| v.as_str()),
                })
            }
            "UpdateTodos" => {
                // Gemini sends todos with "description" field; frontend expects "content"
                let todos = args.get("todos").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter().map(|todo| {
                        let content = todo.get("content")
                            .or(todo.get("description"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let status = todo.get("status").and_then(|v| v.as_str()).unwrap_or("pending");
                        let id = todo.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        serde_json::json!({ "id": id, "content": content, "status": status })
                    }).collect::<Vec<_>>()
                }).unwrap_or_default();
                serde_json::json!({ "todos": todos })
            }
            "Ls" => {
                // Gemini sends dir_path; frontend expects path/target_directory
                serde_json::json!({
                    "path": args.get("dir_path").or(args.get("path")).or(args.get("directory")).and_then(|v| v.as_str()).unwrap_or("."),
                })
            }
            "Glob" => {
                // Gemini sends pattern; frontend expects glob_pattern
                serde_json::json!({
                    "glob_pattern": args.get("pattern").or(args.get("glob_pattern")).and_then(|v| v.as_str()).unwrap_or("*"),
                    "target_directory": args.get("dir_path").or(args.get("directory")).and_then(|v| v.as_str()),
                })
            }
            "Grep" => {
                // Gemini sends dir_path + pattern; frontend expects pattern + target_directory
                serde_json::json!({
                    "pattern": args.get("pattern").or(args.get("query")).and_then(|v| v.as_str()).unwrap_or(""),
                    "target_directory": args.get("dir_path").or(args.get("directory")).and_then(|v| v.as_str()),
                })
            }
            _ => args.clone(),
        }
    }
}

impl CliAgentParser for GeminiParser {
    fn parse_line(&mut self, line: &str) -> Vec<ActivityChunk> {
        let data: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return vec![],
        };

        let event_type = data.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            // ── init ─────────────────────────────────────────────
            "init" => {
                if let Some(sid) = data.get("session_id").and_then(|v| v.as_str()) {
                    self.thread_id = Some(sid.to_string());
                }
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
                vec![chunk]
            }

            // ── message (assistant text or thinking) ──────────────
            "message" => {
                let role = data.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if role == "user" {
                    return vec![];
                }

                let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let is_delta = data.get("delta").and_then(|v| v.as_bool()).unwrap_or(false);
                let is_thought = data
                    .get("thought")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || data
                        .get("thinking")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                if content.is_empty() {
                    return vec![];
                }

                if is_thought {
                    let action_type = if is_delta {
                        self.thinking_delta_buffer.push_str(content);
                        "llm_thinking_delta"
                    } else {
                        "llm_thinking"
                    };
                    let mut chunk = ActivityChunk::new(&self.session_id, action_type, "thinking");
                    chunk.result = serde_json::json!({
                        "thought": content, "observation": content, "content": content,
                        "is_delta": is_delta,
                    });
                    chunk.broadcast_only = is_delta;
                    return vec![chunk];
                }

                let action_type = if is_delta {
                    self.assistant_delta_buffer.push_str(content);
                    "assistant_delta"
                } else {
                    "assistant"
                };
                let mut chunk = ActivityChunk::new(&self.session_id, action_type, "message");
                chunk.result = serde_json::json!({
                    "observation": content, "content": content, "role": "assistant",
                    "is_delta": is_delta,
                });
                chunk.broadcast_only = is_delta;
                vec![chunk]
            }

            // ── thinking (standalone thinking event) ─────────────
            "thinking" => {
                let content = data
                    .get("content")
                    .or(data.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let is_delta = data.get("delta").and_then(|v| v.as_bool()).unwrap_or(false);

                if content.is_empty() {
                    return vec![];
                }

                let action_type = if is_delta {
                    self.thinking_delta_buffer.push_str(content);
                    "llm_thinking_delta"
                } else {
                    "llm_thinking"
                };
                let mut chunk = ActivityChunk::new(&self.session_id, action_type, "thinking");
                chunk.result = serde_json::json!({
                    "thought": content, "observation": content, "content": content,
                    "is_delta": is_delta,
                });
                chunk.broadcast_only = is_delta;
                vec![chunk]
            }

            // ── tool_use (tool call start) ───────────────────────
            "tool_use" => {
                let gemini_name = data
                    .get("tool_name")
                    .or(data.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let tool_id = data
                    .get("tool_id")
                    .or(data.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args = data
                    .get("parameters")
                    .or(data.get("input"))
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()));

                let cursor_name = normalize_tool_name(CliAgentType::GeminiCli, gemini_name);
                let normalized_args = Self::normalize_args(&cursor_name, &args);

                let mut chunk = ActivityChunk::new(&self.session_id, "tool_call", &cursor_name);
                if !tool_id.is_empty() {
                    chunk.chunk_id = format!("tool-call-{tool_id}");
                }
                // Include call_id in args so start/end pairing works
                let mut args_with_call_id = normalized_args.clone();
                if let Some(obj) = args_with_call_id.as_object_mut() {
                    obj.insert("call_id".to_string(), Value::String(tool_id.clone()));
                }
                chunk.args = args_with_call_id;
                chunk.result = serde_json::json!({"call_id": tool_id, "status": "running"});

                // Store cursor_name AND normalized args for use in tool_result
                self.pending_tools
                    .insert(tool_id, (cursor_name, normalized_args));
                vec![chunk]
            }

            // ── tool_result (tool call end) ──────────────────────
            "tool_result" => {
                let tool_id = data.get("tool_id").and_then(|v| v.as_str()).unwrap_or("");
                let is_error = data
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || data.get("status").and_then(|v| v.as_str()) == Some("error");
                let content = data
                    .get("result")
                    .or(data.get("output"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // Recover tool name and stored args from pending
                let (cursor_name, stored_args) =
                    self.pending_tools.remove(tool_id).unwrap_or_else(|| {
                        let raw = Self::tool_name_from_id(tool_id);
                        (
                            normalize_tool_name(CliAgentType::GeminiCli, raw),
                            Value::Object(Default::default()),
                        )
                    });

                // Extract file path from stored args for Edit results
                let stored_path = stored_args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let result = match cursor_name.as_str() {
                    "Shell" => {
                        if is_error {
                            serde_json::json!({"error": {"exitCode": 1, "stdout": content, "stderr": ""}})
                        } else {
                            serde_json::json!({"success": {"exitCode": 0, "stdout": content, "stderr": ""}})
                        }
                    }
                    "Read" => {
                        serde_json::json!({"success": {"content": content, "totalLines": 0, "fileSize": 0}})
                    }
                    "Edit" => {
                        // Compute line stats from stored args
                        let new_str = stored_args
                            .get("new_string")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let old_str = stored_args
                            .get("old_string")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let lines_added = if new_str.is_empty() {
                            0
                        } else {
                            new_str.lines().count()
                        };
                        let lines_removed = if old_str.is_empty() {
                            0
                        } else {
                            old_str.lines().count()
                        };
                        serde_json::json!({"success": {
                            "path": stored_path,
                            "linesAdded": lines_added,
                            "linesRemoved": lines_removed,
                            "diffString": content,
                        }})
                    }
                    _ => {
                        if is_error {
                            serde_json::json!({"error": {"message": content}})
                        } else {
                            serde_json::json!({"success": true, "content": content})
                        }
                    }
                };

                let mut chunk = ActivityChunk::new(&self.session_id, "tool_call", &cursor_name);
                if !tool_id.is_empty() {
                    chunk.chunk_id = format!("tool-call-{tool_id}");
                }
                // Carry over stored args + call_id so the completed event is self-contained
                let mut args_with_call_id = stored_args;
                if let Some(obj) = args_with_call_id.as_object_mut() {
                    obj.insert("call_id".to_string(), Value::String(tool_id.to_string()));
                }
                chunk.args = args_with_call_id;
                chunk.result = result;
                if let Some(obj) = chunk.result.as_object_mut() {
                    obj.insert("call_id".to_string(), Value::String(tool_id.to_string()));
                }
                vec![chunk]
            }

            // ── result (session end) ─────────────────────────────
            "result" => {
                self.got_result = true;

                let is_error = data
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || data.get("error").is_some();
                let error_msg = data.get("error").and_then(|v| {
                    v.as_str().map(|s| s.to_string()).or_else(|| {
                        v.get("message")
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string())
                    })
                });

                // Parse usage (flat or nested format)
                if let Some(stats) = data.get("stats") {
                    if let Some(models) = stats.get("models").and_then(|v| v.as_object()) {
                        // Nested format: stats.models.<model>.tokens
                        if let Some((model_name, model_data)) = models.iter().next() {
                            if let Some(tokens) = model_data.get("tokens") {
                                self.usage = Some(TokenUsage {
                                    input_tokens: tokens
                                        .get("prompt")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0),
                                    output_tokens: tokens
                                        .get("candidates")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0),
                                    cache_read_tokens: tokens
                                        .get("cached")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0),
                                    cache_write_tokens: 0,
                                    total_tokens: tokens
                                        .get("total")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0),
                                    model: Some(model_name.clone()),
                                });
                            }
                        }
                    } else {
                        // Flat format: stats.{total_tokens, input_tokens, ...}
                        self.usage = Some(TokenUsage {
                            input_tokens: stats
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            output_tokens: stats
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            cache_read_tokens: stats
                                .get("cached_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            cache_write_tokens: 0,
                            total_tokens: stats
                                .get("total_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            model: None,
                        });
                    }
                }

                let mut chunks = self.flush_text_buffers();
                let mut chunk = ActivityChunk::new(&self.session_id, "session_end", "session_end");
                chunk.result = serde_json::json!({
                    "success": !is_error,
                    "error_message": error_msg,
                });
                chunks.push(chunk);
                chunks
            }

            _ => vec![],
        }
    }

    fn on_exit(&mut self, exit_code: i32) -> Vec<ActivityChunk> {
        if self.got_result {
            return vec![];
        }
        let mut chunks = self.flush_text_buffers();
        let mut chunk = ActivityChunk::new(&self.session_id, "session_end", "session_end");
        chunk.result = serde_json::json!({
            "success": exit_code == 0,
            "exit_code": exit_code,
        });
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

#[cfg(test)]
#[path = "tests/gemini_tests.rs"]
mod tests;
