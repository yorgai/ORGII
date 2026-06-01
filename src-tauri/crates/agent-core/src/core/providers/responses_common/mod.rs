//! Shared types and utilities for OpenAI Responses API.
//!
//! Used by both:
//! - `OpenAIResponsesClient` — public OpenAI API (`api.openai.com/v1/responses`)
//! - `CodexNativeClient` — Codex native backend (`chatgpt.com/backend-api/codex/responses`)

pub mod converter;
pub mod parser;
pub mod streaming_events;
pub mod types;

// `ResponseContent`, `ResponseFunctionCall`, `ResponseMessage` are only
// used inside `parser.rs`'s test module via the deeper
// `responses_common::types::*` path, so we don't need to flatten them.
pub use converter::{convert_messages, convert_tools};
pub use parser::{parse_response, response_reasoning_summary_text_from_values};
pub use streaming_events::{ResponsesStreamNormalizer, ResponsesStreamOutput};
pub use types::{
    enforce_strict_schema, ResponseItem, ResponsesError, ResponsesRequest, ResponsesResponse,
    ResponsesUsage, StreamEvent,
};
