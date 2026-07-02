//! LLM context window management.
//!
//! Layered on top of the raw `Vec<Value>` message history that turn_executor
//! produces. Each module narrows the history before it goes back to the
//! provider, in order from cheapest to most expensive:
//!
//! | Module             | When it runs                          | Cost                         |
//! |--------------------|---------------------------------------|------------------------------|
//! | [`tokenizer`]      | On demand (token counts for budgets)  | None — pure tiktoken BPE     |
//! | [`microcompact`]   | Every turn (image cap) + idle gap     | None — in-place struct edits |
//! | [`file_reinjection`] | Every turn after FS edits           | None — string substitution   |
//! | [`cleanup`]        | Every turn (orphan tool_call_ids)     | None — index/HashSet pass    |
//! | [`session_memory`] | Trigger when history nears budget     | One LLM call to fork agent   |
//! | [`summarization`]  | Helper for compaction                 | One LLM call                 |
//! | [`compaction`]     | Last resort when SM can't keep up     | One full LLM rewrite         |
//!
//! All modules operate on the same `Vec<serde_json::Value>` shape so they
//! compose without translation layers. Constants for the structured-sidecar
//! sub-keys live in `turn_executor::helpers` (they're owned by the producer).

pub mod cleanup;
pub mod compaction;
pub mod file_reinjection;
pub mod microcompact;
pub mod plan_preservation;
pub mod session_memory;
pub(crate) mod summarization;
pub mod tokenizer;

// No flat re-exports — every consumer imports through the explicit
// submodule path (`model_context::compaction::*`,
// `model_context::session_memory::*`, `model_context::tokenizer::*`,
// `model_context::microcompact::*`, etc.). Flattening here would only
// add dead surface.
