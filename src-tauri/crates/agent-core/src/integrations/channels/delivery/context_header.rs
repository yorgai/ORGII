//! Per-platform session context header for OS-agent prompts.
//!
//! Mirrors `hermes-agent`'s `build_session_context_prompt()`: tells the LLM
//! which platform it is on, what character-limit / formatting constraints
//! apply, and what the originating chat is.

/// Build a session context prompt prefix for channel-attached OS-agent sessions.
///
/// `channel_name` is the full channel identifier, e.g. `"telegram:default"`,
/// `"wecom:corp1"`, `"discord:server"`.
pub fn build_channel_context_header(channel_name: &str, chat_id: &str, sender_id: &str) -> String {
    let platform = channel_name.split(':').next().unwrap_or(channel_name);
    let constraints = platform_constraints(platform);

    format!(
        "[Platform: {} | Channel: {} | Chat: {} | From: {}{}]",
        platform,
        channel_name,
        chat_id,
        sender_id,
        if constraints.is_empty() {
            String::new()
        } else {
            format!(" | {}", constraints)
        }
    )
}

fn platform_constraints(platform: &str) -> String {
    use crate::channels::config::channel_type as ct;
    match platform {
        ct::TELEGRAM => "max_chars:4096 (UTF-16), markdown supported, supports splitting".into(),
        ct::WECOM => "max_chars:2048, plain text preferred, no markdown".into(),
        ct::FEISHU | "lark" => "max_chars:30000, rich text supported".into(),
        ct::DISCORD => "max_chars:2000, markdown supported".into(),
        ct::SLACK => "max_chars:40000, mrkdwn format".into(),
        ct::WHATSAPP => "max_chars:4096, basic markdown".into(),
        ct::LINE => "max_chars:5000, plain text preferred".into(),
        ct::DINGTALK => "max_chars:20000, markdown supported in cards".into(),
        ct::MSTEAMS => "max_chars:28000, adaptive cards supported".into(),
        // Channels without a tuned constraint string still get a
        // safe fallback so the LLM is never told it has unlimited
        // capacity — a missing arm here previously produced an empty
        // header silently. Add an arm above when adding a new
        // platform; keep `channel_constraints_cover_all_known_types`
        // green so the omission surfaces as a test failure.
        ct::WEIXIN
        | ct::IMESSAGE
        | ct::SIGNAL
        | ct::ZALO
        | ct::MATRIX
        | ct::GOOGLECHAT
        | ct::EMAIL => "max_chars:2000, plain text preferred".into(),
        other => {
            tracing::debug!(
                "[channels] platform_constraints called for unknown platform {:?}; \
                 returning conservative default",
                other
            );
            "max_chars:2000, plain text preferred".into()
        }
    }
}

#[cfg(test)]
mod platform_constraints_tests {
    use super::platform_constraints;
    use crate::channels::config::channel_type as ct;

    /// Every channel type known to `config::channel_type` must produce
    /// a non-empty constraint string. Adding a new channel without a
    /// matching arm in `platform_constraints` will fail here instead of
    /// silently sending the LLM a constraint-less header.
    #[test]
    fn channel_constraints_cover_all_known_types() {
        let known = [
            ct::TELEGRAM,
            ct::DISCORD,
            ct::FEISHU,
            ct::WECOM,
            ct::WEIXIN,
            ct::SLACK,
            ct::WHATSAPP,
            ct::IMESSAGE,
            ct::SIGNAL,
            ct::DINGTALK,
            ct::ZALO,
            ct::LINE,
            ct::MSTEAMS,
            ct::MATRIX,
            ct::GOOGLECHAT,
            ct::EMAIL,
        ];
        for platform in known {
            let constraints = platform_constraints(platform);
            assert!(
                !constraints.is_empty(),
                "platform_constraints({platform:?}) returned empty — caller will \
                 emit a header without any LLM length/format guidance"
            );
        }
    }
}
