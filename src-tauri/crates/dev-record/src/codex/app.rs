//! Codex app event reader
//!
//! Reads Codex rollout JSONL files from `~/.codex/sessions/YYYY/MM/DD/` and
//! converts them into ORGII's canonical `ActivityChunk` shape. These rows are
//! imported history only: ORGII does not own the Codex process or write back to
//! Codex's local files.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::imported_history::{
    self, ImportedHistoryRecentPath, ImportedHistoryRowInput, ImportedHistorySessionPage,
    ImportedHistorySessionRow, ImportedToolCall,
};

const CODEX_APP_SESSION_PREFIX: &str = "codexapp-";
const CODEX_PROVIDER_SLUG: &str = "codex";

pub type CodexAppSessionRow = ImportedHistorySessionRow;
pub type CodexAppSessionPage = ImportedHistorySessionPage;
pub type CodexAppRecentPath = ImportedHistoryRecentPath;

#[derive(Debug, Clone)]
struct CodexAppSessionMeta {
    session_id: String,
    name: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    model: Option<String>,
    repo_path: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
}

#[derive(Debug, Deserialize)]
struct CodexJsonlLine {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Deserialize)]
struct CodexTurnContextPayload {
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    model: String,
}

pub fn list_codex_app_sessions_paginated(
    limit: usize,
    offset: usize,
) -> Result<CodexAppSessionPage, String> {
    let sessions = scan_codex_app_sessions()?;
    let rows = sessions.into_iter().map(session_meta_to_row).collect();
    Ok(imported_history::page_from_rows(rows, limit, offset))
}

pub fn list_codex_app_recent_paths(limit: usize) -> Result<Vec<CodexAppRecentPath>, String> {
    let sessions = scan_codex_app_sessions()?;
    let rows = sessions
        .into_iter()
        .map(session_meta_to_row)
        .collect::<Vec<_>>();
    Ok(imported_history::recent_paths_from_rows(&rows)
        .into_iter()
        .take(imported_history::effective_limit(limit))
        .collect())
}

pub fn load_codex_app_for_session(session_id: &str) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(file_stem)?;
    load_codex_app_from_path(session_id, &path)
}

fn scan_codex_app_sessions() -> Result<Vec<CodexAppSessionMeta>, String> {
    let sessions_dir = codex_sessions_dir()?;
    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();
    collect_codex_session_files(&sessions_dir, &mut sessions)?;
    let parsed = sessions
        .into_iter()
        .filter_map(|path| parse_codex_session_meta(&path).transpose())
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parsed)
}

fn collect_codex_session_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to read Codex dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read Codex dir entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_codex_session_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            out.push(path);
        }
    }
    Ok(())
}

fn parse_codex_session_meta(path: &Path) -> Result<Option<CodexAppSessionMeta>, String> {
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Codex session path has no valid file stem: {}",
                path.display()
            )
        })?
        .to_string();
    let session_id = format!("{CODEX_APP_SESSION_PREFIX}{file_stem}");
    let mtime = file_mtime_ms(path)?;

    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Codex history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut created_at_ms = 0;
    let mut updated_at_ms = 0;
    let mut first_prompt = String::new();
    let mut model: Option<String> = None;
    let mut repo_path: Option<String> = None;
    let mut input_tokens = 0;
    let mut output_tokens = 0;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Codex history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        if let Some(timestamp) = parsed
            .timestamp
            .as_deref()
            .and_then(imported_history::parse_iso_to_epoch_ms_opt)
        {
            if created_at_ms == 0 || timestamp < created_at_ms {
                created_at_ms = timestamp;
            }
            if timestamp > updated_at_ms {
                updated_at_ms = timestamp;
            }
        }
        if first_prompt.is_empty() {
            if let Some(message) = user_message_from_payload(&parsed.payload) {
                first_prompt = imported_history::truncate_name(&message, 200);
            }
        }
        if model.is_none() || repo_path.is_none() {
            if let Ok(turn_context) =
                serde_json::from_value::<CodexTurnContextPayload>(parsed.payload.clone())
            {
                if model.is_none() && !turn_context.model.trim().is_empty() {
                    model = Some(turn_context.model);
                }
                if repo_path.is_none() && !turn_context.cwd.trim().is_empty() {
                    repo_path = Some(turn_context.cwd);
                }
            }
        }
        if parsed.payload.get("type").and_then(Value::as_str) == Some("token_count") {
            if let Some(total_usage) = parsed.payload.get("total_token_usage") {
                input_tokens = total_usage
                    .get("input_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(input_tokens);
                output_tokens = total_usage
                    .get("output_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(output_tokens);
            }
        }
    }

    if created_at_ms == 0 && mtime == 0 {
        return Ok(None);
    }

    let name = if first_prompt.is_empty() {
        file_stem.clone()
    } else {
        first_prompt
    };
    Ok(Some(CodexAppSessionMeta {
        session_id,
        name,
        created_at_ms: if created_at_ms > 0 {
            created_at_ms
        } else {
            mtime
        },
        updated_at_ms: if updated_at_ms > 0 {
            updated_at_ms
        } else {
            mtime
        },
        model,
        repo_path,
        input_tokens,
        output_tokens,
    }))
}

fn session_meta_to_row(meta: CodexAppSessionMeta) -> CodexAppSessionRow {
    imported_history::row_from_input(ImportedHistoryRowInput {
        session_id: meta.session_id,
        name: meta.name,
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        model: meta.model,
        input_tokens: meta.input_tokens,
        output_tokens: meta.output_tokens,
        repo_path: meta.repo_path,
        branch: None,
    })
}

fn load_codex_app_from_path(session_id: &str, path: &Path) -> Result<Vec<ActivityChunk>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Codex history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut chunks = Vec::new();
    let mut pending_tool_calls: HashMap<String, ImportedToolCall> = HashMap::new();
    let mut sequence = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Codex history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let Some(payload_type) = parsed.payload.get("type").and_then(Value::as_str) else {
            continue;
        };

        match payload_type {
            "user_message" => {
                if let Some(message) = user_message_from_payload(&parsed.payload) {
                    chunks.push(imported_history::user_message_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        &message,
                    ));
                    sequence += 1;
                }
            }
            "agent_message" => {
                if let Some(message) = parsed.payload.get("message").and_then(Value::as_str) {
                    chunks.push(imported_history::assistant_message_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        message,
                    ));
                    sequence += 1;
                }
            }
            "message" => {
                if parsed.payload.get("role").and_then(Value::as_str) == Some("assistant") {
                    if let Some(text) = content_text_from_payload(&parsed.payload) {
                        chunks.push(imported_history::assistant_message_chunk(
                            session_id,
                            CODEX_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            &text,
                        ));
                        sequence += 1;
                    }
                }
            }
            "reasoning" | "agent_reasoning" => {
                if let Some(text) = reasoning_text_from_payload(&parsed.payload) {
                    chunks.push(imported_history::thinking_chunk(
                        session_id,
                        CODEX_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        &text,
                    ));
                    sequence += 1;
                }
            }
            "function_call" => {
                if let Some(call) = pending_tool_call_from_payload(&parsed.payload, &created_at) {
                    pending_tool_calls.insert(call.call_id.clone(), call);
                }
            }
            "custom_tool_call" => {
                if let Some(call) =
                    pending_custom_tool_call_from_payload(&parsed.payload, &created_at)
                {
                    pending_tool_calls.insert(call.call_id.clone(), call);
                }
            }
            "function_call_output" | "custom_tool_call_output" => {
                let call_id = parsed.payload.get("call_id").and_then(Value::as_str);
                if let Some(call_id) = call_id {
                    if let Some(call) = pending_tool_calls.remove(call_id) {
                        let output = parsed
                            .payload
                            .get("output")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        chunks.push(imported_history::tool_call_chunk(
                            session_id,
                            CODEX_PROVIDER_SLUG,
                            sequence,
                            &call,
                            output,
                        ));
                        sequence += 1;
                    }
                }
            }
            _ => {}
        }
    }

    for call in pending_tool_calls.into_values() {
        chunks.push(imported_history::tool_call_chunk(
            session_id,
            CODEX_PROVIDER_SLUG,
            sequence,
            &call,
            "",
        ));
        sequence += 1;
    }

    Ok(chunks)
}

fn pending_tool_call_from_payload(payload: &Value, created_at: &str) -> Option<ImportedToolCall> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let arguments = payload
        .get("arguments")
        .and_then(Value::as_str)
        .map(imported_history::parse_inner_json)
        .unwrap_or_else(|| json!({}));
    let (canonical_name, args) = normalize_codex_tool_call(&raw_name, arguments);
    Some(ImportedToolCall {
        call_id,
        raw_name,
        canonical_name,
        args,
        created_at: created_at.to_string(),
    })
}

fn pending_custom_tool_call_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<ImportedToolCall> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let input = payload
        .get("input")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let args = if raw_name == "apply_patch" {
        json!({ "patch": input })
    } else {
        json!({ "input": input })
    };
    let (canonical_name, args) = normalize_codex_tool_call(&raw_name, args);
    Some(ImportedToolCall {
        call_id,
        raw_name,
        canonical_name,
        args,
        created_at: created_at.to_string(),
    })
}

fn normalize_codex_tool_call(raw_name: &str, args: Value) -> (String, Value) {
    match raw_name {
        "shell" => (
            imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
            normalize_shell_args(args),
        ),
        "apply_patch" => (
            imported_history::FUNCTION_EDIT_FILE.to_string(),
            normalize_apply_patch_args(args),
        ),
        _ => (raw_name.to_string(), args),
    }
}

fn normalize_shell_args(args: Value) -> Value {
    let command = args
        .get("command")
        .and_then(Value::as_str)
        .or_else(|| args.get("cmd").and_then(Value::as_str))
        .unwrap_or_default();
    json!({
        "command": command,
        "cmd": command,
    })
}

fn normalize_apply_patch_args(args: Value) -> Value {
    let patch = args
        .get("patch")
        .and_then(Value::as_str)
        .or_else(|| args.get("input").and_then(Value::as_str))
        .unwrap_or_default();
    json!({
        "action": "apply_patch",
        "patch": patch,
    })
}

fn user_message_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("message")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn content_text_from_payload(payload: &Value) -> Option<String> {
    let content = payload.get("content")?;
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(content_part_text)
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn content_part_text(part: &Value) -> Option<String> {
    part.get("text")
        .and_then(Value::as_str)
        .or_else(|| part.get("content").and_then(Value::as_str))
        .map(ToString::to_string)
}

fn reasoning_text_from_payload(payload: &Value) -> Option<String> {
    if let Some(text) = payload.get("content").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }
    let summary = payload.get("summary")?.as_array()?;
    let parts = summary
        .iter()
        .filter_map(content_part_text)
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn codex_file_stem_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(file_stem) = session_id.strip_prefix(CODEX_APP_SESSION_PREFIX) else {
        return Err(format!("Invalid Codex app session id: {session_id}"));
    };
    if file_stem.is_empty() {
        return Err("Codex app session id is missing file stem".to_string());
    }
    Ok(file_stem)
}

fn resolve_codex_session_path(file_stem: &str) -> Result<PathBuf, String> {
    let sessions_dir = codex_sessions_dir()?;
    let mut files = Vec::new();
    collect_codex_session_files(&sessions_dir, &mut files)?;
    files
        .into_iter()
        .find(|path| path.file_stem().and_then(|value| value.to_str()) == Some(file_stem))
        .ok_or_else(|| format!("Codex app file not found for session: {file_stem}"))
}

fn codex_sessions_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    Ok(home.join(".codex").join("sessions"))
}

fn file_mtime_ms(path: &Path) -> Result<i64, String> {
    Ok(path
        .metadata()
        .map_err(|err| format!("Failed to read Codex file metadata: {err}"))?
        .modified()
        .map_err(|err| format!("Failed to read Codex file modified time: {err}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("Codex file modified time is before Unix epoch: {err}"))?
        .as_millis() as i64)
}

#[cfg(test)]
#[path = "app_tests.rs"]
mod tests;
