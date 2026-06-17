//! OpenAI-compatible HTTP client for LLM providers.
//!
//! Speaks the OpenAI chat completions API format, which is supported by
//! most providers (OpenAI, Anthropic via proxy, DeepSeek, Groq, OpenRouter,
//! Moonshot, DashScope, Gemini, etc.).
//!
//! Reads API keys from `~/.orgii/credentials.json`
//! via the validation module's `KeyService`.

pub mod client;
pub mod streaming;
pub mod types;
pub mod wire_expand;

pub use client::OpenAICompatClient;
pub use streaming::STREAM_PARSE_ERROR_KEY;
// `expand_tool_images_for_openai_wire` is reached only through the
// `super::super::wire_expand::*` path from sibling streaming modules,
// so we deliberately do not flatten it here.
