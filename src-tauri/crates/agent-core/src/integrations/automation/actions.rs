//! Automation action executor implementations.
//!
//! Each action type knows how to execute itself given the bus sender
//! and other infrastructure references.

use serde_json::{Map, Value};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use super::types::{AutomationAction, WorkflowActionInstance};
use crate::bus::InboundMessage;

/// Execute an automation action.
///
/// Supports direct automation actions and the visual workflow action chain used by routines.
pub async fn execute_action(action: &AutomationAction, inbound_tx: &mpsc::Sender<InboundMessage>) {
    match action {
        AutomationAction::InjectPrompt { prompt, session_id } => {
            execute_inject_prompt(prompt, session_id.as_deref(), inbound_tx).await;
        }

        AutomationAction::StartSession {
            agent_type,
            prompt,
            model,
            repo_path,
        } => {
            execute_start_session(
                agent_type,
                prompt,
                model.as_deref(),
                repo_path.as_deref(),
                inbound_tx,
            )
            .await;
        }

        AutomationAction::KillSession { session_id } => {
            execute_kill_session(session_id, inbound_tx).await;
        }

        AutomationAction::SendMessage { channel, content } => {
            execute_send_message(channel, content, inbound_tx).await;
        }

        AutomationAction::InjectToSession {
            session_id,
            message,
        } => {
            execute_inject_to_session(session_id, message, inbound_tx).await;
        }

        AutomationAction::Workflow { actions } => {
            info!(
                "[automation] Executing Workflow action chain ({} actions)",
                actions.len()
            );
            for action_instance in actions {
                execute_workflow_action(action_instance, inbound_tx).await;
            }
        }
    }
}

async fn execute_workflow_action(
    action: &WorkflowActionInstance,
    inbound_tx: &mpsc::Sender<InboundMessage>,
) {
    match action.definition_id.as_str() {
        "inject-prompt" => {
            let Some(prompt) = string_field(&action.data, "0") else {
                warn!(
                    "[automation] Skipping workflow inject-prompt action '{}' with empty prompt",
                    action.id
                );
                return;
            };
            let session_id = string_field(&action.data, "1");
            execute_inject_prompt(&prompt, session_id.as_deref(), inbound_tx).await;
        }
        "start-session" => {
            // A start-session action with no prompt would launch an
            // empty-prompt session, which the agent cannot act on —
            // skip with a warn so the misconfigured rule is visible
            // and behave like the other action arms below.
            let Some(prompt) = string_field(&action.data, "prompt") else {
                warn!(
                    "[automation] Skipping workflow start-session action '{}' with empty prompt",
                    action.id
                );
                return;
            };
            let agent_type = string_field(&action.data, "agentType")
                .or_else(|| string_field(&action.data, "agent_type"))
                .unwrap_or_else(|| "default".to_string());
            let model = string_field(&action.data, "model");
            let repo_path = string_field(&action.data, "repoPath")
                .or_else(|| string_field(&action.data, "repo_path"));
            execute_start_session(
                &agent_type,
                &prompt,
                model.as_deref(),
                repo_path.as_deref(),
                inbound_tx,
            )
            .await;
        }
        "kill-session" => {
            let Some(session_id) = string_field(&action.data, "0") else {
                warn!(
                    "[automation] Skipping workflow kill-session action '{}' with no session",
                    action.id
                );
                return;
            };
            execute_kill_session(&session_id, inbound_tx).await;
        }
        "send-message" => {
            let Some(channel) = string_field(&action.data, "0") else {
                warn!(
                    "[automation] Skipping workflow send-message action '{}' with no channel",
                    action.id
                );
                return;
            };
            let Some(content) = string_field(&action.data, "1") else {
                warn!(
                    "[automation] Skipping workflow send-message action '{}' with empty content",
                    action.id
                );
                return;
            };
            execute_send_message(&channel, &content, inbound_tx).await;
        }
        "inject-to-session" => {
            let Some(session_id) = string_field(&action.data, "0") else {
                warn!(
                    "[automation] Skipping workflow inject-to-session action '{}' with no session",
                    action.id
                );
                return;
            };
            let Some(message) = string_field(&action.data, "1") else {
                warn!(
                    "[automation] Skipping workflow inject-to-session action '{}' with empty message",
                    action.id
                );
                return;
            };
            execute_inject_to_session(&session_id, &message, inbound_tx).await;
        }
        unsupported => {
            warn!(
                "[automation] Workflow action '{}' uses unsupported definition '{}'; skipping",
                action.id, unsupported
            );
        }
    }
}

fn string_field(data: &Map<String, Value>, key: &str) -> Option<String> {
    data.get(key).and_then(value_to_non_empty_string)
}

fn value_to_non_empty_string(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn execute_inject_prompt(
    prompt: &str,
    session_id: Option<&str>,
    inbound_tx: &mpsc::Sender<InboundMessage>,
) {
    info!(
        "[automation] Executing InjectPrompt (session: {:?})",
        session_id
    );

    let mut msg = InboundMessage::new("automation", "system", "automation", prompt);
    if let Some(sid) = session_id {
        msg.session_key_override = Some(sid.to_string());
    }

    if let Err(err) = inbound_tx.send(msg).await {
        error!("[automation] Failed to inject prompt: {}", err);
    }
}

async fn execute_start_session(
    agent_type: &str,
    prompt: &str,
    model: Option<&str>,
    repo_path: Option<&str>,
    inbound_tx: &mpsc::Sender<InboundMessage>,
) {
    info!(
        "[automation] Executing StartSession (type: {}, model: {:?}, repo: {:?})",
        agent_type, model, repo_path
    );

    if prompt.trim().is_empty() {
        warn!(
            "[automation] StartSession received empty prompt (agent_type='{}'); skipping",
            agent_type
        );
        return;
    }

    let session_prompt = format!(
        "[Automation:StartSession] agent_type={} model={} repo={}\n\n{}",
        agent_type,
        model.unwrap_or("default"),
        repo_path.unwrap_or("none"),
        prompt
    );

    let msg = InboundMessage::new("automation", "system", "automation", &session_prompt);
    if let Err(err) = inbound_tx.send(msg).await {
        error!("[automation] Failed to send StartSession: {}", err);
    }
}

async fn execute_kill_session(session_id: &str, inbound_tx: &mpsc::Sender<InboundMessage>) {
    info!(
        "[automation] Executing KillSession (session: {})",
        session_id
    );

    let kill_prompt = format!("[Automation:KillSession] session_id={}", session_id);
    let msg = InboundMessage::new("automation", "system", "automation", &kill_prompt);
    if let Err(err) = inbound_tx.send(msg).await {
        error!("[automation] Failed to send KillSession: {}", err);
    }
}

async fn execute_send_message(
    channel: &str,
    content: &str,
    inbound_tx: &mpsc::Sender<InboundMessage>,
) {
    info!("[automation] Executing SendMessage (channel: {})", channel);

    let msg = InboundMessage::new(
        "automation",
        "system",
        "automation",
        &format!(
            "[Automation:SendMessage] channel={}\n\n{}",
            channel, content
        ),
    );
    if let Err(err) = inbound_tx.send(msg).await {
        error!("[automation] Failed to send SendMessage: {}", err);
    }
}

async fn execute_inject_to_session(
    session_id: &str,
    message: &str,
    inbound_tx: &mpsc::Sender<InboundMessage>,
) {
    info!(
        "[automation] Executing InjectToSession (session: {})",
        session_id
    );

    let mut msg = InboundMessage::new("automation", "system", "automation", message);
    msg.session_key_override = Some(session_id.to_string());

    if let Err(err) = inbound_tx.send(msg).await {
        error!("[automation] Failed to inject to session: {}", err);
    }
}

#[cfg(test)]
mod start_session_gate_tests {
    use super::*;
    use tokio::sync::mpsc;

    /// Workflow-data path: missing `prompt` key on the action payload
    /// must abort the action without sending an InboundMessage. The
    /// previous `unwrap_or_default()` would have queued an empty-prompt
    /// session that the agent could not act on.
    #[tokio::test]
    async fn workflow_start_session_skips_when_prompt_missing() {
        let (tx, mut rx) = mpsc::channel::<InboundMessage>(8);
        let mut data = serde_json::Map::new();
        data.insert(
            "agentType".to_string(),
            serde_json::Value::String("default".to_string()),
        );
        let action = WorkflowActionInstance {
            id: "act_no_prompt".to_string(),
            definition_id: "start-session".to_string(),
            data,
            extra: serde_json::Map::new(),
        };
        execute_workflow_action(&action, &tx).await;
        assert!(
            rx.try_recv().is_err(),
            "no InboundMessage should be queued when prompt is missing"
        );
    }

    /// Typed path: an empty prompt string on `AutomationAction::StartSession`
    /// must also be rejected, otherwise rules built directly against the
    /// typed enum would bypass the workflow-side gate.
    #[tokio::test]
    async fn typed_start_session_skips_when_prompt_blank() {
        let (tx, mut rx) = mpsc::channel::<InboundMessage>(8);
        execute_start_session("default", "   ", None, None, &tx).await;
        assert!(
            rx.try_recv().is_err(),
            "execute_start_session should swallow whitespace-only prompts"
        );
    }

    /// Sanity: a non-empty prompt produces exactly one queued message.
    /// Locks the contract so the gate cannot accidentally swallow valid
    /// inputs in a future refactor.
    #[tokio::test]
    async fn typed_start_session_passes_real_prompt() {
        let (tx, mut rx) = mpsc::channel::<InboundMessage>(8);
        execute_start_session("default", "do the thing", None, None, &tx).await;
        let msg = rx.try_recv().expect("expected one InboundMessage");
        assert!(msg.content.contains("do the thing"));
        assert!(rx.try_recv().is_err(), "exactly one message expected");
    }
}
