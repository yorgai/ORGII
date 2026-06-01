//! Message merge buffer.
//!
//! When a user sends multiple messages in quick succession (e.g. a photo album,
//! or split-up long typing), we coalesce them into a single `InboundMessage`
//! before forwarding to the channel inbound handler. This mirrors `hermes-agent`'s
//! `merge_pending_message_event()`.
//!
//! ## Algorithm
//!
//! A per-session entry holds:
//!   - A list of pending `InboundMessage`s
//!   - A deadline (`Instant`) past which the batch is flushed
//!
//! On each new message:
//!   1. Push to the pending list and reset the deadline to `now + MERGE_WINDOW`.
//!   2. The background flush task polls the map every 50 ms and drains any
//!      entries whose deadline has passed.
//!   3. Draining merges all pending messages by concatenating their `content`
//!      with `\n---\n` separators, preserving the first message's metadata
//!      (channel, chat_id, sender_id, timestamp, session_key_override).
//!
//! Sessions with infrequent messages (most normal sessions) are unaffected:
//! the first message will be flushed after one 500 ms window.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::bus::InboundMessage;

/// The coalescing window. Messages received within this window of each other
/// are merged into one.
const MERGE_WINDOW: Duration = Duration::from_millis(600);

/// Separator used to join merged message contents.
const MERGE_SEPARATOR: &str = "\n\n---\n\n";

/// Pending entry for one logical conversation slot.
struct PendingMergeBatch {
    /// Messages accumulated so far.
    messages: Vec<InboundMessage>,
    /// Flush when the current time exceeds this deadline.
    deadline: Instant,
}

/// Shared merge buffer, keyed by session key (`InboundMessage::session_key()`).
#[derive(Clone)]
pub struct MergeBuffer {
    inner: Arc<Mutex<HashMap<String, PendingMergeBatch>>>,
}

impl Default for MergeBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl MergeBuffer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Push a message into the buffer and reset the merge window.
    pub async fn push(&self, msg: InboundMessage) {
        let key = msg.session_key();
        let mut map = self.inner.lock().await;
        let entry = map.entry(key).or_insert_with(|| PendingMergeBatch {
            messages: Vec::new(),
            deadline: Instant::now() + MERGE_WINDOW,
        });
        entry.messages.push(msg);
        entry.deadline = Instant::now() + MERGE_WINDOW;
    }

    /// Drain all sessions whose deadline has passed.
    ///
    /// Returns a list of merged `InboundMessage`s ready for processing.
    pub async fn drain_ready(&self) -> Vec<InboundMessage> {
        let now = Instant::now();
        let mut map = self.inner.lock().await;
        let mut ready_keys: Vec<String> = Vec::new();
        for (key, entry) in map.iter() {
            if now >= entry.deadline {
                ready_keys.push(key.clone());
            }
        }
        let mut results = Vec::new();
        for key in ready_keys {
            if let Some(entry) = map.remove(&key) {
                if let Some(merged) = merge_messages(entry.messages) {
                    results.push(merged);
                }
            }
        }
        results
    }
}

/// Merge a list of messages into one.
///
/// Uses the first message as the base (channel, chat_id, sender_id, etc.)
/// and concatenates all `content` values with a separator. Returns `None`
/// only if the list is empty.
fn merge_messages(messages: Vec<InboundMessage>) -> Option<InboundMessage> {
    if messages.is_empty() {
        return None;
    }
    if messages.len() == 1 {
        return Some(messages.into_iter().next().unwrap());
    }

    let mut base = messages[0].clone();
    let parts: Vec<&str> = messages.iter().map(|m| m.content.as_str()).collect();
    base.content = parts.join(MERGE_SEPARATOR);
    // Keep the most recent timestamp.
    if let Some(last) = messages.last() {
        base.timestamp = last.timestamp;
    }
    Some(base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_msg(channel: &str, content: &str) -> InboundMessage {
        InboundMessage {
            channel: channel.to_string(),
            sender_id: "user1".to_string(),
            chat_id: "chat1".to_string(),
            content: content.to_string(),
            timestamp: Utc::now(),
            media: vec![],
            metadata: Default::default(),
            session_key_override: None,
        }
    }

    #[test]
    fn test_merge_single() {
        let msg = make_msg("telegram:default", "hello");
        let merged = merge_messages(vec![msg.clone()]).unwrap();
        assert_eq!(merged.content, "hello");
    }

    #[test]
    fn test_merge_multiple() {
        let msgs = vec![
            make_msg("telegram:default", "part one"),
            make_msg("telegram:default", "part two"),
            make_msg("telegram:default", "part three"),
        ];
        let merged = merge_messages(msgs).unwrap();
        assert!(merged.content.contains("part one"));
        assert!(merged.content.contains("part two"));
        assert!(merged.content.contains("part three"));
        assert!(merged.content.contains(MERGE_SEPARATOR.trim()));
    }

    #[test]
    fn test_merge_empty() {
        assert!(merge_messages(vec![]).is_none());
    }

    #[tokio::test]
    async fn test_buffer_push_and_drain() {
        let buf = MergeBuffer::new();
        buf.push(make_msg("telegram:default", "msg1")).await;
        buf.push(make_msg("telegram:default", "msg2")).await;

        // Deadline hasn't passed yet — nothing ready.
        let ready = buf.drain_ready().await;
        assert!(ready.is_empty());

        // Sleep past the merge window.
        tokio::time::sleep(MERGE_WINDOW + Duration::from_millis(50)).await;
        let ready = buf.drain_ready().await;
        assert_eq!(ready.len(), 1);
        let merged = &ready[0];
        assert!(merged.content.contains("msg1"));
        assert!(merged.content.contains("msg2"));

        // Buffer should be empty now.
        let ready2 = buf.drain_ready().await;
        assert!(ready2.is_empty());
    }
}
