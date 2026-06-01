//! Question manager — structured user input mid-conversation.
//!
//! Mirrors the `PermissionManager` pattern: the tool broadcasts an event
//! (routed to the frontend over the Tauri IPC Channel), blocks on a
//! `oneshot::Receiver`, and the frontend resolves it via a Tauri command.
//!
//! Finalization model: when the user responds, rejects, or the wait is
//! cancelled, the manager emits an authoritative `agent:interaction_finalized`
//! event via [`super::finalize`] so the UI flips from "waiting" to
//! "answered" immediately — without waiting for the tool's `execute()` to
//! return and the LLM round-trip that follows.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use tracing::{info, warn};

use crate::tools::names as tool_names;

use super::finalize::{finalize_interaction_event, FinalizedStatus};

/// A single answer: list of selected option labels (or custom text).
pub type QuestionAnswer = Vec<String>;

/// Pending-request bookkeeping so `respond`/`reject` can emit a structured
/// finalized event without requiring the caller to re-plumb the session id
/// or tool_call_id.
struct PendingQuestion {
    sender: oneshot::Sender<Vec<QuestionAnswer>>,
    session_id: String,
    tool_call_id: Option<String>,
    /// Original `questions` payload — kept so the finalized event can carry
    /// structured labels back to the UI without the FE having to re-query.
    questions: serde_json::Value,
}

/// Manages pending question requests for an agent session.
pub struct QuestionManager {
    /// Pending requests keyed by `request_id`.
    pending: Arc<Mutex<HashMap<String, PendingQuestion>>>,
    /// Metadata mirror for `get_pending_metadata`.
    metadata: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    /// Session cancel flag — shared with `AgentSession::cancel_flag`. When set
    /// (Stop button), the tool's `await_with_cancel` wait returns `Cancelled`
    /// and the pending request is finalized as terminated.
    ///
    /// Optional to keep `QuestionManager::new()` callable from pre-existing
    /// call sites (channels, gateway) that don't have a per-session flag —
    /// they get an always-false flag, which matches the previous behavior.
    cancel_flag: Arc<AtomicBool>,
}

impl QuestionManager {
    /// Construct a manager with no cancel-flag wiring. Used by call sites that
    /// don't own an `AgentSession` (channels, gateway-only setups). Stop-button
    /// integration is a no-op for these managers.
    pub fn new() -> Self {
        Self::with_cancel_flag(Arc::new(AtomicBool::new(false)))
    }

    /// Construct a manager that shares the given cancel flag with its owning
    /// session, so that flipping the flag (Stop button) unblocks any pending
    /// question waits via [`super::finalize::await_with_cancel`].
    pub fn with_cancel_flag(cancel_flag: Arc<AtomicBool>) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            metadata: Arc::new(Mutex::new(HashMap::new())),
            cancel_flag,
        }
    }

    /// Expose the cancel flag so the tool's `execute()` can wait on it.
    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel_flag)
    }

    /// Return metadata for all currently pending questions.
    pub async fn get_pending_metadata(&self) -> Vec<serde_json::Value> {
        let pending = self.pending.lock().await;
        let meta = self.metadata.lock().await;
        pending
            .keys()
            .filter_map(|id| meta.get(id).cloned())
            .collect()
    }

    /// Ask questions and block until the user responds.
    ///
    /// Broadcasts `agent:question_request` (delivered to the frontend over
    /// the per-session Tauri IPC Channel) and returns a receiver that
    /// resolves when the frontend calls `agent_answer_questions`.
    pub async fn ask(
        &self,
        session_id: &str,
        request_id: &str,
        questions: &serde_json::Value,
        tool_call_id: Option<&str>,
    ) -> oneshot::Receiver<Vec<QuestionAnswer>> {
        let (sender, receiver) = oneshot::channel();

        self.pending.lock().await.insert(
            request_id.to_string(),
            PendingQuestion {
                sender,
                session_id: session_id.to_string(),
                tool_call_id: tool_call_id.map(str::to_string),
                questions: questions.clone(),
            },
        );

        let payload = serde_json::json!({
            "requestId": request_id,
            "sessionId": session_id,
            "questions": questions,
            "toolCallId": tool_call_id,
        });

        self.metadata
            .lock()
            .await
            .insert(request_id.to_string(), payload.clone());

        crate::bus::broadcast_event("agent:question_request", payload);

        info!(
            "[question] Asked {} question(s) (request={})",
            questions.as_array().map(|a| a.len()).unwrap_or(0),
            request_id
        );

        receiver
    }

    /// Remove a pending entry by `request_id`. If not found, fall back to
    /// scanning by `tool_call_id` — the frontend may pass the tool_call_id
    /// when the `agent:question_request` event was lost (channel drop) and
    /// the real request_id was never written into the event store.
    async fn take_pending(&self, id: &str) -> Option<(String, PendingQuestion)> {
        {
            let mut pending = self.pending.lock().await;
            if let Some(entry) = pending.remove(id) {
                self.metadata.lock().await.remove(id);
                return Some((id.to_string(), entry));
            }
            // Fallback: scan by tool_call_id
            let matching_key = pending
                .iter()
                .find(|(_, entry)| entry.tool_call_id.as_deref() == Some(id))
                .map(|(k, _)| k.clone());
            if let Some(key) = matching_key {
                let entry = pending.remove(&key).unwrap();
                self.metadata.lock().await.remove(&key);
                info!(
                    "[question] Matched by tool_call_id '{}' → request '{}'",
                    id, key
                );
                return Some((key, entry));
            }
        }
        None
    }

    /// Resolve a pending question request with user answers.
    ///
    /// Accepts either a `request_id` (e.g. `question-xxx`) or a
    /// `tool_call_id` (e.g. `tooluse_xxx`) — the latter is a fallback when
    /// the `agent:question_request` event didn't reach the frontend.
    ///
    /// Emits `agent:interaction_finalized` with structured answers so the UI
    /// flips from "waiting" to "answered" without waiting for the tool's
    /// `execute()` to return.
    pub async fn respond(&self, request_id: &str, answers: Vec<QuestionAnswer>) {
        let Some((resolved_id, entry)) = self.take_pending(request_id).await else {
            warn!("[question] No pending request found for {}", request_id);
            return;
        };

        let answer_labels = resolve_answer_labels(&entry.questions, &answers);
        let content = format_answers_for_llm(&entry.questions, &answers);

        finalize_interaction_event(
            &entry.session_id,
            entry.tool_call_id.as_deref(),
            tool_names::ASK_USER_QUESTIONS,
            FinalizedStatus::Answered,
            &content,
            serde_json::json!({
                "answers": answer_labels,
            }),
        );

        if entry.sender.send(answers).is_err() {
            warn!(
                "[question] Request {} was dropped before answers arrived",
                resolved_id
            );
        } else {
            info!("[question] Resolved request {}", resolved_id);
        }
    }

    /// Reject a pending question (user dismissed the dialog).
    pub async fn reject(&self, request_id: &str) {
        let Some((resolved_id, entry)) = self.take_pending(request_id).await else {
            return;
        };

        finalize_interaction_event(
            &entry.session_id,
            entry.tool_call_id.as_deref(),
            tool_names::ASK_USER_QUESTIONS,
            FinalizedStatus::Rejected,
            "The user dismissed the question.",
            serde_json::json!({ "answers": Vec::<Vec<String>>::new() }),
        );

        if entry.sender.send(Vec::new()).is_err() {
            warn!(
                "[question] Request {} was dropped before rejection arrived",
                resolved_id
            );
        } else {
            info!("[question] Rejected request {}", resolved_id);
        }
    }

    /// Invoked when the tool's wait was cancelled by the session cancel_flag
    /// (Stop button) or timed out. Drops the sender so any lingering
    /// `respond` call becomes a no-op, and emits a terminal event to the UI.
    pub async fn cancel_pending(&self, request_id: &str, status: FinalizedStatus) {
        self.metadata.lock().await.remove(request_id);
        let Some(entry) = self.pending.lock().await.remove(request_id) else {
            return;
        };

        let content = match status {
            FinalizedStatus::Cancelled => "The user stopped the session before answering.",
            FinalizedStatus::TimedOut => "The question timed out.",
            FinalizedStatus::Answered | FinalizedStatus::Rejected => {
                warn!(
                    "[question] cancel called with unexpected status {:?}",
                    status
                );
                "The question was terminated."
            }
        };

        finalize_interaction_event(
            &entry.session_id,
            entry.tool_call_id.as_deref(),
            tool_names::ASK_USER_QUESTIONS,
            status,
            content,
            serde_json::json!({ "answers": Vec::<Vec<String>>::new() }),
        );

        // Dropping `entry.sender` signals the tool that the request is gone.
        drop(entry.sender);
        info!(
            "[question] Pending request {} terminated (status={:?})",
            request_id, status
        );
    }
}

// ============================================================================
// Helpers — shared between the sync (`execute` return) and resolve paths
// ============================================================================

/// Resolve `answers` (option ids per question) into human-readable labels so
/// the UI can render the user's selection directly from the finalized event.
fn resolve_answer_labels(
    questions: &serde_json::Value,
    answers: &[Vec<String>],
) -> Vec<Vec<String>> {
    let Some(qs) = questions.as_array() else {
        return answers.to_vec();
    };
    qs.iter()
        .zip(answers.iter())
        .map(|(q, a)| {
            let options = q.get("options").and_then(|v| v.as_array());
            a.iter()
                .map(|selected_id| {
                    options
                        .and_then(|opts| {
                            opts.iter().find(|opt| {
                                opt.get("id").and_then(|v| v.as_str()) == Some(selected_id)
                            })
                        })
                        .and_then(|opt| opt.get("label").and_then(|v| v.as_str()))
                        .map(|label| label.to_string())
                        .unwrap_or_else(|| selected_id.clone())
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Format answers into the prose blob the LLM sees on the next turn.
/// Kept consistent with `QuestionTool::execute`'s return value so the UI
/// content matches the LLM content.
fn format_answers_for_llm(questions: &serde_json::Value, answers: &[Vec<String>]) -> String {
    let empty: Vec<serde_json::Value> = Vec::new();
    let qs = questions.as_array().unwrap_or(&empty);
    let formatted: Vec<String> = qs
        .iter()
        .zip(answers.iter())
        .map(|(q, a)| {
            let question_text = q.get("question").and_then(|v| v.as_str()).unwrap_or("?");
            let answer_text = if a.is_empty() {
                "Unanswered".to_string()
            } else {
                let options = q.get("options").and_then(|v| v.as_array());
                a.iter()
                    .map(|selected_id| {
                        options
                            .and_then(|opts| {
                                opts.iter().find(|opt| {
                                    opt.get("id").and_then(|v| v.as_str()) == Some(selected_id)
                                })
                            })
                            .and_then(|opt| opt.get("label").and_then(|v| v.as_str()))
                            .map(|label| format!("{} ({})", label, selected_id))
                            .unwrap_or_else(|| selected_id.clone())
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            format!("\"{}\" = \"{}\"", question_text, answer_text)
        })
        .collect();

    format!(
        "User has answered your questions: {}. You can now continue with the user's answers in mind.",
        formatted.join(", ")
    )
}

impl Default for QuestionManager {
    fn default() -> Self {
        Self::new()
    }
}
