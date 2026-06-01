//! Codex native OAuth provider.
//!
//! Speaks the OpenAI Responses API format against the Codex backend
//! (`chatgpt.com/backend-api/codex/responses`).
//!
//! Used when a Codex credential has OAuth authentication rather than a
//! standard OpenAI API key. The backend does NOT support the Chat Completions
//! API — only the Responses API.
//!
//! Note: Unlike the public OpenAI API, this backend does NOT support
//! `max_output_tokens` and `temperature` parameters.
//!
//! Translation:
//! - Chat Completions `messages` → Responses API `input`
//! - Chat Completions `tools[].function` → Responses API `tools[]` (flat)
//! - Chat Completions `tool_choice` → Responses API `tool_choice`
//! - Responses API `output[]` → `LLMResponse` with content + tool_calls

pub mod client;
pub mod streaming;
pub mod types;

pub use crate::providers::responses_common::types::extract_account_id_from_id_token;
pub use client::{CodexNativeClient, CodexOAuthRefreshConfig};
pub use types::{CODEX_ACCOUNT_ID_HEADER, CODEX_ID_TOKEN_ENV_KEY};
