//! Comms tools — outbound messaging and inbox reads to channels (Slack,
//! Discord, weixin, telegram, …).
//!
//! - [`send_message`]  — `send_message` (post a message to a channel/chat)
//! - [`send_to_inbox`] — `send_to_inbox` (read recent messages from a channel)
//!
//! Category: [`tool_categories::COMMS`].
//!
//! [`tool_categories::COMMS`]: crate::tools::categories::COMMS

pub mod send_message;
pub mod send_to_inbox;
