//! Core session execution — spawns CLI agent, parses stdout, broadcasts events.

use std::collections::{HashMap, VecDeque};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use core_types::activity::ActivityChunk;
use core_types::providers::{
    CodexCliAuthConfig, CODEX_ID_TOKEN_ENV_KEY, CODEX_REFRESH_TOKEN_ENV_KEY,
};

use agent_core::session::AgentExecMode;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::agent_sessions::cli::parsers::copilot;
use crate::agent_sessions::cli::parsers::kiro;
use crate::api::websocket_handler;
use key_vault::key_store::{
    CliOAuthTokenSync, CliOAuthTokenSyncOutcome, KeyService, ModelType, KEY_SERVICE,
};

use super::super::persistence;
use super::super::types::{proxy_env, KeySource, SessionStatus};
use super::command::{build_command, create_parser};
use super::cursor_usage::fetch_cursor_usage_for_session;
use super::helpers::{
    emit_chunk, flush_and_broadcast, persist_attached_images, snapshot_cli_file_edit,
    strip_ide_context,
};
use super::proxy_release::release_proxy_token_for_session;

const CONTEXT_BRIDGE_MAX_CHARS: usize = 12_000;
const CONTEXT_BRIDGE_MAX_MESSAGES: usize = 24;
const SPAWN_RETRY_ATTEMPTS: usize = 3;
const SPAWN_RETRY_BASE_DELAY_MS: u64 = 250;
const CLI_SYNTHETIC_PLAN_MIN_CHARS: usize = 80;
const CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS: u64 = 45;

fn cli_exec_mode_bridge(mode: Option<&str>) -> Option<&'static str> {
    let mode = mode.and_then(AgentExecMode::parse)?;
    match mode {
        AgentExecMode::Plan => Some(concat!(
            "<orgii_cli_exec_mode_bridge>\n",
            "You are running inside ORGII PLAN mode. Plan mode is read-only unless the user explicitly approves Build later. ",
            "Do not implement, edit source files, run shell commands, or create the acceptance artifact.\n",
            "- If the user asks to draft, create, update, revise, or submit an approval plan, use an ORGII plan tool such as create_plan, EnterPlanMode/ExitPlanMode, or a plan-file workflow if available.\n",
            "- If no plan tool is available for an explicit plan request, output exactly one concise markdown plan with a title and concrete Build steps; ORGII will canonicalize that markdown into the approval card.\n",
            "- If the user asks an ordinary question, asks for clarification, or explicitly says not to modify the pending plan, answer the question directly and do not create, revise, or submit a plan.\n",
            "- After submitting/outputting an approval plan, stop.\n",
            "</orgii_cli_exec_mode_bridge>"
        )),
        AgentExecMode::Build => Some(concat!(
            "<orgii_cli_exec_mode_bridge>\n",
            "You are running inside ORGII BUILD mode. Execute the approved or requested work directly. ",
            "Do not create a new approval plan unless the user explicitly asks to switch back to Plan mode.\n",
            "</orgii_cli_exec_mode_bridge>"
        )),
        AgentExecMode::Ask => Some(concat!(
            "<orgii_cli_exec_mode_bridge>\n",
            "You are running inside ORGII ASK mode. Research and answer without editing files, applying patches, deleting files, or running write commands.\n",
            "</orgii_cli_exec_mode_bridge>"
        )),
        AgentExecMode::Debug => Some(concat!(
            "<orgii_cli_exec_mode_bridge>\n",
            "You are running inside ORGII DEBUG mode. Focus on diagnosis and evidence. Avoid implementation changes unless explicitly requested.\n",
            "</orgii_cli_exec_mode_bridge>"
        )),
        AgentExecMode::Review => Some(concat!(
            "<orgii_cli_exec_mode_bridge>\n",
            "You are running inside ORGII REVIEW mode. Inspect changes and produce a review verdict without modifying files.\n",
            "</orgii_cli_exec_mode_bridge>"
        )),
        AgentExecMode::Wingman => None,
    }
}

fn plan_candidate_path_from_chunk(chunk: &ActivityChunk, working_dir: &Path) -> Option<PathBuf> {
    if chunk.action_type != "tool_call" {
        return None;
    }
    let function = chunk.function.to_ascii_lowercase();
    if !function.contains("edit") && !function.contains("write") {
        return None;
    }
    if chunk.result.get("error").is_some()
        || chunk
            .result
            .get("status")
            .and_then(|value| value.as_str())
            .is_some_and(|status| status == "running")
    {
        return None;
    }

    let path = chunk
        .result
        .pointer("/success/path")
        .or_else(|| {
            chunk
                .result
                .get("success")
                .filter(|value| value.as_bool().unwrap_or(true))
                .and_then(|_| {
                    chunk
                        .args
                        .get("path")
                        .or_else(|| chunk.args.get("file_path"))
                })
        })
        .and_then(|value| value.as_str())?;
    let path_buf = PathBuf::from(path);
    let file_name = path_buf.file_name()?.to_string_lossy();
    if file_name == "ORGII_PLAN_REQUEST.md" || !file_name.ends_with(".md") {
        return None;
    }
    Some(if path_buf.is_absolute() {
        path_buf
    } else {
        working_dir.join(path_buf)
    })
}

fn is_successful_mode_tool(chunk: &ActivityChunk, tool_name: &str) -> bool {
    if chunk.action_type != "tool_call" || chunk.function != tool_name {
        return false;
    }
    if chunk.result.get("error").is_some() {
        return false;
    }
    chunk
        .result
        .pointer("/success")
        .is_some_and(|value| value.as_bool().unwrap_or(true))
        || chunk.result.get("content").is_some()
        || chunk.result.get("call_id").is_some()
}

fn plan_title_from_content(content: &str) -> String {
    content
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix('#')
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "CLI plan".to_string())
}

fn looks_like_buildable_plan_body(text: &str) -> bool {
    let normalized = text.trim();
    if normalized.len() < CLI_SYNTHETIC_PLAN_MIN_CHARS {
        return false;
    }
    let lower = normalized.to_ascii_lowercase();
    let has_action_marker = lower.contains("build")
        || lower.contains("implement")
        || lower.contains("create")
        || lower.contains("write")
        || lower.contains("modify")
        || lower.contains("update");
    let has_change_marker = lower.contains("change")
        || lower.contains("file")
        || lower.contains("artifact")
        || lower.contains("filesystem")
        || lower.contains(".md");
    let has_verification_marker = lower.contains("verification")
        || lower.contains("verify")
        || lower.contains("confirm")
        || lower.contains("exactly")
        || lower.contains("no other");
    has_action_marker && has_change_marker && has_verification_marker
}

fn looks_like_cli_plan_markdown(text: &str) -> bool {
    looks_like_buildable_plan_body(text)
}

fn user_requested_cli_plan(user_input: &str) -> bool {
    let lower = user_input.to_ascii_lowercase();
    let has_plan_word = lower.contains("plan")
        || lower.contains("approval")
        || lower.contains("build button")
        || lower.contains("build phase")
        || lower.contains("实施计划")
        || lower.contains("执行计划")
        || lower.contains("计划");
    if !has_plan_word {
        return false;
    }
    let has_plan_action = lower.contains("draft")
        || lower.contains("create")
        || lower.contains("make")
        || lower.contains("submit")
        || lower.contains("update")
        || lower.contains("revise")
        || lower.contains("replace")
        || lower.contains("generate")
        || lower.contains("write")
        || lower.contains("准备")
        || lower.contains("创建")
        || lower.contains("生成")
        || lower.contains("更新")
        || lower.contains("修改");
    let negates_plan_change = lower.contains("do not create")
        || lower.contains("do not revise")
        || lower.contains("do not submit")
        || lower.contains("do not modify the pending plan")
        || lower.contains("don't create")
        || lower.contains("don't revise")
        || lower.contains("don't submit")
        || lower.contains("不要创建")
        || lower.contains("不要生成")
        || lower.contains("不要修改")
        || lower.contains("别创建")
        || lower.contains("别生成")
        || lower.contains("别修改");
    has_plan_action && !negates_plan_change
}

fn is_assistant_text_chunk(chunk: &ActivityChunk) -> bool {
    matches!(
        chunk.action_type.as_str(),
        "assistant" | "assistant_delta" | "message" | "message_delta"
    )
}

fn create_plan_content_from_chunk(chunk: &ActivityChunk) -> Option<String> {
    if chunk.action_type != "tool_call" || chunk.result.get("error").is_some() {
        return None;
    }
    if chunk
        .result
        .get("status")
        .and_then(|value| value.as_str())
        .is_some_and(|status| status == "running")
    {
        return None;
    }
    let args = &chunk.args;
    let plan = args
        .get("content")
        .or_else(|| args.get("plan"))
        .and_then(|value| value.as_str())?;
    let name = args
        .get("title")
        .or_else(|| args.get("name"))
        .and_then(|value| value.as_str())
        .unwrap_or("CLI plan");
    if !looks_like_buildable_plan_body(plan) {
        return None;
    }
    Some(if plan.trim_start().starts_with('#') {
        plan.to_string()
    } else {
        format!("# {name}\n\n{plan}")
    })
}

fn synthetic_cli_plan_path(session_id: &str, sequence: i64) -> PathBuf {
    let safe_session_id = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    app_paths::orgii_root()
        .join("cli-plans")
        .join(safe_session_id)
        .join(format!("synthetic-plan-{sequence}.md"))
}

async fn register_synthetic_cli_plan_approval(
    session_id: &str,
    content: &str,
    origin_chunk_id: &str,
    sequence: i64,
) -> Result<ActivityChunk, String> {
    let plan_path = synthetic_cli_plan_path(session_id, sequence);
    if let Some(parent) = plan_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to create CLI synthetic plan directory: {err}"))?;
    }
    tokio::fs::write(&plan_path, content.as_bytes())
        .await
        .map_err(|err| format!("Failed to write CLI synthetic plan: {err}"))?;

    let mut source_chunk = ActivityChunk::new(session_id, "assistant", "message");
    source_chunk.chunk_id = origin_chunk_id.to_string();
    source_chunk.result = serde_json::json!({
        "content": content,
        "observation": content,
        "role": "assistant",
        "is_full_content": true,
    });
    register_cli_plan_approval(session_id, &source_chunk, &plan_path).await
}

fn plan_content_from_successful_write_chunk(chunk: &ActivityChunk) -> Option<String> {
    if chunk.action_type != "tool_call" || chunk.result.get("error").is_some() {
        return None;
    }
    if chunk
        .result
        .get("status")
        .and_then(|value| value.as_str())
        .is_some_and(|status| status == "running")
    {
        return None;
    }
    chunk
        .args
        .get("new_string")
        .or_else(|| chunk.args.get("content"))
        .or_else(|| chunk.args.get("plan"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(str::to_string)
}

async fn register_cli_plan_approval(
    session_id: &str,
    chunk: &ActivityChunk,
    plan_path: &Path,
) -> Result<ActivityChunk, String> {
    let plan_content = if let Some(content) = plan_content_from_successful_write_chunk(chunk) {
        content
    } else {
        tokio::fs::read_to_string(plan_path).await.map_err(|err| {
            format!(
                "Failed to read CLI plan file {}: {err}",
                plan_path.display()
            )
        })?
    };
    let plan_title = plan_title_from_content(&plan_content);
    let tool_call_id = chunk
        .args
        .get("call_id")
        .or_else(|| chunk.result.get("call_id"))
        .and_then(|value| value.as_str());

    let manager = agent_core::interaction::plan_approval::PlanApprovalManager::new();
    manager
        .mark_ready(
            session_id,
            plan_path.to_str().unwrap_or_default(),
            &plan_title,
            &plan_content,
            tool_call_id,
        )
        .await;

    let plan_id = format!(
        "plan-{}-{}",
        session_id,
        plan_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("plan")
            .replace(|character: char| !character.is_ascii_alphanumeric(), "-")
    );
    let plan_revision_id = tool_call_id.unwrap_or(&plan_id).to_string();
    let mut plan_chunk = ActivityChunk::new(session_id, "plan_approval", "plan_approval");
    plan_chunk.args = serde_json::json!({
        "title": plan_title,
        "content": plan_content,
        "planPath": plan_path.to_str().unwrap_or_default(),
        "planId": plan_id,
        "planRevisionId": plan_revision_id,
        "originToolCallId": tool_call_id,
        "planEventSource": "cli_plan",
    });
    plan_chunk.result = serde_json::json!({
        "status": "pending",
        "planId": plan_chunk.args.get("planId"),
        "planRevisionId": plan_chunk.args.get("planRevisionId"),
        "planPath": plan_chunk.args.get("planPath"),
    });
    Ok(plan_chunk)
}

fn is_transient_spawn_error(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    ) || err.raw_os_error().is_some_and(|code| code == libc::EAGAIN)
}

fn chunk_text(chunk: &core_types::activity::ActivityChunk) -> Option<String> {
    let result = &chunk.result;
    let text = result
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .or_else(|| result.get("content").and_then(|value| value.as_str()))
        .or_else(|| result.get("observation").and_then(|value| value.as_str()))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn chunk_role(chunk: &core_types::activity::ActivityChunk) -> Option<&'static str> {
    if chunk.function == "user_message" {
        return Some("User");
    }
    match chunk.action_type.as_str() {
        "assistant" | "assistant_delta" | "message" | "message_delta" => Some("Assistant"),
        _ => None,
    }
}

fn build_context_bridge(session_id: &str) -> Option<String> {
    let chunks = persistence::load_chunks(session_id).ok()?;
    let mut lines = Vec::new();
    for chunk in chunks.iter().rev() {
        if lines.len() >= CONTEXT_BRIDGE_MAX_MESSAGES {
            break;
        }
        let Some(role) = chunk_role(chunk) else {
            continue;
        };
        let Some(text) = chunk_text(chunk) else {
            continue;
        };
        lines.push(format!("{role}: {text}"));
    }
    if lines.is_empty() {
        return None;
    }
    lines.reverse();
    let mut body = lines.join("\n\n");
    if body.len() > CONTEXT_BRIDGE_MAX_CHARS {
        let mut start = body.len().saturating_sub(CONTEXT_BRIDGE_MAX_CHARS);
        while start < body.len() && !body.is_char_boundary(start) {
            start += 1;
        }
        body = body[start..].to_string();
    }

    let mutation_note = persistence::get_history_mutation(session_id)
        .ok()
        .flatten()
        .map(|mutation| {
            format!(
                "\nORGII history mutation marker: epoch={}, reason={}, mutated_at={}. The native CLI conversation state was intentionally discarded after this mutation; treat the ORGII conversation context below as authoritative.",
                mutation.epoch, mutation.reason, mutation.mutated_at
            )
        })
        .unwrap_or_default();

    Some(format!(
        "<orgii_context_bridge>\nThis CLI profile has no native conversation for this ORGII session yet. Continue using the ORGII conversation context below; do not repeat or summarize it unless the user asks.{}\n\n{}\n</orgii_context_bridge>",
        mutation_note, body
    ))
}

fn is_cli_oauth_failure_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    let auth_failure = lower.contains("refresh token")
        || lower.contains("access token")
        || lower.contains("auth token")
        || lower.contains("oauth")
        || lower.contains("unauthorized")
        || lower.contains("not authenticated")
        || lower.contains("authentication")
        || lower.contains("login required")
        || lower.contains("please log in")
        || lower.contains("please login")
        || lower.contains("revoked")
        || lower.contains("invalid_grant");
    let token_unusable = lower.contains("already used")
        || lower.contains("expired")
        || lower.contains("invalid")
        || lower.contains("could not be refreshed")
        || lower.contains("failed to refresh")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("denied")
        || lower.contains("rejected");

    auth_failure && token_unusable
}

fn chunk_error_message(chunk: &core_types::activity::ActivityChunk) -> Option<String> {
    let result = &chunk.result;
    result
        .get("error_message")
        .and_then(|value| value.as_str())
        .or_else(|| result.get("error").and_then(|value| value.as_str()))
        .or_else(|| result.get("message").and_then(|value| value.as_str()))
        .or_else(|| result.get("observation").and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn is_api_overloaded_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("overloaded_error")
        || lower.contains("overloaded")
        || lower.contains("529")
        || (lower.contains("api") && lower.contains("overload"))
        || lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("429")
}

fn is_retryable_overloaded_chunk(chunk: &core_types::activity::ActivityChunk) -> Option<String> {
    let message = chunk_error_message(chunk)?;
    if is_api_overloaded_message(&message) {
        Some(message)
    } else {
        None
    }
}

fn is_cli_oauth_retry_agent(agent: &ModelType) -> bool {
    matches!(
        agent,
        ModelType::Codex | ModelType::ClaudeCode | ModelType::GeminiCli
    )
}

fn is_cli_oauth_stderr_retry_candidate(
    agent: &ModelType,
    key_source: KeySource,
    exit_code: i32,
    replay_unsafe_output_seen: bool,
) -> bool {
    key_source == KeySource::OwnKey
        && exit_code != 0
        && !replay_unsafe_output_seen
        && is_cli_oauth_retry_agent(agent)
}

fn is_retryable_cli_oauth_failure_chunk(
    agent: &ModelType,
    key_source: KeySource,
    chunk: &core_types::activity::ActivityChunk,
) -> Option<String> {
    if key_source != KeySource::OwnKey || !is_cli_oauth_retry_agent(agent) {
        return None;
    }
    let message = chunk_error_message(chunk)?;
    if is_cli_oauth_failure_message(&message) {
        Some(message)
    } else {
        None
    }
}

fn is_cli_chunk_replay_unsafe(chunk: &core_types::activity::ActivityChunk) -> bool {
    matches!(
        chunk.action_type.as_str(),
        "assistant"
            | "assistant_delta"
            | "message"
            | "message_delta"
            | "llm_thinking"
            | "llm_thinking_delta"
            | "tool_call"
            | "tool_call_delta"
            | "error"
    )
}

fn sanitize_cli_oauth_env_for_child(
    agent: &ModelType,
    env_vars: &mut std::collections::HashMap<String, String>,
) {
    match agent {
        ModelType::Codex => {
            env_vars.remove(CODEX_REFRESH_TOKEN_ENV_KEY);
            env_vars.remove(CODEX_ID_TOKEN_ENV_KEY);
        }
        ModelType::GeminiCli => {
            env_vars.remove("GEMINI_REFRESH_TOKEN");
        }
        ModelType::ClaudeCode => {
            env_vars.remove("CLAUDE_CODE_REFRESH_TOKEN");
            env_vars.remove("CLAUDE_CODE_OAUTH_REFRESH_TOKEN");
            env_vars.remove("CLAUDE_CODE_OAUTH_SCOPES");
        }
        _ => {}
    }
}

fn write_codex_cli_auth_file(
    account_id: &str,
    env_vars: &std::collections::HashMap<String, String>,
) {
    let codex_home = app_paths::codex_cli_profile_dir(account_id);
    if let Err(err) = std::fs::create_dir_all(&codex_home) {
        tracing::warn!("[CodeSession] Failed to create Codex home: {}", err);
        return;
    }

    let home_path = codex_home.to_string_lossy().to_string();
    tracing::info!("[CodeSession] CODEX_HOME={}", home_path);

    let auth_path = codex_home.join("auth.json");
    let access_token = env_vars.get("OPENAI_API_KEY").cloned().unwrap_or_default();
    let refresh_token = env_vars.get(CODEX_REFRESH_TOKEN_ENV_KEY).cloned();
    let id_token = env_vars.get(CODEX_ID_TOKEN_ENV_KEY).cloned();
    let account_id_from_token = id_token.as_deref().and_then(|token| {
        agent_core::core::providers::codex_native::extract_account_id_from_id_token(token)
    });

    if access_token.trim().is_empty() {
        return;
    }

    let last_refresh = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    let auth_json = serde_json::json!({
        "OPENAI_API_KEY": serde_json::Value::Null,
        "tokens": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "id_token": id_token,
            "account_id": account_id_from_token,
        },
        "last_refresh": last_refresh,
    });
    let write_result = serde_json::to_vec_pretty(&auth_json)
        .map_err(|err| err.to_string())
        .and_then(|bytes| std::fs::write(&auth_path, bytes).map_err(|err| err.to_string()));
    match write_result {
        Ok(()) => tracing::info!(
            "[CodeSession] Wrote fresh Codex auth.json to {:?}",
            auth_path
        ),
        Err(err) => tracing::warn!("[CodeSession] Failed to write Codex auth.json: {}", err),
    }
}

fn gemini_cli_oauth_payload(
    env_vars: &HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let access_token = env_vars
        .get("GEMINI_ACCESS_TOKEN")
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Gemini OAuth profile requires GEMINI_ACCESS_TOKEN".to_string())?;
    let refresh_token = env_vars.get("GEMINI_REFRESH_TOKEN").cloned();
    let expiry = env_vars
        .get("GEMINI_EXPIRES_AT")
        .cloned()
        .unwrap_or_else(|| {
            (Utc::now() + chrono::Duration::hours(1)).to_rfc3339_opts(SecondsFormat::Secs, true)
        });
    let expiry_date = chrono::DateTime::parse_from_rfc3339(&expiry)
        .map(|date| date.timestamp_millis())
        .unwrap_or_else(|_| (Utc::now() + chrono::Duration::hours(1)).timestamp_millis());
    let client_id = std::env::var("GEMINI_OAUTH_CLIENT_ID").unwrap_or_else(|_| {
        [
            "681255809395-oo8ft2oprd",
            "rnp9e3aqf6av3hmdib135j",
            ".apps.googleusercontent.com",
        ]
        .concat()
    });
    let client_secret = std::env::var("GEMINI_OAUTH_CLIENT_SECRET")
        .unwrap_or_else(|_| ["GOCSPX-", "4uHgMPm-1o7", "Sk-geV6Cu5clXFsxl"].concat());

    Ok(serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "scope": env_vars.get("GEMINI_SCOPE").cloned().unwrap_or_else(|| "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile".to_string()),
        "token_type": env_vars.get("GEMINI_TOKEN_TYPE").cloned().unwrap_or_else(|| "Bearer".to_string()),
        "expiry": expiry,
        "expiry_date": expiry_date,
        "expiryDate": expiry_date,
        "client_id": client_id,
        "client_secret": client_secret,
    }))
}

fn gemini_cli_oauth_settings_payload() -> serde_json::Value {
    serde_json::json!({
        "ide": {
            "enabled": false
        },
        "security": {
            "auth": {
                "selectedType": "oauth-personal"
            }
        },
        "context": {
            "loadMemoryFromIncludeDirectories": true
        }
    })
}

fn gemini_cli_api_key_settings_payload() -> serde_json::Value {
    serde_json::json!({
        "ide": {
            "enabled": false
        },
        "security": {
            "auth": {
                "selectedType": "gemini-api-key"
            }
        }
    })
}

fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    std::fs::write(path, bytes).map_err(|err| err.to_string())
}

fn write_gemini_cli_oauth_files_at(
    gemini_home: &Path,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    let gemini_dir = gemini_home.join(".gemini");
    std::fs::create_dir_all(&gemini_dir)
        .map_err(|err| format!("Failed to create Gemini home: {}", err))?;

    write_json_file(
        &gemini_dir.join("oauth_creds.json"),
        &gemini_cli_oauth_payload(env_vars)?,
    )?;
    write_json_file(
        &gemini_dir.join("settings.json"),
        &gemini_cli_oauth_settings_payload(),
    )?;
    tracing::info!(
        "[CodeSession] Wrote Gemini OAuth files under {:?}",
        gemini_dir
    );
    Ok(())
}

fn write_gemini_cli_oauth_files(
    account_id: &str,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    write_gemini_cli_oauth_files_at(&app_paths::gemini_cli_profile_dir(account_id), env_vars)
}

fn write_gemini_cli_api_key_settings_at(gemini_home: &Path) -> Result<(), String> {
    let gemini_dir = gemini_home.join(".gemini");
    std::fs::create_dir_all(&gemini_dir)
        .map_err(|err| format!("Failed to create Gemini home: {}", err))?;
    write_json_file(
        &gemini_dir.join("settings.json"),
        &gemini_cli_api_key_settings_payload(),
    )
}

fn setup_gemini_cli_home(
    session_key_source: KeySource,
    session_id: &str,
    account_id: Option<&str>,
    env_vars: &HashMap<String, String>,
) -> Result<PathBuf, String> {
    let gemini_home = if session_key_source == KeySource::HostedKey {
        app_paths::gemini_cli_home(session_id)
    } else {
        let account_id = account_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Gemini CLI own-key session requires account_id".to_string())?;
        app_paths::gemini_cli_profile_dir(account_id)
    };

    if session_key_source == KeySource::OwnKey
        && env_vars
            .get("GEMINI_ACCESS_TOKEN")
            .is_some_and(|token| !token.trim().is_empty())
    {
        write_gemini_cli_oauth_files_at(&gemini_home, env_vars)?;
    } else {
        write_gemini_cli_api_key_settings_at(&gemini_home)?;
    }

    Ok(gemini_home)
}

async fn refresh_cli_oauth_for_retry(
    agent: &ModelType,
    account_id: Option<&str>,
    env_vars: &mut std::collections::HashMap<String, String>,
) -> Result<bool, String> {
    let Some(account_id) = account_id else {
        return Ok(false);
    };

    let refreshed = match agent {
        ModelType::Codex => Some(
            KEY_SERVICE
                .refresh_codex_oauth_key(
                    account_id,
                    env_vars
                        .get("OPENAI_API_KEY")
                        .map(String::as_str)
                        .unwrap_or(""),
                )
                .await?,
        ),
        ModelType::ClaudeCode => Some(
            KEY_SERVICE
                .refresh_claude_code_oauth_key(
                    account_id,
                    env_vars
                        .get("ANTHROPIC_AUTH_TOKEN")
                        .map(String::as_str)
                        .unwrap_or(""),
                )
                .await?,
        ),
        ModelType::GeminiCli => Some(
            KEY_SERVICE
                .refresh_gemini_oauth_key_after_rejection(
                    account_id,
                    env_vars
                        .get("GEMINI_ACCESS_TOKEN")
                        .map(String::as_str)
                        .unwrap_or(""),
                )
                .await?,
        ),
        _ => None,
    };

    if refreshed.is_none() {
        return Ok(false);
    }

    let refreshed_env = KEY_SERVICE.get_env_for_agent(agent, Some(account_id));
    for (key, value) in refreshed_env {
        env_vars.insert(key, value);
    }
    if matches!(agent, ModelType::Codex) {
        write_codex_cli_auth_file(account_id, env_vars);
    }
    if matches!(agent, ModelType::GeminiCli) {
        write_gemini_cli_oauth_files(account_id, env_vars)?;
    }
    sanitize_cli_oauth_env_for_child(agent, env_vars);
    Ok(true)
}

fn sync_codex_cli_auth_to_key_vault(
    account_id: Option<&str>,
    launched_access_token: Option<&str>,
) -> Result<(), String> {
    let Some(account_id) = account_id else {
        return Ok(());
    };
    let auth_path = app_paths::codex_cli_profile_dir(account_id).join("auth.json");
    if !auth_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&auth_path).map_err(|err| {
        format!(
            "Failed to read Codex auth file {}: {err}",
            auth_path.display()
        )
    })?;
    let auth: CodexCliAuthConfig = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse Codex auth file {}: {err}",
            auth_path.display()
        )
    })?;
    let Some(tokens) = auth.tokens else {
        return Ok(());
    };

    let access_token = tokens.access_token.filter(|token| !token.trim().is_empty());
    let refresh_token = tokens
        .refresh_token
        .filter(|token| !token.trim().is_empty());
    let id_token = tokens.id_token.filter(|token| !token.trim().is_empty());

    if access_token.is_none() && refresh_token.is_none() && id_token.is_none() {
        return Ok(());
    }

    let outcome = KEY_SERVICE
        .sync_cli_oauth_tokens_if_current(
            account_id,
            ModelType::Codex,
            launched_access_token,
            CliOAuthTokenSync {
                access_token,
                refresh_token,
                id_token,
                expires_at: None,
            },
        )
        .map_err(|err| format!("Failed to save refreshed Codex CLI tokens: {err}"))?;
    if matches!(outcome, CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken) {
        tracing::warn!(
            "[CodeSession] Skipped Codex CLI auth sync because Key Vault has a newer access token"
        );
    }
    Ok(())
}

fn sync_gemini_cli_auth_to_key_vault(
    account_id: Option<&str>,
    launched_access_token: Option<&str>,
) -> Result<(), String> {
    let Some(account_id) = account_id else {
        return Ok(());
    };
    let auth_path = app_paths::gemini_cli_profile_dir(account_id)
        .join(".gemini")
        .join("oauth_creds.json");
    if !auth_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&auth_path).map_err(|err| {
        format!(
            "Failed to read Gemini OAuth file {}: {err}",
            auth_path.display()
        )
    })?;
    let auth: serde_json::Value = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse Gemini OAuth file {}: {err}",
            auth_path.display()
        )
    })?;

    let access_token = auth
        .get("access_token")
        .and_then(|value| value.as_str())
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string);
    let refresh_token = auth
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string);
    let expiry = auth
        .get("expiry")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            auth.get("expiry_date")
                .or_else(|| auth.get("expiryDate"))
                .and_then(|value| value.as_i64())
                .and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
                .map(|date| date.to_rfc3339_opts(SecondsFormat::Secs, true))
        });

    if access_token.is_none() && refresh_token.is_none() && expiry.is_none() {
        return Ok(());
    }

    let outcome = KEY_SERVICE
        .sync_cli_oauth_tokens_if_current(
            account_id,
            ModelType::GeminiCli,
            launched_access_token,
            CliOAuthTokenSync {
                access_token,
                refresh_token,
                id_token: None,
                expires_at: expiry,
            },
        )
        .map_err(|err| format!("Failed to save refreshed Gemini CLI tokens: {err}"))?;
    if matches!(outcome, CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken) {
        tracing::warn!(
            "[CodeSession] Skipped Gemini CLI auth sync because Key Vault has a newer access token"
        );
    }
    Ok(())
}

/// Run a code session: spawn CLI, parse stdout, broadcast events.
///
/// This is spawned as a background Tokio task.
/// When `cli_resume_id` is provided, the CLI is launched with the appropriate
/// resume flag to continue a previous conversation.
pub async fn run_session(
    session_id: String,
    user_input: String,
    cli_resume_id: Option<String>,
    mode: Option<&str>,
    images: Option<Vec<String>>,
) -> Result<(), String> {
    let session = persistence::get_session(&session_id)
        .map_err(|e| format!("DB error: {}", e))?
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let cli_agent_type_str = session
        .cli_agent_type
        .as_deref()
        .ok_or("cli_agent_type is required but was not set on the session")?;
    let agent = ModelType::from_str(cli_agent_type_str).ok_or_else(|| {
        format!(
            "Unknown CLI agent type: '{}'. Supported: cursor_cli, claude_code, codex, gemini_cli, kiro, copilot, opencode",
            cli_agent_type_str
        )
    })?;
    // When using a cross-type compatible key (e.g. moonshot_api key for claude_code),
    // the model override is injected via ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_*_MODEL env vars
    // in agent_env_builder. Passing --model with a provider-specific name (e.g. "kimi-for-coding")
    // triggers Claude Code's model validation and fails. Skip --model in that case.
    let mut selected_key = session
        .account_id
        .as_deref()
        .and_then(|id| key_vault::key_store::KEY_SERVICE.get_key_by_id(id));
    if session.key_source == KeySource::OwnKey {
        if let Some(account_id) = session.account_id.as_deref() {
            selected_key = match agent {
                ModelType::Codex => {
                    Some(KEY_SERVICE.ensure_codex_oauth_key_fresh(account_id).await?)
                }
                ModelType::ClaudeCode => Some(
                    KEY_SERVICE
                        .ensure_claude_code_oauth_key_fresh(account_id)
                        .await?,
                ),
                ModelType::GeminiCli => Some(
                    KEY_SERVICE
                        .ensure_gemini_oauth_key_fresh(account_id)
                        .await?,
                ),
                _ => selected_key,
            };
        }
    }
    let key_model_type = selected_key.as_ref().map(|key| key.model_type.clone());
    let is_cross_type_key = key_model_type.as_ref().is_some_and(|kt| kt != &agent);
    let model = if is_cross_type_key {
        None
    } else {
        session.model.as_deref()
    };
    let repo_path = session.repo_path.as_deref();
    let account_id = session.account_id.as_deref();

    if matches!(agent, ModelType::CursorCli) && session.key_source == KeySource::OwnKey {
        let has_api_key = selected_key
            .as_ref()
            .and_then(|key| key.api_key.as_deref())
            .is_some_and(|api_key| !api_key.trim().is_empty());
        let has_session_token = selected_key
            .as_ref()
            .and_then(|key| key.session_token.as_deref())
            .is_some_and(|session_token| !session_token.trim().is_empty());
        if !has_api_key {
            let reason = if has_session_token {
                "Cursor CLI agent requires a Cursor API key or Cursor Agent CLI login state. The saved native session token only works for the native/Rust Cursor provider and cannot authenticate cursor-agent directly."
            } else {
                "Cursor CLI agent requires a Cursor API key or Cursor Agent CLI login state before launching cursor-agent."
            };
            return Err(reason.to_string());
        }
    }

    // Sync .orgii/agent-rules.md → agent-native rules file
    let mut synced_rule_files: Vec<std::path::PathBuf> = Vec::new();
    if let Some(path) = repo_path {
        let project = std::path::Path::new(path);
        synced_rule_files.extend(super::super::skill_sync::sync_conventions_for_agent(
            &agent, project,
        ));
    }

    // Sync skills to agent-native rules files.
    //
    // Agent resolve contract (design doc §11.4) row 17: resolve the built-in SDE agent (the CLI
    // session runner doesn't own an `agent_definition_id`; skills opts
    // are a host-wide concern carried on the SDE definition) and read
    // `skills.enabled` + `skills.disabled` off `ResolvedAgent`.
    let skills_cfg = resolve_sde_skills();
    if let Some(path) = repo_path {
        let project = std::path::Path::new(path);
        synced_rule_files.extend(super::super::skill_sync::sync_skills_for_agent(
            &agent,
            project,
            skills_cfg.enabled,
            &skills_cfg.disabled,
        ));
    }

    // Pre-message anchor snapshot for CLI rollback support.
    // `snapshot_cli_file_edit` populates this snapshot with git-HEAD bytes of
    // each file the agent touches, filling the gap that SDE Agent closes via
    // `UnifiedEventHandler::take_snapshot` (which fires before the tool runs).
    let pre_message_snapshot_id = match agent_core::tools::file_history::make_snapshot(&session_id)
    {
        Ok(snapshot_id) => {
            tracing::info!(
                "[code_session] Pre-message anchor snapshot: {}",
                snapshot_id
            );
            if let Err(err) = agent_core::session::persistence::save_snapshot(
                &session_id,
                "__pre_message__",
                &snapshot_id,
            ) {
                tracing::warn!(
                    "[code_session] Failed to persist pre-message snapshot: {}",
                    err
                );
            }
            Some(snapshot_id)
        }
        Err(err) => {
            tracing::warn!("[code_session] Pre-message snapshot failed: {}", err);
            None
        }
    };

    let run_started_at = chrono::Utc::now();

    let image_paths = persist_attached_images(&session_id, images.as_deref()).await;

    let mut effective_input = user_input.clone();

    if let Some(exec_mode_bridge) = cli_exec_mode_bridge(mode) {
        effective_input = format!("{}\n\n{}", exec_mode_bridge, effective_input);
    }

    if cli_resume_id.is_none() {
        if let Some(context_bridge) = build_context_bridge(&session_id) {
            effective_input = format!("{}\n\n{}", context_bridge, effective_input);
        }
    }

    if !image_paths.is_empty() && !agent.is_acp() {
        let refs: Vec<String> = image_paths
            .iter()
            .enumerate()
            .map(|(idx, path)| format!("Image {}: {}", idx + 1, path))
            .collect();
        effective_input = format!(
            "{}\n\nIMPORTANT: The user attached {} image(s). You MUST read each image file below before responding. Use your read_file or view_image tool on these absolute paths:\n{}",
            effective_input,
            image_paths.len(),
            refs.join("\n"),
        );
    }

    // For ACP agents without native rules file sync, inject skills into the prompt.
    // Reuse the already-resolved skills config (§11.4 row 17).
    if matches!(agent, ModelType::Kiro | ModelType::OpenCode) {
        if let Some(path) = repo_path {
            if let Some(skills_block) = super::super::skill_sync::build_skills_prompt_injection(
                std::path::Path::new(path),
                skills_cfg.enabled,
                &skills_cfg.disabled,
            ) {
                effective_input = format!("{}\n\n{}", skills_block, effective_input);
            }
        }
    }

    // Build CLI command
    let api_key_for_cli = if session.key_source == KeySource::HostedKey
        && (matches!(agent, ModelType::CursorCli) || agent.needs_mitm_proxy())
    {
        session.proxy_token.as_deref()
    } else if session.key_source == KeySource::OwnKey && matches!(agent, ModelType::CursorCli) {
        selected_key.as_ref().and_then(|key| key.api_key.as_deref())
    } else {
        None
    };
    let endpoint_for_cli =
        if session.key_source == KeySource::HostedKey && matches!(agent, ModelType::CursorCli) {
            session.proxy_url.as_deref()
        } else {
            None
        };
    let additional_dirs: &[String] = session.additional_directories.as_deref().unwrap_or(&[]);
    let mut cmd_parts = build_command(
        &agent,
        model,
        &effective_input,
        cli_resume_id.as_deref(),
        api_key_for_cli,
        endpoint_for_cli,
        mode,
        repo_path,
        additional_dirs,
    );

    if matches!(agent, ModelType::Codex) && session.key_source == KeySource::HostedKey {
        let insert_pos = cmd_parts.len() - 1;
        cmd_parts.insert(insert_pos, "-c".into());
        cmd_parts.insert(insert_pos + 1, "model_provider=\"proxy\"".into());
    }

    let program = &cmd_parts[0];
    let args = &cmd_parts[1..];

    // Log the full command for debugging (redact sensitive values)
    {
        let redacted_args: Vec<String> = cmd_parts
            .iter()
            .enumerate()
            .map(|(idx, part)| {
                if idx > 0
                    && (cmd_parts[idx - 1] == "--api-key" || cmd_parts[idx - 1] == "--market-token")
                {
                    format!(
                        "{}...{}",
                        &part[..part.len().min(6)],
                        &part[part.len().saturating_sub(4)..]
                    )
                } else {
                    part.clone()
                }
            })
            .collect();
        tracing::info!(
            "[CodeSession] Command: {} (resume_id={:?})",
            redacted_args.join(" "),
            cli_resume_id,
        );
    }

    let base_working_dir = repo_path.filter(|p| !p.is_empty()).ok_or_else(|| {
        "repo_path is required — cannot run agent without a working directory".to_string()
    })?;

    let working_dir = session
        .worktree_path
        .as_deref()
        .filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir())
        .unwrap_or(base_working_dir);

    if !std::path::Path::new(&working_dir).is_dir() {
        return Err(format!(
            "Working directory does not exist or is not a directory: {}",
            working_dir
        ));
    }

    let snapshot_working_dir = working_dir.to_string();

    // ── Build environment variables ──
    let mut env_vars = if session.key_source == KeySource::HostedKey {
        let proxy_token = session
            .proxy_token
            .as_deref()
            .ok_or_else(|| "proxy_token is required for market key sessions".to_string())?;
        let proxy_url = session
            .proxy_url
            .as_deref()
            .ok_or_else(|| "proxy_url is required for market key sessions".to_string())?;
        KeyService::get_proxy_env_for_agent(&agent, proxy_token, proxy_url)
    } else {
        KEY_SERVICE.get_env_for_agent(&agent, account_id)
    };

    if matches!(agent, ModelType::CursorCli) {
        env_vars.insert("CURSOR_CLI_COMPAT".to_string(), "1".to_string());
    }

    // Store user input (without IDE context)
    let display_input = strip_ide_context(&user_input);
    {
        let conn = session_persistence::get_connection().map_err(|e| format!("DB: {}", e))?;
        conn.execute(
            "UPDATE code_sessions SET user_input = ?2 WHERE session_id = ?1",
            rusqlite::params![session_id, display_input],
        )
        .map_err(|e| format!("DB: failed to store user_input: {}", e))?;
    }

    if let Err(err) = persistence::update_status(&session_id, SessionStatus::Running) {
        tracing::error!("[CodeSession] Failed to update status to running: {}", err);
        return Err(format!("DB error updating status: {}", err));
    }

    let running_msg = serde_json::json!({
        "type": "code_session.status_changed",
        "session_id": session_id,
        "status": "running",
    });
    websocket_handler::broadcast(running_msg.to_string());

    // Start per-session MITM proxy if needed
    let needs_mitm = session.key_source == KeySource::HostedKey && agent.needs_mitm_proxy();

    if needs_mitm {
        let proxy_token_val = session
            .proxy_token
            .as_deref()
            .ok_or_else(|| "proxy_token is required for MITM proxy sessions".to_string())?;
        let proxy_url_val = session
            .proxy_url
            .as_deref()
            .ok_or_else(|| "proxy_url is required for MITM proxy sessions".to_string())?;

        let port = integrations::proxy::server::start_session_proxy(
            &session_id,
            proxy_token_val,
            proxy_url_val,
        )
        .await?;

        tracing::info!(
            "[CodeSession] Started per-session MITM proxy on port {} for session {}",
            port,
            session_id
        );

        let cert_file = integrations::proxy::server::get_ssl_cert_file();
        let proxy_addr = format!("http://127.0.0.1:{}", port);
        env_vars.insert(proxy_env::HTTPS_PROXY.to_string(), proxy_addr.clone());
        env_vars.insert(proxy_env::HTTPS_PROXY_LOWER.to_string(), proxy_addr.clone());
        env_vars.insert("HTTP_PROXY".to_string(), proxy_addr.clone());
        env_vars.insert("http_proxy".to_string(), proxy_addr);
        env_vars.insert(proxy_env::SSL_CERT_FILE.to_string(), cert_file.clone());
        env_vars.insert(proxy_env::NODE_EXTRA_CA_CERTS.to_string(), cert_file);
    }

    if matches!(agent, ModelType::CursorCli) {
        let cursor_config_dir = if session.key_source == KeySource::HostedKey {
            Some(app_paths::cursor_config_dir(&session_id))
        } else {
            account_id.map(app_paths::cursor_cli_profile_dir)
        };

        if let Some(orgii_dir) = cursor_config_dir {
            if let Err(err) = std::fs::create_dir_all(&orgii_dir) {
                tracing::warn!("[CodeSession] Failed to create cursor config dir: {}", err);
            } else {
                let config_path = orgii_dir.to_string_lossy().to_string();
                tracing::info!("[CodeSession] CURSOR_CONFIG_DIR={}", config_path);
                env_vars.insert("CURSOR_CONFIG_DIR".to_string(), config_path);

                if session.key_source == KeySource::HostedKey {
                    let config_content = r#"{"version": 1, "network": {"useHttp1ForAgent": true}}"#;
                    if let Err(err) =
                        std::fs::write(orgii_dir.join("cli-config.json"), config_content)
                    {
                        tracing::warn!("[CodeSession] Failed to write cursor config: {}", err);
                    }
                }
            }
        }
    }

    if matches!(agent, ModelType::ClaudeCode) {
        let claude_config_dir = if session.key_source == KeySource::HostedKey {
            Some(app_paths::claude_code_cli_profile_dir(&session_id))
        } else {
            account_id.map(app_paths::claude_code_cli_profile_dir)
        };

        if let Some(orgii_dir) = claude_config_dir {
            if let Err(err) = std::fs::create_dir_all(&orgii_dir) {
                tracing::warn!(
                    "[CodeSession] Failed to create Claude Code config dir: {}",
                    err
                );
            } else {
                let config_path = orgii_dir.to_string_lossy().to_string();
                tracing::info!("[CodeSession] CLAUDE_CONFIG_DIR={}", config_path);
                env_vars.insert("CLAUDE_CONFIG_DIR".to_string(), config_path);
            }
        }
    }

    if matches!(agent, ModelType::Codex) && session.key_source == KeySource::OwnKey {
        let Some(account_id) = account_id else {
            return Err("Codex CLI own-key session requires account_id".to_string());
        };
        let codex_home = app_paths::codex_cli_profile_dir(account_id);
        env_vars.insert(
            "CODEX_HOME".to_string(),
            codex_home.to_string_lossy().to_string(),
        );
        write_codex_cli_auth_file(account_id, &env_vars);
    }

    if matches!(agent, ModelType::GeminiCli) {
        let gemini_home =
            setup_gemini_cli_home(session.key_source, &session_id, account_id, &env_vars)
                .map_err(|err| format!("Failed to setup Gemini CLI home: {}", err))?;
        let home_path = gemini_home.to_string_lossy().to_string();
        tracing::info!("[CodeSession] GEMINI_CLI_HOME={}", home_path);
        env_vars.insert("GEMINI_CLI_HOME".to_string(), home_path);
    }

    if matches!(agent, ModelType::Kiro) {
        let kiro_home = if session.key_source == KeySource::HostedKey {
            let proxy_token_val = session.proxy_token.as_deref().unwrap_or("");
            let region_val = "us-east-1";
            match crate::agent_sessions::cli::platform_adapters::kiro::proxy_auth::setup_proxy_auth_db(
                proxy_token_val,
                region_val,
                &session_id,
            ) {
                Ok(temp_home) => Some(temp_home),
                Err(err) => {
                    tracing::error!("[CodeSession] Failed to setup Kiro proxy auth DB: {}", err);
                    return Err(format!("Failed to setup Kiro proxy auth DB: {}", err));
                }
            }
        } else {
            match account_id {
                Some(account_id) => {
                    let profile_home = app_paths::kiro_cli_profile_dir(account_id);
                    match crate::agent_sessions::cli::platform_adapters::kiro::proxy_auth::setup_own_key_home(
                        &profile_home,
                        &env_vars,
                    ) {
                        Ok(()) => Some(profile_home),
                        Err(err) => {
                            tracing::error!("[CodeSession] Failed to setup Kiro own-key auth DB: {}", err);
                            return Err(format!("Failed to setup Kiro own-key auth DB: {}", err));
                        }
                    }
                }
                None => None,
            }
        };

        if let Some(kiro_home) = kiro_home {
            let home_path = kiro_home.to_string_lossy().to_string();
            tracing::info!("[CodeSession] Kiro HOME={}", home_path);
            #[cfg(unix)]
            if let Some(real_home) = dirs::home_dir() {
                let real_bin = real_home.join(".local/bin");
                let real_bin_str = real_bin.to_string_lossy().to_string();
                let current_path = std::env::var("PATH").unwrap_or_default();
                if !current_path.contains(&real_bin_str) {
                    env_vars.insert(
                        "PATH".to_string(),
                        format!("{}:{}", real_bin_str, current_path),
                    );
                }
            }
            env_vars.insert("HOME".to_string(), home_path);
        }
    }
    if matches!(agent, ModelType::Kiro) {
        if let Some(ref resume_id) = cli_resume_id {
            kiro::clean_stale_lock(resume_id);
        }
    }

    // Forward system proxy env vars
    for (lower, upper) in &[
        ("http_proxy", "HTTP_PROXY"),
        ("https_proxy", "HTTPS_PROXY"),
        ("no_proxy", "NO_PROXY"),
    ] {
        let value = std::env::var(lower).or_else(|_| std::env::var(upper)).ok();
        if let Some(ref val) = value {
            env_vars
                .entry(lower.to_string())
                .or_insert_with(|| val.clone());
            env_vars
                .entry(upper.to_string())
                .or_insert_with(|| val.clone());
        }
    }

    let no_proxy_extras = "localhost,127.0.0.1";
    for key in &["no_proxy", "NO_PROXY"] {
        let current = env_vars.get(*key).cloned().unwrap_or_default();
        if current.is_empty() {
            env_vars.insert(key.to_string(), no_proxy_extras.to_string());
        } else if !current.contains("localhost") {
            env_vars.insert(key.to_string(), format!("{},{}", current, no_proxy_extras));
        }
    }

    sanitize_cli_oauth_env_for_child(&agent, &mut env_vars);

    // Log environment variables for debugging (redact token values)
    for (key, value) in &env_vars {
        let display_val = if key.to_lowercase().contains("token")
            || key.to_lowercase().contains("key")
            || key.to_lowercase().contains("secret")
        {
            format!(
                "{}...{}",
                &value[..value.len().min(6)],
                &value[value.len().saturating_sub(4)..]
            )
        } else {
            value.clone()
        };
        tracing::info!("[CodeSession] env {}={}", key, display_val);
    }

    // ── Codex proxy setup ──
    if matches!(agent, ModelType::Codex) && session.key_source == KeySource::HostedKey {
        if let Some(home) = dirs::home_dir() {
            let proxy_url_val = session.proxy_url.as_deref().unwrap_or("");
            let codex_dir = home.join(".codex");
            let config_file = codex_dir.join("config.toml");

            let needs_proxy_section = if config_file.exists() {
                std::fs::read_to_string(&config_file)
                    .map(|content| !content.contains("[model_providers.proxy]"))
                    .unwrap_or(true)
            } else {
                true
            };

            if needs_proxy_section {
                if let Err(err) = std::fs::create_dir_all(&codex_dir) {
                    tracing::warn!("[CodeSession] Failed to create ~/.codex dir: {}", err);
                } else {
                    let proxy_section = format!(
                        "\n[model_providers.proxy]\n\
                         name = \"Proxy\"\n\
                         base_url = \"{}/v1\"\n\
                         env_key = \"PROXY_TOKEN\"\n\
                         requires_openai_auth = false\n\
                         wire_api = \"responses\"\n",
                        proxy_url_val
                    );
                    let write_result = if config_file.exists() {
                        std::fs::OpenOptions::new()
                            .append(true)
                            .open(&config_file)
                            .and_then(|mut file| {
                                use std::io::Write;
                                file.write_all(proxy_section.as_bytes())
                            })
                    } else {
                        std::fs::write(&config_file, proxy_section.trim_start())
                    };
                    match write_result {
                        Ok(()) => tracing::info!(
                            "[CodeSession] Wrote codex proxy config to {:?}",
                            config_file
                        ),
                        Err(err) => tracing::warn!(
                            "[CodeSession] Failed to write codex config.toml: {}",
                            err
                        ),
                    }
                }
            }
        }

        let api_key_val = session.proxy_token.as_deref().unwrap_or("");
        if !api_key_val.is_empty() {
            tracing::info!("[CodeSession] Running codex login --with-api-key...");
            match Command::new("codex")
                .arg("login")
                .arg("--with-api-key")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .envs(&env_vars)
                .spawn()
            {
                Ok(mut login_child) => {
                    if let Some(mut stdin) = login_child.stdin.take() {
                        use tokio::io::AsyncWriteExt;
                        let _ = stdin.write_all(api_key_val.as_bytes()).await;
                        drop(stdin);
                    }
                    match login_child.wait().await {
                        Ok(status) if status.success() => {
                            tracing::info!("[CodeSession] codex login succeeded");
                        }
                        Ok(status) => {
                            tracing::warn!(
                                "[CodeSession] codex login failed (exit {:?}) — continuing anyway",
                                status.code()
                            );
                        }
                        Err(err) => {
                            tracing::warn!(
                                "[CodeSession] codex login wait error: {} — continuing anyway",
                                err
                            );
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        "[CodeSession] Failed to spawn codex login: {} — continuing anyway",
                        err
                    );
                }
            }
        }
    }

    // ── OpenCode: start SSE sanitizer proxy if Anthropic baseURL is configured ──
    if matches!(agent, ModelType::OpenCode) {
        if let Ok(config_text) = std::fs::read_to_string(
            dirs::config_dir()
                .unwrap_or_default()
                .join("opencode")
                .join("opencode.json"),
        ) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_text) {
                let base_url = config
                    .get("provider")
                    .and_then(|p| p.get("anthropic"))
                    .and_then(|a| a.get("options"))
                    .and_then(|o| o.get("baseURL"))
                    .and_then(|v| v.as_str());
                if let Some(upstream) = base_url {
                    if !upstream.contains("127.0.0.1") && !upstream.contains("localhost") {
                        match integrations::proxy::sse_sanitizer::ensure_running(upstream).await {
                            Ok(local_url) => {
                                tracing::info!(
                                    "[CodeSession] SSE sanitizer active: {} → {}",
                                    local_url,
                                    upstream
                                );
                                env_vars.insert("ANTHROPIC_BASE_URL".to_string(), local_url);
                            }
                            Err(err) => {
                                tracing::warn!(
                                    "[CodeSession] SSE sanitizer failed: {} — using direct connection",
                                    err
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Spawn subprocess ──
    let is_acp_agent = matches!(
        agent,
        ModelType::Copilot | ModelType::Kiro | ModelType::OpenCode
    );

    const MAX_STDERR_LINES: usize = 20;
    let mut stderr_lines: Arc<Mutex<VecDeque<String>>>;
    let mut exit_code: i32;
    let mut oauth_retry_used = false;
    let mut suppressed_oauth_error: Option<String> = None;
    let mut overload_retry_count: u32 = 0;
    const MAX_OVERLOAD_RETRIES: u32 = 3;
    const OVERLOAD_RETRY_BASE_DELAY_SECS: u64 = 2;

    let base_sequence: i64 = persistence::max_chunk_sequence(&session_id).unwrap_or(-1) + 1;

    // Emit user_message chunk
    {
        let now = chrono::Utc::now();
        let now_str = now.to_rfc3339();
        let user_chunk = core_types::activity::ActivityChunk {
            chunk_id: format!("user-input-{}-{}", session_id, now.timestamp_millis()),
            session_id: session_id.clone(),
            action_type: "raw".to_string(),
            function: "user_message".to_string(),
            args: serde_json::json!({}),
            result: {
                let mut res = serde_json::json!({
                    "type": "user",
                    "message": { "content": display_input, "role": "user" }
                });
                if !image_paths.is_empty() {
                    res["images"] = serde_json::json!(image_paths);
                }
                res
            },
            created_at: now_str,
            thread_id: None,
            process_id: None,
            broadcast_only: false,
        };
        if let Err(err) = persistence::insert_chunk(&user_chunk, base_sequence) {
            tracing::error!(
                "[CodeSession] Failed to persist user_message chunk: {}",
                err
            );
        }
        let ws_msg = serde_json::json!({
            "type": "code_session.activity",
            "session_id": session_id,
            "chunk": user_chunk,
        });
        websocket_handler::broadcast(ws_msg.to_string());
    }

    // ═══════════════════════════════════════════════════════════
    // Agent-specific stdout processing
    // ═══════════════════════════════════════════════════════════
    let mut sequence: i64 = base_sequence + 1;
    #[allow(unused_assignments)]
    let mut timed_out = false;

    let mut cli_session_id_out: Option<String> = None;
    let mut cli_plan_approval_gate_reached = false;

    let session_timeout = tokio::time::Duration::from_secs(4 * 60 * 60);

    loop {
        let attempt_stderr_lines: Arc<Mutex<VecDeque<String>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(MAX_STDERR_LINES)));
        stderr_lines = Arc::clone(&attempt_stderr_lines);
        let mut spawn_cmd = Command::new(program);
        spawn_cmd
            .args(args)
            .envs(&env_vars)
            .current_dir(working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if matches!(agent, ModelType::GeminiCli) {
            if let Some(gemini_home) = env_vars.get("GEMINI_CLI_HOME") {
                spawn_cmd.env("HOME", gemini_home);
            }
            spawn_cmd
                .env("GEMINI_CLI_TRUST_WORKSPACE", "true")
                .env_remove("GEMINI_CLI_IDE_PID")
                .env_remove("GEMINI_CLI_IDE_SERVER_PORT")
                .env_remove("GEMINI_CLI_IDE_WORKSPACE_PATH");
        }
        if is_acp_agent {
            spawn_cmd.stdin(Stdio::piped());
        } else {
            spawn_cmd.stdin(Stdio::null());
        }
        #[cfg(unix)]
        {
            spawn_cmd.process_group(0);
        }

        let mut child = {
            let mut attempt = 0usize;
            loop {
                match spawn_cmd.spawn() {
                    Ok(child) => break child,
                    Err(err)
                        if attempt + 1 < SPAWN_RETRY_ATTEMPTS && is_transient_spawn_error(&err) =>
                    {
                        attempt += 1;
                        let delay_ms = SPAWN_RETRY_BASE_DELAY_MS * attempt as u64;
                        tracing::warn!(
                            "[CodeSession] Transient spawn failure for {} (attempt {}/{}): {}; retrying in {}ms",
                            program,
                            attempt,
                            SPAWN_RETRY_ATTEMPTS,
                            err,
                            delay_ms
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    }
                    Err(err) => {
                        if needs_mitm {
                            integrations::proxy::server::stop_session_proxy(&session_id).await;
                        }
                        return Err(format!("Failed to spawn {}: {}", program, err));
                    }
                }
            }
        };

        if let Some(pid) = child.id() {
            if let Err(err) = persistence::update_pid(&session_id, pid) {
                tracing::warn!("[CodeSession] Failed to store PID: {}", err);
            }
        }

        let stderr = child.stderr.take().expect("stderr was piped");
        let stderr_session_id = session_id.clone();
        let stderr_lines_writer = Arc::clone(&attempt_stderr_lines);
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::warn!("[CodeSession][stderr][{}] {}", stderr_session_id, line);
                let mut buf = stderr_lines_writer.lock().await;
                if buf.len() >= MAX_STDERR_LINES {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
        });

        let mut retryable_oauth_message: Option<String> = None;
        let mut retryable_overload_message: Option<String> = None;
        let mut replay_unsafe_output_seen = false;

        if is_acp_agent {
            // ── ACP agents (Copilot, Kiro): bidirectional JSON-RPC ──
            let stdout = child.stdout.take().expect("stdout was piped");
            let stdin = child.stdin.take().expect("stdin was piped for ACP");
            let (chunk_tx, mut chunk_rx) =
                tokio::sync::mpsc::channel::<core_types::activity::ActivityChunk>(256);

            let acp_sid = session_id.clone();
            let acp_task = effective_input.clone();
            let acp_dir = working_dir.to_string();
            let acp_resume = cli_resume_id.clone();
            let acp_agent = agent.clone();
            let acp_image_paths = image_paths.clone();

            let acp_handle = tokio::spawn(async move {
                match acp_agent {
                    ModelType::Kiro => {
                        kiro::run_acp_protocol(
                            stdin,
                            stdout,
                            &acp_sid,
                            &acp_task,
                            &acp_dir,
                            acp_resume.as_deref(),
                            chunk_tx,
                            acp_image_paths,
                        )
                        .await
                    }
                    ModelType::OpenCode => {
                        crate::agent_sessions::cli::parsers::opencode::run_acp_protocol(
                            stdin,
                            stdout,
                            &acp_sid,
                            &acp_task,
                            &acp_dir,
                            acp_resume.as_deref(),
                            chunk_tx,
                            acp_image_paths,
                        )
                        .await
                    }
                    _ => {
                        copilot::run_acp_protocol(
                            stdin,
                            stdout,
                            &acp_sid,
                            &acp_task,
                            &acp_dir,
                            acp_resume.as_deref(),
                            chunk_tx,
                            acp_image_paths,
                        )
                        .await
                    }
                }
            });

            let timeout_result = tokio::time::timeout(session_timeout, async {
                while let Some(chunk) = chunk_rx.recv().await {
                    if let Some(snap_id) = &pre_message_snapshot_id {
                        snapshot_cli_file_edit(&session_id, snap_id, &chunk, &snapshot_working_dir);
                    }
                    emit_chunk(&chunk, &session_id, &mut sequence);
                }
            })
            .await;
            timed_out = timeout_result.is_err();

            match acp_handle.await {
                Ok(Ok(result)) => {
                    cli_session_id_out = Some(result.acp_session_id);
                }
                Ok(Err(err)) if !timed_out => {
                    tracing::error!("[CodeSession] ACP protocol error: {}", err);
                }
                Err(join_err) => {
                    tracing::error!("[CodeSession] ACP task panicked: {}", join_err);
                }
                _ => {}
            }

            if let Some(pid) = child.id() {
                super::lifecycle::terminate_process_tree(pid as i64, &session_id).await;
            } else {
                let _ = child.kill().await;
            }
            let status = child
                .wait()
                .await
                .map_err(|err| format!("Wait error: {}", err))?;
            exit_code = status.code().unwrap_or(-1);

            // Clean stale lock files left by the killed kiro-cli process
            if matches!(agent, ModelType::Kiro) {
                if let Some(home) = env_vars.get("HOME") {
                    let lock_dir = std::path::Path::new(home).join(".kiro/sessions/cli");
                    if let Ok(entries) = std::fs::read_dir(&lock_dir) {
                        for entry in entries.flatten() {
                            if entry.path().extension().is_some_and(|e| e == "lock") {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        } else {
            // ── Standard agents: read stdout line by line through CliAgentParser ──
            let mut parser = create_parser(&agent, &session_id);
            let stdout = child.stdout.take().expect("stdout was piped");
            let mut reader = BufReader::new(stdout);
            let mut line_buf = Vec::with_capacity(4096);
            let mut last_plan_candidate_path: Option<PathBuf> = None;
            let mut cli_plan_active = mode == Some("plan");
            let mut cli_plan_registered_this_turn = false;
            let mut cli_plan_approval_gate_triggered = false;
            let mut cli_plan_drain_timed_out = false;
            let cli_plan_registration_allowed = user_requested_cli_plan(&user_input);

            let read_result = tokio::time::timeout(session_timeout, async {
                use tokio::io::AsyncBufReadExt;
                loop {
                    line_buf.clear();
                    let read_next_line = reader.read_until(b'\n', &mut line_buf);
                    let read_next_line = if cli_plan_approval_gate_triggered {
                        match tokio::time::timeout(
                            tokio::time::Duration::from_secs(CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS),
                            read_next_line,
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(_) => {
                                cli_plan_drain_timed_out = true;
                                tracing::warn!(
                                    "[CodeSession] CLI plan gate reached for {}; stdout did not close within {}s",
                                    session_id,
                                    CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS
                                );
                                break;
                            }
                        }
                    } else {
                        read_next_line.await
                    };
                    match read_next_line {
                        Ok(0) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&line_buf).trim_end().to_string();
                            if line.is_empty() {
                                continue;
                            }

                            let chunks = parser.parse_line(&line);
                            for chunk in chunks {
                                if cli_plan_approval_gate_triggered {
                                    continue;
                                }
                                if !replay_unsafe_output_seen {
                                    if let Some(message) = is_retryable_cli_oauth_failure_chunk(
                                        &agent,
                                        session.key_source,
                                        &chunk,
                                    ) {
                                        retryable_oauth_message = Some(message);
                                        break;
                                    }
                                }

                                if let Some(message) = is_retryable_overloaded_chunk(&chunk) {
                                    retryable_overload_message = Some(message);
                                    break;
                                }

                                if is_cli_chunk_replay_unsafe(&chunk) {
                                    replay_unsafe_output_seen = true;
                                }

                                if let Some(snap_id) = &pre_message_snapshot_id {
                                    snapshot_cli_file_edit(
                                        &session_id,
                                        snap_id,
                                        &chunk,
                                        &snapshot_working_dir,
                                    );
                                }
                                if is_successful_mode_tool(&chunk, "enter_plan_mode") {
                                    cli_plan_active = true;
                                }
                                if cli_plan_active
                                    && cli_plan_registration_allowed
                                    && !cli_plan_registered_this_turn
                                {
                                    let synthetic_plan_text = if is_assistant_text_chunk(&chunk) {
                                        chunk_text(&chunk)
                                            .filter(|text| looks_like_cli_plan_markdown(text))
                                    } else {
                                        create_plan_content_from_chunk(&chunk)
                                    };
                                    if let Some(plan_text) = synthetic_plan_text {
                                        match register_synthetic_cli_plan_approval(
                                            &session_id,
                                            &plan_text,
                                            &chunk.chunk_id,
                                            sequence,
                                        )
                                        .await
                                        {
                                            Ok(plan_chunk) => {
                                                emit_chunk(&plan_chunk, &session_id, &mut sequence);
                                                cli_plan_registered_this_turn = true;
                                                cli_plan_approval_gate_triggered = true;
                                            }
                                            Err(err) => {
                                                tracing::warn!(
                                                    "[CodeSession] Failed to register synthetic CLI plan approval for {}: {}",
                                                    session_id,
                                                    err
                                                );
                                            }
                                        }
                                    }
                                }
                                if let Some(candidate_path) =
                                    plan_candidate_path_from_chunk(&chunk, Path::new(&snapshot_working_dir))
                                {
                                    last_plan_candidate_path = Some(candidate_path);
                                    if cli_plan_active
                                        && cli_plan_registration_allowed
                                        && !cli_plan_registered_this_turn
                                    {
                                        match register_cli_plan_approval(
                                            &session_id,
                                            &chunk,
                                            last_plan_candidate_path.as_ref().unwrap(),
                                        )
                                        .await
                                        {
                                            Ok(plan_chunk) => {
                                                emit_chunk(&plan_chunk, &session_id, &mut sequence);
                                                cli_plan_registered_this_turn = true;
                                                cli_plan_approval_gate_triggered = true;
                                            }
                                            Err(err) => {
                                                tracing::warn!(
                                                    "[CodeSession] Failed to register CLI plan approval for {}: {}",
                                                    session_id,
                                                    err
                                                );
                                            }
                                        }
                                    }
                                }
                                if is_successful_mode_tool(&chunk, "exit_plan_mode") {
                                    if cli_plan_registration_allowed && !cli_plan_registered_this_turn {
                                        if let Some(plan_path) = last_plan_candidate_path.as_ref() {
                                            match register_cli_plan_approval(
                                                &session_id,
                                                &chunk,
                                                plan_path,
                                            )
                                            .await
                                            {
                                                Ok(plan_chunk) => {
                                                    emit_chunk(&plan_chunk, &session_id, &mut sequence);
                                                    cli_plan_registered_this_turn = true;
                                                    cli_plan_approval_gate_triggered = true;
                                                }
                                                Err(err) => {
                                                    tracing::warn!(
                                                        "[CodeSession] Failed to register CLI plan approval for {}: {}",
                                                        session_id,
                                                        err
                                                    );
                                                }
                                            }
                                        } else {
                                            tracing::warn!(
                                                "[CodeSession] exit_plan_mode succeeded without a plan file candidate for {}",
                                                session_id
                                            );
                                        }
                                    }
                                    cli_plan_active = false;
                                }
                                emit_chunk(&chunk, &session_id, &mut sequence);
                                if cli_plan_approval_gate_triggered {
                                    tracing::info!(
                                        "[CodeSession] CLI plan approval gate reached for {}; draining child output until natural exit",
                                        session_id
                                    );
                                }
                            }
                            if retryable_oauth_message.is_some()
                                || retryable_overload_message.is_some()
                            {
                                break;
                            }
                        }
                        Err(err) => {
                            tracing::error!("[CodeSession] stdout read error: {}", err);
                            break;
                        }
                    }
                    if retryable_oauth_message.is_some() || retryable_overload_message.is_some() {
                        break;
                    }
                }
            })
            .await;
            timed_out = read_result.is_err();
            cli_plan_approval_gate_reached = cli_plan_approval_gate_triggered;

            let kill_for_oauth_retry = retryable_oauth_message.is_some() && !timed_out;
            let kill_for_overload_retry = retryable_overload_message.is_some() && !timed_out;
            if kill_for_oauth_retry || kill_for_overload_retry {
                if let Some(pid) = child.id() {
                    super::lifecycle::terminate_process_tree(pid as i64, &session_id).await;
                } else if let Err(err) = child.start_kill() {
                    tracing::warn!(
                        "[CodeSession] Failed to start retry kill for {}: {}",
                        session_id,
                        err
                    );
                }
            }
            let pre_exit_status = if kill_for_oauth_retry || kill_for_overload_retry {
                tokio::time::timeout(tokio::time::Duration::from_secs(2), child.wait())
                    .await
                    .map_err(|_| {
                        std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "CLI child wait timed out after retry kill",
                        )
                    })
            } else if cli_plan_approval_gate_triggered && !timed_out {
                if cli_plan_drain_timed_out {
                    tracing::warn!(
                        "[CodeSession] CLI plan gate reached for {}; child did not exit naturally after stdout drain, killing",
                        session_id
                    );
                    if let Some(pid) = child.id() {
                        super::lifecycle::terminate_process_tree(pid as i64, &session_id).await;
                    } else if let Err(err) = child.start_kill() {
                        tracing::warn!(
                            "[CodeSession] Failed to start plan-gate kill for {}: {}",
                            session_id,
                            err
                        );
                    }
                    tokio::time::timeout(tokio::time::Duration::from_secs(2), child.wait())
                        .await
                        .map_err(|_| {
                            std::io::Error::new(
                                std::io::ErrorKind::TimedOut,
                                "CLI child wait timed out after plan-gate kill",
                            )
                        })
                } else {
                    Ok(child.wait().await)
                }
            } else {
                Ok(child.wait().await)
            };
            exit_code = pre_exit_status
                .as_ref()
                .ok()
                .and_then(|status_result| status_result.as_ref().ok())
                .and_then(|status| status.code())
                .unwrap_or(-1);

            if retryable_oauth_message.is_none()
                && is_cli_oauth_stderr_retry_candidate(
                    &agent,
                    session.key_source,
                    exit_code,
                    replay_unsafe_output_seen,
                )
            {
                let buf = attempt_stderr_lines.lock().await;
                retryable_oauth_message = buf
                    .iter()
                    .find(|line| is_cli_oauth_failure_message(line))
                    .cloned();
            }

            if retryable_oauth_message.is_none()
                && retryable_overload_message.is_none()
                && !cli_plan_approval_gate_triggered
            {
                let exit_chunks = parser.on_exit(exit_code);
                for chunk in &exit_chunks {
                    if !replay_unsafe_output_seen {
                        if let Some(message) =
                            is_retryable_cli_oauth_failure_chunk(&agent, session.key_source, chunk)
                        {
                            retryable_oauth_message = Some(message);
                            break;
                        }
                    }
                    if let Some(message) = is_retryable_overloaded_chunk(chunk) {
                        retryable_overload_message = Some(message);
                        break;
                    }
                    if let Some(snap_id) = &pre_message_snapshot_id {
                        snapshot_cli_file_edit(&session_id, snap_id, chunk, &snapshot_working_dir);
                    }
                    emit_chunk(chunk, &session_id, &mut sequence);
                }
            }

            if retryable_oauth_message.is_none() && retryable_overload_message.is_none() {
                cli_session_id_out = parser.cli_session_id();

                if let Some(ref usage) = parser.token_usage() {
                    let round_model = usage.model.as_deref().or(model);
                    if let Err(err) = session_persistence::token_usage::insert_token_usage_record(
                        &session_id,
                        "code",
                        round_model,
                        account_id,
                        usage.input_tokens as i64,
                        usage.output_tokens as i64,
                        usage.cache_read_tokens as i64,
                        usage.cache_write_tokens as i64,
                        usage.total_tokens as i64,
                        0,
                    ) {
                        tracing::warn!(
                            "[CodeSession] Failed to insert per-round token usage: {}",
                            err
                        );
                    }
                }
            }
        }

        if timed_out {
            tracing::error!(
                "[CodeSession] Session {} timed out after 4 hours",
                session_id
            );
            break;
        }

        if let Some(message) = retryable_oauth_message {
            if oauth_retry_used {
                suppressed_oauth_error = Some(message);
                break;
            }
            oauth_retry_used = true;
            suppressed_oauth_error = Some(message.clone());
            tracing::warn!(
                "[CodeSession] {} OAuth failed before replay-unsafe output; refreshing and retrying once",
                agent.as_str()
            );
            match refresh_cli_oauth_for_retry(&agent, account_id, &mut env_vars).await {
                Ok(true) => {
                    continue;
                }
                Ok(false) => {
                    suppressed_oauth_error = Some(
                        "This account needs to be signed in again before the agent can continue."
                            .to_string(),
                    );
                    break;
                }
                Err(err) => {
                    suppressed_oauth_error = Some(format!(
                        "Automatic account refresh failed. Please sign in again. {}",
                        err
                    ));
                    break;
                }
            }
        }

        if let Some(ref message) = retryable_overload_message {
            if overload_retry_count >= MAX_OVERLOAD_RETRIES {
                tracing::warn!(
                    "[CodeSession] {} API overloaded after {} retries; giving up: {}",
                    agent.as_str(),
                    MAX_OVERLOAD_RETRIES,
                    message,
                );
                break;
            }
            let delay_secs = OVERLOAD_RETRY_BASE_DELAY_SECS * (1u64 << overload_retry_count);
            overload_retry_count += 1;
            tracing::warn!(
                "[CodeSession] {} API overloaded (attempt {}/{}); retrying in {}s: {}",
                agent.as_str(),
                overload_retry_count,
                MAX_OVERLOAD_RETRIES,
                delay_secs,
                message,
            );
            tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
            continue;
        }

        break;
    }

    // ═══════════════════════════════════════════════════════════
    // Shared: timeout handling + wait + cleanup
    // ═══════════════════════════════════════════════════════════

    if agent == ModelType::Codex && session.key_source == KeySource::OwnKey {
        let launched_access_token = env_vars.get("OPENAI_API_KEY").map(String::as_str);
        if let Err(err) = sync_codex_cli_auth_to_key_vault(account_id, launched_access_token) {
            tracing::warn!(
                "[CodeSession] Failed to sync Codex CLI auth tokens: {}",
                err
            );
        }
        if exit_code == 0 {
            if let Some(account_id) = account_id {
                if let Err(err) = KEY_SERVICE.reset_oauth_refresh_failures(account_id) {
                    tracing::warn!(
                        "[CodeSession] Failed to reset Codex OAuth refresh failures: {}",
                        err
                    );
                }
            }
        }
    }

    if agent == ModelType::GeminiCli && session.key_source == KeySource::OwnKey {
        let launched_access_token = env_vars.get("GEMINI_ACCESS_TOKEN").map(String::as_str);
        if let Err(err) = sync_gemini_cli_auth_to_key_vault(account_id, launched_access_token) {
            tracing::warn!(
                "[CodeSession] Failed to sync Gemini CLI auth tokens: {}",
                err
            );
        }
        if exit_code == 0 {
            if let Some(account_id) = account_id {
                if let Err(err) = KEY_SERVICE.reset_oauth_refresh_failures(account_id) {
                    tracing::warn!(
                        "[CodeSession] Failed to reset Gemini OAuth refresh failures: {}",
                        err
                    );
                }
            }
        }
    }

    if let Some(ref cli_sid) = cli_session_id_out {
        persistence::update_cli_session_id_for_account(&session_id, account_id, cli_sid).ok();
    }

    let raw_final_status = if cli_plan_approval_gate_reached {
        SessionStatus::Completed
    } else if is_acp_agent {
        if cli_session_id_out.is_some() {
            SessionStatus::Completed
        } else {
            SessionStatus::Failed
        }
    } else if exit_code == 0 {
        SessionStatus::Completed
    } else {
        SessionStatus::Failed
    };

    // CLI member sessions inside an Agent Org run must land on `Idle` after each
    // successful turn so they remain available for the next coordinator dispatch.
    // `Completed` is terminal (is_terminal() == true) and would cause
    // `reconcile_if_terminal` to prematurely end the run.
    let is_org_member = session.org_member_id.is_some();
    let final_status = if raw_final_status == SessionStatus::Completed && is_org_member {
        SessionStatus::Idle
    } else {
        raw_final_status
    };

    let error_message: Option<String> = if final_status == SessionStatus::Failed {
        if let Some(message) = suppressed_oauth_error.clone() {
            Some(message)
        } else {
            let buf = stderr_lines.lock().await;
            let meaningful: Vec<&str> = buf
                .iter()
                .map(|s| s.as_str())
                .filter(|line| {
                    let lower = line.to_lowercase();
                    lower.contains("error")
                        || lower.contains("fatal")
                        || lower.contains("panic")
                        || lower.contains("fail")
                        || lower.contains("exception")
                        || lower.contains("timed out")
                        || lower.contains("timeout")
                        || lower.contains("refused")
                        || lower.contains("denied")
                        || lower.contains("not found")
                        || lower.contains("refresh token")
                        || lower.contains("access token")
                        || lower.contains("oauth")
                        || lower.contains("unauthorized")
                        || lower.contains("not authenticated")
                        || lower.contains("authentication")
                        || lower.contains("login required")
                        || lower.contains("please log in")
                        || lower.contains("please login")
                        || lower.contains("revoked")
                        || lower.contains("invalid_grant")
                })
                .collect();
            if meaningful.is_empty() {
                buf.back().map(|s| s.to_string())
            } else {
                Some(meaningful.join("\n"))
            }
        }
    } else {
        None
    };

    if agent == ModelType::Codex
        && session.key_source == KeySource::OwnKey
        && error_message
            .as_deref()
            .is_some_and(is_cli_oauth_failure_message)
    {
        if let Some(account_id) = account_id {
            if let Some(ref err_msg) = error_message {
                if let Err(err) = KEY_SERVICE.record_oauth_refresh_failure(account_id, err_msg) {
                    tracing::warn!(
                        "[CodeSession] Failed to record Codex OAuth refresh failure: {}",
                        err
                    );
                }
            }
        }
    }

    if let Some(ref err_msg) = error_message {
        if let Err(err) = persistence::update_status_with_error(&session_id, final_status, err_msg)
        {
            tracing::error!(
                "[CodeSession] Failed to update final status with error: {}",
                err
            );
        }
    } else if let Err(err) = persistence::update_status(&session_id, final_status) {
        tracing::error!("[CodeSession] Failed to update final status: {}", err);
    }

    // For CLI sessions that are Agent Org members, requeue any in-progress work
    // and notify the coordinator that this member is idle/available. This mirrors
    // the Rust-native member path in `agent_core::lifecycle::finalize_session`.
    // app_handle is unavailable in the CLI runner, so inbox-wake via AppHandle is
    // skipped (fire-and-forget; the coordinator will drain on its next turn boundary).
    if is_org_member {
        let outcome: Result<String, String> = if error_message.is_none() {
            Ok(String::new())
        } else {
            Err(error_message
                .as_deref()
                .unwrap_or("unknown error")
                .to_string())
        };
        agent_core::lifecycle::finalize_agent_org_member_turn(None, &session_id, &outcome);
    }

    // Flush any pending streaming deltas before signaling session end
    flush_and_broadcast(&session_id);

    let mut status_msg = serde_json::json!({
        "type": "code_session.status_changed",
        "session_id": session_id,
        "status": final_status.as_ref(),
        "exit_code": exit_code,
        "background": session.background,
        "session_name": session.name,
    });
    if let Some(ref err_msg) = error_message {
        status_msg["error_message"] = serde_json::Value::String(err_msg.clone());
    }
    websocket_handler::broadcast(status_msg.to_string());

    // ── Worktree: commit changes on completion ──
    if raw_final_status == SessionStatus::Completed {
        if let Some(ref wt_repo_path) = session.repo_path {
            if session.worktree_path.is_some() {
                let repo = std::path::PathBuf::from(wt_repo_path);
                let wt_sid = session_id.clone();
                let _ =
                    tokio::task::spawn_blocking(
                        move || match git::worktree::commit_worktree_changes(&repo, &wt_sid) {
                            Ok(true) => {
                                tracing::info!(
                                    "[CodeSession] Committed worktree changes for session {}",
                                    wt_sid
                                );
                            }
                            Ok(false) => {
                                tracing::info!(
                                "[CodeSession] No uncommitted changes in worktree for session {}",
                                wt_sid
                            );
                            }
                            Err(err) => {
                                tracing::warn!(
                                    "[CodeSession] Failed to commit worktree changes: {}",
                                    err
                                );
                            }
                        },
                    )
                    .await;
            }
        }
    }

    // ── Cursor: fetch token usage from Dashboard API ──
    if agent == ModelType::CursorCli && raw_final_status == SessionStatus::Completed {
        let sid = session_id.clone();
        let acc_id = session.account_id.clone();

        tokio::spawn(async move {
            fetch_cursor_usage_for_session(&sid, acc_id.as_deref(), run_started_at).await;
        });
    }

    if needs_mitm {
        integrations::proxy::server::stop_session_proxy(&session_id).await;
        tracing::info!(
            "[CodeSession] Stopped per-session MITM proxy for session {}",
            session_id
        );
    }

    release_proxy_token_for_session(&session_id).await;

    super::super::skill_sync::cleanup_synced_skill_files(&synced_rule_files);

    Ok(())
}

/// Resolve the built-in SDE agent definition and return just its skills
/// config — the CLI runner's only consumer of `ResolvedAgent` (see §11.4
/// row 17). Failures fall back to the default skills shape (enabled,
/// nothing excluded) because the CLI session is already running; we do
/// not want a missing definitions file to break rule-sync.
fn resolve_sde_skills() -> agent_core::core::definitions::SkillsParams {
    use agent_core::core::definitions::{AgentDefinitionsStore, ResolvedAgent, SkillsParams};
    use agent_core::core::session::overrides::SessionOverrides;
    let definitions = AgentDefinitionsStore::new();
    let Some(def) = definitions.get(agent_core::definitions::builtin::SDE_AGENT_ID) else {
        tracing::warn!(
            "[code_session] builtin:sde definition not found; using default skills config"
        );
        return SkillsParams::default();
    };
    match ResolvedAgent::resolve(&def, Some(&definitions), &SessionOverrides::default()) {
        Ok(resolved) => resolved.skills.clone(),
        Err(err) => {
            tracing::warn!(
                "[code_session] resolve builtin:sde failed ({}); using default skills config",
                err
            );
            SkillsParams::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::Mutex as StdMutex;

    static ORGII_HOME_TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn with_temp_orgii_home<R>(run: impl FnOnce(&Path) -> R) -> R {
        let _guard = ORGII_HOME_TEST_LOCK
            .lock()
            .expect("lock ORGII_HOME test guard");
        let previous = std::env::var("ORGII_HOME").ok();
        let temp_dir = tempfile::tempdir().expect("create temp ORGII_HOME");
        std::env::set_var("ORGII_HOME", temp_dir.path());
        let result = run(temp_dir.path());
        match previous {
            Some(value) => std::env::set_var("ORGII_HOME", value),
            None => std::env::remove_var("ORGII_HOME"),
        }
        result
    }

    fn read_json(path: &Path) -> Value {
        let text = std::fs::read_to_string(path).expect("read json file");
        serde_json::from_str(&text).expect("parse json file")
    }

    #[test]
    fn cli_plan_mode_bridge_preserves_side_chat_semantics() {
        let bridge = cli_exec_mode_bridge(Some("plan")).expect("plan bridge");
        assert!(bridge.contains("draft, create, update, revise, or submit an approval plan"));
        assert!(bridge.contains("answer the question directly"));
        assert!(bridge.contains("do not create, revise, or submit a plan"));
        assert!(bridge.contains("canonicalize that markdown into the approval card"));
    }

    #[test]
    fn cli_plan_text_fallback_requires_user_plan_intent() {
        assert!(user_requested_cli_plan(
            "Draft a short implementation plan with a Build button."
        ));
        assert!(user_requested_cli_plan(
            "Revise the existing pending approval plan to create latest.md."
        ));
        assert!(!user_requested_cli_plan(
            "Answer this ordinary side question: what is the exact marker? Do not create, revise, or submit an approval plan."
        ));
        assert!(!user_requested_cli_plan(
            "Before building, reply with the exact marker. Do not modify the pending plan."
        ));
    }

    #[test]
    fn cli_plan_markdown_detection_accepts_buildable_plan_text_only() {
        assert!(looks_like_cli_plan_markdown(
            "### Build Approval Plan\n\nChange: Create `artifact.md`.\n\nScope: one low-risk filesystem change.\n\nVerification: confirm the file exists and content matches."
        ));
        assert!(looks_like_cli_plan_markdown(
            "# Create Acceptance Artifact\n\n1. Create `artifact.md` with exactly `ORGII_MARKER`.\n2. Make no other filesystem changes.\n3. Verify the new file contains the required content exactly."
        ));
        assert!(!looks_like_cli_plan_markdown("I will submit a plan soon."));
        assert!(!looks_like_cli_plan_markdown(
            "Here is a general explanation without any build or verification details."
        ));
    }

    #[test]
    fn create_plan_shape_extracts_cursor_cli_plan_args() {
        let mut chunk = ActivityChunk::new("session-1", "tool_call", "orgii acceptance artifact");
        chunk.args = serde_json::json!({
            "name": "ORGII acceptance artifact",
            "plan": "Build step: create `artifact.md` with the required content. Verification: confirm the file exists and no other changes were made."
        });
        chunk.result = serde_json::json!({ "success": {} });

        let content = create_plan_content_from_chunk(&chunk).expect("plan content");
        assert!(content.starts_with("# ORGII acceptance artifact"));
        assert!(content.contains("artifact.md"));
    }

    #[test]
    fn successful_write_chunk_plan_content_uses_new_body() {
        let mut chunk = ActivityChunk::new("session-1", "tool_call", "edit_file_by_replace");
        chunk.args = serde_json::json!({
            "path": "/tmp/plan.md",
            "new_string": "# New Plan\n\nCreate `new.md` and verify the file contains exactly `NEW_MARKER`."
        });
        chunk.result = serde_json::json!({ "success": { "path": "/tmp/plan.md" } });

        let content = plan_content_from_successful_write_chunk(&chunk).expect("plan content");
        assert!(content.contains("new.md"));
        assert!(!content.contains("old.md"));
    }

    #[test]
    fn enter_plan_mode_result_is_not_treated_as_assistant_plan() {
        let mut chunk = ActivityChunk::new("session-1", "tool_call", "enter_plan_mode");
        chunk.result = serde_json::json!({
            "content": "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach."
        });
        assert!(!is_assistant_text_chunk(&chunk));
        assert!(create_plan_content_from_chunk(&chunk).is_none());
    }

    #[test]
    fn synthetic_cli_plan_path_is_session_scoped() {
        with_temp_orgii_home(|root| {
            let path = synthetic_cli_plan_path("cli/session:1", 42);
            assert!(path.starts_with(root));
            assert!(path.to_string_lossy().contains("cli-session-1"));
            assert!(path.ends_with("synthetic-plan-42.md"));
        });
    }

    #[test]
    fn child_env_sanitization_keeps_runtime_tokens_out_of_subprocess_env() {
        let mut codex_env = HashMap::new();
        codex_env.insert("OPENAI_API_KEY".to_string(), "access-token".to_string());
        codex_env.insert(
            CODEX_REFRESH_TOKEN_ENV_KEY.to_string(),
            "refresh-token".to_string(),
        );
        codex_env.insert(CODEX_ID_TOKEN_ENV_KEY.to_string(), "id-token".to_string());
        sanitize_cli_oauth_env_for_child(&ModelType::Codex, &mut codex_env);
        assert_eq!(
            codex_env.get("OPENAI_API_KEY").map(String::as_str),
            Some("access-token")
        );
        assert!(!codex_env.contains_key(CODEX_REFRESH_TOKEN_ENV_KEY));
        assert!(!codex_env.contains_key(CODEX_ID_TOKEN_ENV_KEY));

        let mut gemini_env = HashMap::new();
        gemini_env.insert(
            "GEMINI_ACCESS_TOKEN".to_string(),
            "access-token".to_string(),
        );
        gemini_env.insert(
            "GEMINI_REFRESH_TOKEN".to_string(),
            "refresh-token".to_string(),
        );
        gemini_env.insert(
            "GEMINI_EXPIRES_AT".to_string(),
            "2030-01-01T00:00:00Z".to_string(),
        );
        sanitize_cli_oauth_env_for_child(&ModelType::GeminiCli, &mut gemini_env);
        assert_eq!(
            gemini_env.get("GEMINI_ACCESS_TOKEN").map(String::as_str),
            Some("access-token")
        );
        assert!(!gemini_env.contains_key("GEMINI_REFRESH_TOKEN"));
        assert_eq!(
            gemini_env.get("GEMINI_EXPIRES_AT").map(String::as_str),
            Some("2030-01-01T00:00:00Z")
        );
    }

    #[test]
    fn gemini_own_key_oauth_home_writes_oauth_files() {
        with_temp_orgii_home(|root| {
            let mut env_vars = HashMap::new();
            env_vars.insert(
                "GEMINI_ACCESS_TOKEN".to_string(),
                "access-token".to_string(),
            );
            env_vars.insert(
                "GEMINI_REFRESH_TOKEN".to_string(),
                "refresh-token".to_string(),
            );
            env_vars.insert(
                "GEMINI_EXPIRES_AT".to_string(),
                "2026-05-18T00:00:00Z".to_string(),
            );
            env_vars.insert("GEMINI_TOKEN_TYPE".to_string(), "Bearer".to_string());

            let home = setup_gemini_cli_home(
                KeySource::OwnKey,
                "session-1",
                Some("gemini-account"),
                &env_vars,
            )
            .expect("setup Gemini OAuth home");

            assert!(home.starts_with(root));
            let gemini_dir = home.join(".gemini");
            let oauth = read_json(&gemini_dir.join("oauth_creds.json"));
            let settings = read_json(&gemini_dir.join("settings.json"));
            assert_eq!(oauth["access_token"], "access-token");
            assert_eq!(oauth["refresh_token"], "refresh-token");
            assert_eq!(oauth["expiry"], "2026-05-18T00:00:00Z");
            assert_eq!(
                settings["security"]["auth"]["selectedType"],
                "oauth-personal"
            );
            assert_eq!(settings["ide"]["enabled"], false);
        });
    }

    #[test]
    fn gemini_own_key_api_key_home_writes_api_key_settings_only() {
        with_temp_orgii_home(|root| {
            let mut env_vars = HashMap::new();
            env_vars.insert("GEMINI_API_KEY".to_string(), "api-key".to_string());

            let home = setup_gemini_cli_home(
                KeySource::OwnKey,
                "session-2",
                Some("gemini-api-account"),
                &env_vars,
            )
            .expect("setup Gemini API-key home");

            assert!(home.starts_with(root));
            let gemini_dir = home.join(".gemini");
            let settings = read_json(&gemini_dir.join("settings.json"));
            assert_eq!(
                settings["security"]["auth"]["selectedType"],
                "gemini-api-key"
            );
            assert_eq!(settings["ide"]["enabled"], false);
            assert!(!gemini_dir.join("oauth_creds.json").exists());
        });
    }

    #[test]
    fn gemini_own_key_home_requires_account_id() {
        with_temp_orgii_home(|_root| {
            let env_vars = HashMap::new();
            let err = setup_gemini_cli_home(KeySource::OwnKey, "session-3", None, &env_vars)
                .expect_err("missing account id must fail");
            assert!(err.contains("requires account_id"));
        });
    }

    #[test]
    fn gemini_stderr_oauth_failure_is_retryable_before_replay_unsafe_output() {
        assert!(is_cli_oauth_stderr_retry_candidate(
            &ModelType::GeminiCli,
            KeySource::OwnKey,
            1,
            false,
        ));
        assert!(is_cli_oauth_failure_message(
            "Gemini OAuth access token expired and failed to refresh"
        ));
        assert!(!is_cli_oauth_stderr_retry_candidate(
            &ModelType::GeminiCli,
            KeySource::OwnKey,
            1,
            true,
        ));
        assert!(!is_cli_oauth_stderr_retry_candidate(
            &ModelType::GeminiCli,
            KeySource::HostedKey,
            1,
            false,
        ));
    }

    #[test]
    fn overloaded_error_detection() {
        assert!(is_api_overloaded_message("overloaded_error"));
        assert!(is_api_overloaded_message(
            "Anthropic API error: overloaded_error - API overloaded"
        ));
        assert!(is_api_overloaded_message("Error 529: API overloaded"));
        assert!(is_api_overloaded_message("429 Too Many Requests"));
        assert!(is_api_overloaded_message("Rate limit exceeded"));
        assert!(is_api_overloaded_message("too many requests"));
        assert!(!is_api_overloaded_message("Connection refused"));
        assert!(!is_api_overloaded_message("unauthorized access"));
        assert!(!is_api_overloaded_message(
            "Gemini OAuth access token expired"
        ));
    }

    #[test]
    fn overloaded_chunk_detection() {
        let make_chunk = |result: serde_json::Value| core_types::activity::ActivityChunk {
            chunk_id: "test".to_string(),
            session_id: "s".to_string(),
            action_type: "error".to_string(),
            function: "error".to_string(),
            args: serde_json::json!({}),
            result,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            thread_id: None,
            process_id: None,
            broadcast_only: false,
        };

        let overloaded = make_chunk(serde_json::json!({
            "error_message": "overloaded_error: The API is currently overloaded"
        }));
        assert!(is_retryable_overloaded_chunk(&overloaded).is_some());

        let rate_limited = make_chunk(serde_json::json!({
            "error": "429 Too Many Requests"
        }));
        assert!(is_retryable_overloaded_chunk(&rate_limited).is_some());

        let auth_error = make_chunk(serde_json::json!({
            "error_message": "401 Unauthorized: invalid api key"
        }));
        assert!(is_retryable_overloaded_chunk(&auth_error).is_none());

        let no_error = make_chunk(serde_json::json!({
            "text": "Hello world"
        }));
        assert!(is_retryable_overloaded_chunk(&no_error).is_none());
    }
}
