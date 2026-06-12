//! CLI command building and parser creation for each CLI agent type (ModelType).

use crate::agent_sessions::cli::parsers::claude_code::ClaudeCodeParser;
use crate::agent_sessions::cli::parsers::codex::CodexParser;
use crate::agent_sessions::cli::parsers::cursor::CursorParser;
use crate::agent_sessions::cli::parsers::gemini::GeminiParser;
use crate::agent_sessions::cli::parsers::CliAgentParser;
use key_vault::key_store::ModelType;

/// Resolve the full path to the `cursor-agent` binary.
///
/// Prefers `~/.local/bin/cursor-agent` (installed by `cursor-agent update` or
/// `curl -sS https://cursor.com/install | bash`). Falls back to the bare
/// command name if the home directory cannot be resolved (which would be
/// extraordinary on macOS/Linux).
pub(super) fn resolve_cursor_agent_path() -> String {
    if let Some(home) = dirs::home_dir() {
        let path = home.join(".local/bin/cursor-agent");
        if path.is_file() {
            return path.to_string_lossy().to_string();
        }
    }
    "cursor-agent".to_string()
}

/// Build the CLI command for a given CLI agent type.
///
/// Matches the market worker's `_build_agent_command()`.
/// When `resume_id` is provided, adds the appropriate resume flag for the CLI.
/// `api_key` is passed for agents that accept an explicit key argument (e.g. Cursor `--api-key`).
/// `endpoint` overrides the CLI's API endpoint URL (e.g. Cursor `--endpoint`).
/// `additional_dirs` extends the CLI's working set; only `claude_code`
/// and `codex` accept the flag today — other CLI agents log a warning
/// and the extra dirs are not passed through.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_command(
    agent: &ModelType,
    model: Option<&str>,
    task: &str,
    resume_id: Option<&str>,
    api_key: Option<&str>,
    endpoint: Option<&str>,
    mode: Option<&str>,
    repo_path: Option<&str>,
    additional_dirs: &[String],
) -> Vec<String> {
    // Only claude_code and codex accept `--add-dir`. For every other CLI
    // agent, extra workspace roots cannot be expressed on the command
    // line — warn loudly instead of silently dropping the grant.
    if !additional_dirs.is_empty() && !matches!(agent, ModelType::ClaudeCode | ModelType::Codex) {
        tracing::warn!(
            agent = ?agent,
            dirs = ?additional_dirs,
            "[cli-runner] CLI agent does not support --add-dir; additional directories will NOT be visible to it",
        );
    }
    match agent {
        ModelType::CursorCli => {
            let cursor_agent_bin = resolve_cursor_agent_path();
            let mut cmd = vec![cursor_agent_bin, "agent".into()];
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            cmd.push("--stream-partial-output".into());
            cmd.push("--force".into());
            cmd.push("--approve-mcps".into());
            if let Some(key) = api_key {
                cmd.push("--api-key".into());
                cmd.push(key.into());
            }
            if let Some(ep) = endpoint {
                cmd.push("--endpoint".into());
                cmd.push(ep.into());
                cmd.push("--agent-endpoint".into());
                cmd.push(ep.into());
            }
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(m.into());
            }
            if let Some(md) = mode {
                match md {
                    "plan" | "ask" => {
                        cmd.push("--mode".into());
                        cmd.push(md.into());
                    }
                    _ => {}
                }
            }
            if let Some(ws) = repo_path {
                cmd.push("--workspace".into());
                cmd.push(ws.into());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::ClaudeCode => {
            let mut cmd = vec!["claude".into()];
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            cmd.push("--verbose".into());
            cmd.push("--dangerously-skip-permissions".into());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(map_claude_model(m));
            }
            // Multi-root: claude accepts space-separated paths after a single
            // `--add-dir`; one flag per directory also works. Use one flag per
            // dir to keep tokenisation unambiguous when paths contain spaces.
            for dir in additional_dirs {
                if dir.is_empty() {
                    continue;
                }
                cmd.push("--add-dir".into());
                cmd.push(dir.clone());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::Codex => {
            let mut cmd = vec!["codex".into(), "exec".into()];
            cmd.push("--json".into());
            cmd.push("--skip-git-repo-check".into());
            cmd.push("--sandbox".into());
            cmd.push("workspace-write".into());
            if let Some(ws) = repo_path {
                cmd.push("--cd".into());
                cmd.push(ws.into());
            }
            if let Some(m) = model {
                cmd.push("-m".into());
                cmd.push(m.into());
            }
            if let Some(rid) = resume_id {
                cmd.push("resume".into());
                cmd.push(rid.into());
            }
            // Codex requires one `--add-dir <path>` per extra root.
            for dir in additional_dirs {
                if dir.is_empty() {
                    continue;
                }
                cmd.push("--add-dir".into());
                cmd.push(dir.clone());
            }
            cmd.push(task.into());
            cmd
        }
        ModelType::GeminiCli => {
            let mut cmd = vec!["gemini".into()];
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            cmd.push("--yolo".into());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(m.into());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::Kiro => {
            let cmd = vec!["kiro-cli".into(), "acp".into()];
            cmd
        }
        ModelType::Copilot => {
            let mut cmd = vec!["copilot".into(), "--acp".into(), "--stdio".into()];
            cmd.push("--allow-all-tools".to_string());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(map_claude_model(m));
            }
            cmd
        }
        ModelType::OpenCode => {
            let cmd = vec!["opencode".into(), "acp".into()];
            cmd
        }
        other => {
            panic!(
                "ModelType::{:?} is not a CLI agent — cannot build command",
                other
            );
        }
    }
}

/// Map market shorthand model names to full CLI model names.
///
/// Fallback mapping for when the proxy's resolved `model_name` is unavailable
/// (e.g., fallback allocation path, pool sync failure, or local billing mode).
/// The hosted service normalizes "claude-sonnet-4.5" → "sonnet-4.5", but CLIs
/// (Claude Code, Copilot) expect full names like "claude-sonnet-4.5".
/// This re-adds the "claude-" prefix for Claude-family models.
/// Non-Claude models (gpt-*, gemini-*, grok-*, raptor-*) pass through unchanged.
///
/// Also strips trailing YYYYMMDD date suffixes (e.g. `claude-haiku-4-5-20251001`
/// → `claude-haiku-4-5`). The API layer accepts these suffixes, but Claude Code
/// CLI rejects them.
pub(super) fn map_claude_model(model: &str) -> String {
    let model = strip_cli_date_suffix(model);
    agent_core::providers::model_hints::normalize_claude_shorthand(model)
}

/// Strip a trailing 8-digit date suffix (YYYYMMDD) from a model ID.
/// E.g. `claude-haiku-4-5-20251001` → `claude-haiku-4-5`.
/// Non-matching strings are returned unchanged.
fn strip_cli_date_suffix(model: &str) -> &str {
    if let Some(pos) = model.rfind('-') {
        let suffix = &model[pos + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            return &model[..pos];
        }
    }
    model
}

/// Create the appropriate parser for a CLI agent type.
///
/// Copilot uses ACP (bidirectional JSON-RPC) instead of CliAgentParser.
/// API key providers are not CLI agents and should never reach this function.
pub(super) fn create_parser(agent: &ModelType, session_id: &str) -> Box<dyn CliAgentParser> {
    match agent {
        ModelType::CursorCli => Box::new(CursorParser::new(session_id)),
        ModelType::ClaudeCode => Box::new(ClaudeCodeParser::new(session_id)),
        ModelType::Codex => Box::new(CodexParser::new(session_id)),
        ModelType::GeminiCli => Box::new(GeminiParser::new(session_id)),
        other => panic!(
            "ModelType::{:?} does not use CliAgentParser (Copilot/Kiro use ACP; API providers are not CLI agents)",
            other
        ),
    }
}
