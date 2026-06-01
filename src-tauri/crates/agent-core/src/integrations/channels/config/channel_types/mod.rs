//! Per-channel account and wrapper config structs.
//!
//! Each messaging channel has an `*AccountConfig` (per-instance settings)
//! and a `*Config` wrapper holding a `HashMap` of named accounts.
//!
//! Grouped by ecosystem:
//! - `social`     — Telegram, Discord, WhatsApp, Signal, iMessage
//! - `asian`      — Feishu / Lark, DingTalk, Zalo, LINE
//! - `enterprise` — Slack, Email, MS Teams, Matrix, Google Chat

mod asian;
mod enterprise;
mod social;

pub use asian::*;
pub use enterprise::*;
pub use social::*;
