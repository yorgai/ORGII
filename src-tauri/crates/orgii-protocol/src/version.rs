//! Protocol versioning and the connection-level handshake.
//!
//! The desktop and mobile clients exchange a [`Frame::Handshake`]
//! variant as the first message immediately after the WebSocket
//! upgrade so version mismatch is detected before any RPC traffic
//! flows. Mismatches close the connection with a typed reason
//! rather than producing cryptic deserialization errors mid-stream.
//!
//! The handshake is folded into the [`Frame`] enum (see
//! `frames.rs`) so a single `from_str::<Frame>` decode path handles
//! every inbound message. There is no separate top-level envelope.
//!
//! [`Frame::Handshake`]: crate::Frame::Handshake

use serde::{Deserialize, Serialize};

/// Current protocol version. Bump on any breaking wire change.
///
/// Compatibility policy:
/// - Same major + minor: forward and backward compatible. Clients ignore
///   unknown enum variants and missing optional fields.
/// - Same major, different minor: peers MUST negotiate down to the
///   minimum supported minor. Done by exchanging the
///   `Frame::Handshake` variant.
/// - Different major: relay rejects the connection.
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion { major: 0, minor: 1 };

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

impl ProtocolVersion {
    pub const fn new(major: u16, minor: u16) -> Self {
        Self { major, minor }
    }

    /// True iff `peer` can be negotiated with us. Same major required.
    pub const fn is_compatible_with(self, peer: ProtocolVersion) -> bool {
        self.major == peer.major
    }
}

/// Which side of the bridge a peer is. The relay routes desktop
/// sockets and mobile sockets to different queues inside a
/// `UserHub` actor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerRole {
    Desktop,
    Mobile,
}
