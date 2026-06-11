//! Plan detection and approval card registration for CLI sessions.

use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;

const CLI_SYNTHETIC_PLAN_MIN_CHARS: usize = 80;

pub(super) fn plan_candidate_path_from_chunk(
    chunk: &ActivityChunk,
    working_dir: &Path,
) -> Option<PathBuf> {
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

pub(super) fn is_successful_mode_tool(chunk: &ActivityChunk, tool_name: &str) -> bool {
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

pub(super) fn looks_like_buildable_plan_body(text: &str) -> bool {
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

pub(super) fn create_plan_content_from_chunk(chunk: &ActivityChunk) -> Option<String> {
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

pub(super) fn synthetic_cli_plan_path(session_id: &str, sequence: i64) -> PathBuf {
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

pub(super) async fn register_synthetic_cli_plan_approval(
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

pub(super) fn plan_content_from_successful_write_chunk(chunk: &ActivityChunk) -> Option<String> {
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

pub(super) async fn register_cli_plan_approval(
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
