//! Slash command handling (`/help`, `/new`, `/status`, `/compact`) for
//! channel-bound chats.

use crate::bus::{InboundMessage, OutboundMessage};
use crate::gateway::{GatewayCommand, SessionKey};
use crate::state::AgentAppState;
use tracing::info;

#[cfg(debug_assertions)]
use super::dispatch::push_debug_outbound;

/// Handle an explicit gateway command. All branches write an acknowledgment
/// message to the outbound bus (best-effort — if the bus publish fails the
/// user still observes the binding state change via `/status`).
pub(super) async fn handle_command(
    state: &AgentAppState,
    msg: &InboundMessage,
    session_key: &SessionKey,
    cmd: GatewayCommand,
) -> Result<Option<OutboundMessage>, String> {
    let reply_text = match cmd {
        GatewayCommand::NewSession => {
            state.gateway_bindings.clear(session_key).await;
            info!("[gateway] Cleared binding for {}", session_key.as_str());
            "Conversation reset. The next message starts a fresh session.".to_string()
        }
        GatewayCommand::Status => {
            let binding = state.gateway_bindings.get(session_key).await;
            let running: Vec<String> = state.list_sessions().await;
            let binding_line = match binding {
                Some(b) => format!("• This chat → `{}`", b.target_session_id),
                None => "• No active session yet (the next message starts one).".to_string(),
            };
            let running_list = if running.is_empty() {
                "(none)".to_string()
            } else {
                running
                    .iter()
                    .map(|s| format!("  - `{}`", s))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            format!(
                "**Status**\n{}\n• Active sessions:\n{}",
                binding_line, running_list
            )
        }
        GatewayCommand::Compact => {
            use crate::session::compaction::manual::{
                run_manual_compact, ManualCompactResult, MIN_HISTORY_FOR_MANUAL_COMPACT,
            };

            // Resolve the bound session for this chat. If the chat has no
            // binding there's no session to compact yet.
            let target_sid = match state.gateway_bindings.get(session_key).await {
                Some(b) => b.target_session_id,
                None => {
                    let text = "No session is bound to this chat yet. Send a message first so one is created.".to_string();
                    let reply = OutboundMessage::new(&msg.channel, &msg.chat_id, &text);
                    {
                        let bus = state.bus.lock().await;
                        bus.publish_outbound(reply.clone());
                    }
                    #[cfg(debug_assertions)]
                    push_debug_outbound(state, &reply).await;
                    return Ok(None);
                }
            };

            let reset_policy = state
                .integrations
                .snapshot()
                .channels
                .gateway
                .reset_policy
                .clone();

            match run_manual_compact(state, &target_sid, &reset_policy).await {
                ManualCompactResult::Forked(s) => {
                    let suffix = if s.truncated {
                        "\n_(Note: compactor fell back to truncation — older context dropped without summary.)_"
                    } else {
                        ""
                    };
                    format!(
                        "🗜️ Context compacted.\nCompressed: {} → {} messages (~{} → ~{} tokens).\nContinuing in new session `{}` (previous: `{}`).{}",
                        s.messages_before,
                        s.messages_after,
                        s.tokens_before,
                        s.tokens_after,
                        s.new_session_id,
                        s.old_session_id,
                        suffix,
                    )
                }
                ManualCompactResult::AlreadyCompact { message_count, tokens } => format!(
                    "Nothing to compact — current transcript ({} messages, ~{} tokens) still fits the model budget. Send more messages first.",
                    message_count, tokens
                ),
                ManualCompactResult::TooShort { message_count } => format!(
                    "Not enough conversation to compact (have {}, need at least {}).",
                    message_count, MIN_HISTORY_FOR_MANUAL_COMPACT
                ),
                ManualCompactResult::NotChannelAttached => {
                    "This session is not channel-attached, so /compact has no fork target. App-side sessions compact automatically in place.".to_string()
                }
                ManualCompactResult::NoRuntime => {
                    "Session has no active runtime yet. Send a message first, then try /compact.".to_string()
                }
                ManualCompactResult::Failed(reason) => format!("Compact failed: {}", reason),
            }
        }
        GatewayCommand::Help => build_help_text(),
    };

    let reply = OutboundMessage::new(&msg.channel, &msg.chat_id, &reply_text);
    {
        let bus = state.bus.lock().await;
        bus.publish_outbound(reply.clone());
    }
    // E2E observability: slash replies previously lived only on the
    // outbound bus, which has no buffered subscribers in the dev
    // harness — so `outbound-snapshot` could not verify the reply
    // text. Mirror the `prepend_reset_notice` pattern and keep a
    // copy in the debug buffer.
    #[cfg(debug_assertions)]
    push_debug_outbound(state, &reply).await;
    Ok(None)
}

/// Static cheat-sheet for the `/help` slash command.
///
/// Hermes parallel: `gateway/run.py:_handle_help_command` →
/// `hermes_cli.commands.gateway_help_lines()`. Hermes builds the list
/// dynamically from a `COMMAND_REGISTRY`; we keep the cheat-sheet
/// hand-maintained in MVP because the surface is small (six commands)
/// and the source of truth is the `GatewayCommand` enum next door —
/// the unit test below pins the alignment.
///
/// Keep the body short: Telegram's per-message budget is ~4096 chars
/// and we don't want the LLM to be tempted to repeat this list back to
/// the user.
fn build_help_text() -> String {
    [
        "**Commands**",
        "`/help` — show this list (alias: `/commands`).",
        "`/new` — reset this chat; the next message starts a fresh session.",
        "`/status` — show the current session and anything else running.",
        "`/compact` — compress the current session and continue in a versioned successor.",
    ]
    .join("\n")
}

#[cfg(test)]
mod help_text_tests {
    use super::build_help_text;

    #[test]
    fn lists_every_supported_slash_command() {
        let text = build_help_text();
        for cmd in ["/help", "/new", "/status", "/compact"] {
            assert!(text.contains(cmd), "help cheat-sheet missing {cmd}: {text}");
        }
    }

    /// `/switch` and `/agent` were removed after dogfooding surfaced
    /// that end-users never use them (they'd have to copy/paste an
    /// opaque `sdeagent-...` session id). The `/help` cheat-sheet must
    /// not advertise them to avoid discovery + confusion.
    #[test]
    fn does_not_advertise_removed_commands() {
        let text = build_help_text();
        assert!(
            !text.contains("/switch"),
            "help still mentions /switch: {text}"
        );
        assert!(
            !text.contains("/agent"),
            "help still mentions /agent: {text}"
        );
    }

    #[test]
    fn fits_telegram_message_budget() {
        // Hermes caps at 4096 (Telegram limit). 1KB is plenty of head-room
        // for a static list and forces us to revisit if we balloon.
        assert!(build_help_text().len() < 1024);
    }
}
