//! Automation Bridge — global broadcast senders for external systems to fire automation triggers.
//!
//! The git watch `EventEmitter` and message bus can send events here without
//! depending on the automation engine directly. The engine subscribes on startup.

use parking_lot::RwLock;
use std::sync::LazyLock;
use tokio::sync::broadcast;

use super::triggers::GitBroadcastEvent;
use crate::bus::InboundMessage;

/// Global automation broadcast senders. Set by the engine on startup, read by external systems.
struct AutomationBridge {
    git_tx: Option<broadcast::Sender<GitBroadcastEvent>>,
    channel_msg_tx: Option<broadcast::Sender<InboundMessage>>,
}

static BRIDGE: LazyLock<RwLock<AutomationBridge>> = LazyLock::new(|| {
    RwLock::new(AutomationBridge {
        git_tx: None,
        channel_msg_tx: None,
    })
});

/// Register the automation broadcast senders (called by AutomationEngine on startup).
pub fn register(
    git_tx: broadcast::Sender<GitBroadcastEvent>,
    channel_msg_tx: broadcast::Sender<InboundMessage>,
) {
    let mut bridge = BRIDGE.write();
    bridge.git_tx = Some(git_tx);
    bridge.channel_msg_tx = Some(channel_msg_tx);
}

/// Unregister (called by AutomationEngine on stop).
pub fn unregister() {
    let mut bridge = BRIDGE.write();
    bridge.git_tx = None;
    bridge.channel_msg_tx = None;
}

/// Send a git event into the automation engine (called by git watch EventEmitter).
pub fn send_git_event(event: GitBroadcastEvent) {
    let bridge = BRIDGE.read();
    if let Some(ref tx) = bridge.git_tx {
        let _ = tx.send(event);
    }
}

/// Send a channel message into the automation engine (called by the message bus).
pub fn send_channel_message(msg: InboundMessage) {
    let bridge = BRIDGE.read();
    if let Some(ref tx) = bridge.channel_msg_tx {
        let _ = tx.send(msg);
    }
}
