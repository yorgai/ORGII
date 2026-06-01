//! Channel delivery utilities: split, retry, fallback, media references, and PII.
//!
//! ## Submodules
//! - [`splitting`]       — chunking by code-point or UTF-16 length, code-fence aware
//! - [`markdown_strip`]  — produce a safe plain-text fallback (used by retry's last attempt)
//! - [`retry`]           — exponential-backoff retry + plain-text fallback + delivery notice
//! - [`redact`]          — `redact_sender_id` PII pseudonymization
//! - [`media`]           — `MEDIA:/path` protocol — extract from outbound, inject into inbound
//! - [`context_header`]  — per-platform session context line for OS-agent prompts

mod context_header;
mod markdown_strip;
mod media;
mod redact;
mod retry;
mod splitting;

pub use context_header::build_channel_context_header;
pub use media::{extract_media_refs, inject_inbound_media};
pub use redact::redact_sender_id;
pub use retry::send_with_retry;
pub use splitting::{split_message, utf16_len};
