//! Claude Code imported history reader
//!
//! Reads Claude Code JSONL transcripts from `~/.claude/projects/*/*.jsonl` and
//! converts them into ORGII's canonical `ActivityChunk` shape for read-only
//! replay.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::imported_history::{
    self, ImportedHistoryRowInput, ImportedHistorySessionPage, ImportedHistorySessionRow,
    ImportedToolCall,
};

const CLAUDE_CODE_SESSION_PREFIX: &str = "claudecodeapp-";
const CLAUDE_CODE_PROVIDER_SLUG: &str = "claudecode";

pub type ClaudeCodeHistorySessionRow = ImportedHistorySessionRow;
pub type ClaudeCodeHistorySessionPage = ImportedHistorySessionPage;

#[derive(Debug, Clone)]
struct ClaudeCodeHistoryMeta {
    session_id: String,
    name: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    model: Option<String>,
    repo_path: Option<String>,
    branch: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeJsonlLine {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    git_branch: String,
    #[serde(default)]
    message: Option<ClaudeMessage>,
}

#[derive(Debug, Deserialize)]
struct ClaudeMessage {
    #[serde(default)]
    model: String,
    #[serde(default)]
    content: Value,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(default)]
    cache_read_input_tokens: i64,
    #[serde(default)]
    cache_creation_input_tokens: i64,
}

#[derive(Debug, Clone)]
struct ClaudeCodeSessionFile {
    file_stem: String,
    path: PathBuf,
}

pub fn list_claude_code_history_sessions_paginated(
    limit: usize,
    offset: usize,
) -> Result<ClaudeCodeHistorySessionPage, String> {
    let sessions = scan_claude_code_history_sessions()?;
    let rows = sessions.into_iter().map(session_meta_to_row).collect();
    Ok(imported_history::page_from_rows(rows, limit, offset))
}

pub fn load_claude_code_history_for_session(
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = claude_file_stem_from_session_id(session_id)?;
    let path = resolve_claude_session_path(file_stem)?;
    load_claude_code_history_from_path(session_id, &path)
}

fn scan_claude_code_history_sessions() -> Result<Vec<ClaudeCodeHistoryMeta>, String> {
    let sessions_dir = claude_projects_dir()?;
    if !sessions_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_claude_session_files(&sessions_dir, &mut files)?;
    files
        .into_iter()
        .filter_map(|file| parse_claude_session_meta(&file.path, &file.file_stem).transpose())
        .collect::<Result<Vec<_>, _>>()
}

fn collect_claude_session_files(
    dir: &Path,
    out: &mut Vec<ClaudeCodeSessionFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to read Claude dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read Claude dir entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_claude_session_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            let Some(file_stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            out.push(ClaudeCodeSessionFile {
                file_stem: file_stem.to_string(),
                path,
            });
        }
    }
    Ok(())
}

fn parse_claude_session_meta(
    path: &Path,
    file_stem: &str,
) -> Result<Option<ClaudeCodeHistoryMeta>, String> {
    let mtime = file_mtime_ms(path)?;
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut created_at_ms = 0;
    let mut updated_at_ms = 0;
    let mut first_prompt = String::new();
    let mut model: Option<String> = None;
    let mut repo_path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut input_tokens = 0;
    let mut output_tokens = 0;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: ClaudeJsonlLine = match serde_json::from_str(trimmed) {
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
        if repo_path.is_none() && !parsed.cwd.trim().is_empty() {
            repo_path = Some(parsed.cwd.clone());
        }
        if branch.is_none() && !parsed.git_branch.trim().is_empty() {
            branch = Some(parsed.git_branch.clone());
        }
        if let Some(message) = parsed.message {
            if first_prompt.is_empty() && parsed.r#type == "user" {
                if let Some(text) = claude_content_text(&message.content) {
                    first_prompt = imported_history::truncate_name(&text, 200);
                }
            }
            if model.is_none()
                && !message.model.trim().is_empty()
                && !message.model.starts_with('<')
            {
                model = Some(message.model.clone());
            }
            if let Some(usage) = message.usage {
                input_tokens += usage.input_tokens
                    + usage.cache_read_input_tokens
                    + usage.cache_creation_input_tokens;
                output_tokens += usage.output_tokens;
            }
        }
    }

    if created_at_ms == 0 && mtime == 0 {
        return Ok(None);
    }

    Ok(Some(ClaudeCodeHistoryMeta {
        session_id: format!("{CLAUDE_CODE_SESSION_PREFIX}{file_stem}"),
        name: if first_prompt.is_empty() {
            file_stem.to_string()
        } else {
            first_prompt
        },
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
        branch,
        input_tokens,
        output_tokens,
    }))
}

fn session_meta_to_row(meta: ClaudeCodeHistoryMeta) -> ClaudeCodeHistorySessionRow {
    imported_history::row_from_input(ImportedHistoryRowInput {
        session_id: meta.session_id,
        name: meta.name,
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        model: meta.model,
        input_tokens: meta.input_tokens,
        output_tokens: meta.output_tokens,
        repo_path: meta.repo_path,
        branch: meta.branch,
    })
}

fn load_claude_code_history_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ActivityChunk>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    let reader = BufReader::new(file);

    let mut chunks = Vec::new();
    let mut pending_tool_calls: HashMap<String, ImportedToolCall> = HashMap::new();
    let mut sequence = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: ClaudeJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let Some(message) = parsed.message else {
            continue;
        };

        match parsed.r#type.as_str() {
            "user" => {
                if let Some(tool_result_output) = claude_tool_result_text(&message.content) {
                    if let Some((call_id, output)) = tool_result_output {
                        if let Some(call) = pending_tool_calls.remove(&call_id) {
                            chunks.push(imported_history::tool_call_chunk(
                                session_id,
                                CLAUDE_CODE_PROVIDER_SLUG,
                                sequence,
                                &call,
                                &output,
                            ));
                            sequence += 1;
                        }
                    }
                } else if let Some(text) = claude_content_text(&message.content) {
                    chunks.push(imported_history::user_message_chunk(
                        session_id,
                        CLAUDE_CODE_PROVIDER_SLUG,
                        sequence,
                        &created_at,
                        &text,
                    ));
                    sequence += 1;
                }
            }
            "assistant" => {
                for item in claude_content_items(&message.content) {
                    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                    match item_type {
                        "text" => {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                chunks.push(imported_history::assistant_message_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "thinking" => {
                            if let Some(text) = item.get("thinking").and_then(Value::as_str) {
                                chunks.push(imported_history::thinking_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "tool_use" => {
                            if let Some(call) = claude_tool_call_from_item(item, &created_at) {
                                pending_tool_calls.insert(call.call_id.clone(), call);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    for call in pending_tool_calls.into_values() {
        chunks.push(imported_history::tool_call_chunk(
            session_id,
            CLAUDE_CODE_PROVIDER_SLUG,
            sequence,
            &call,
            "",
        ));
        sequence += 1;
    }

    Ok(chunks)
}

fn claude_tool_call_from_item(item: &Value, created_at: &str) -> Option<ImportedToolCall> {
    let call_id = item.get("id")?.as_str()?.to_string();
    let raw_name = item.get("name")?.as_str()?.to_string();
    let args = item.get("input").cloned().unwrap_or_else(|| json!({}));
    let (canonical_name, args) = normalize_claude_tool_call(&raw_name, args);
    Some(ImportedToolCall {
        call_id,
        raw_name,
        canonical_name,
        args,
        created_at: created_at.to_string(),
    })
}

fn normalize_claude_tool_call(raw_name: &str, args: Value) -> (String, Value) {
    match raw_name {
        "Bash" => (
            imported_history::FUNCTION_RUN_COMMAND_LINE.to_string(),
            normalize_shell_args(args),
        ),
        "Edit" | "MultiEdit" | "Write" => (
            imported_history::FUNCTION_EDIT_FILE.to_string(),
            normalize_edit_args(raw_name, args),
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

fn normalize_edit_args(raw_name: &str, args: Value) -> Value {
    let file_path = args
        .get("file_path")
        .and_then(Value::as_str)
        .or_else(|| args.get("path").and_then(Value::as_str))
        .unwrap_or_default();
    json!({
        "action": raw_name,
        "file_path": file_path,
        "payload": args,
    })
}

fn claude_content_items(content: &Value) -> Vec<&Value> {
    match content {
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

fn claude_content_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
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

fn claude_tool_result_text(content: &Value) -> Option<Option<(String, String)>> {
    let Value::Array(items) = content else {
        return None;
    };
    let result_item = items
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("tool_result"))?;
    let call_id = result_item.get("tool_use_id")?.as_str()?.to_string();
    let output = match result_item.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    Some(Some((call_id, output)))
}

fn claude_file_stem_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(file_stem) = session_id.strip_prefix(CLAUDE_CODE_SESSION_PREFIX) else {
        return Err(format!(
            "Invalid Claude Code history session id: {session_id}"
        ));
    };
    if file_stem.is_empty() {
        return Err("Claude Code history session id is missing file stem".to_string());
    }
    Ok(file_stem)
}

fn resolve_claude_session_path(file_stem: &str) -> Result<PathBuf, String> {
    let projects_dir = claude_projects_dir()?;
    let mut files = Vec::new();
    collect_claude_session_files(&projects_dir, &mut files)?;
    files
        .into_iter()
        .find(|file| file.file_stem == file_stem)
        .map(|file| file.path)
        .ok_or_else(|| format!("Claude Code history file not found for session: {file_stem}"))
}

fn claude_projects_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    Ok(home.join(".claude").join("projects"))
}

fn file_mtime_ms(path: &Path) -> Result<i64, String> {
    Ok(path
        .metadata()
        .map_err(|err| format!("Failed to read Claude file metadata: {err}"))?
        .modified()
        .map_err(|err| format!("Failed to read Claude file modified time: {err}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("Claude file modified time is before Unix epoch: {err}"))?
        .as_millis() as i64)
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
