//! Message-table helpers: CRUD, image cleanup, builder shortcuts, and
//! LLM history reconstruction.
//!
//! Split out of a single 802-line `messages.rs` (Apr 2026). The parent
//! `db_helpers/mod.rs` does `mod messages; pub use messages::*;` so all
//! free functions stay reachable at the same path as before — callers
//! continue to import via `agent_core::persistence::*`.
//!
//! Submodules:
//! - `cleanup`  — image-file cleanup + table-level deletes
//!   (`clear_messages`, `truncate_messages_after`, `delete_last_user_turn`).
//! - `builders` — typed convenience constructors that wrap `insert_message_retry`
//!   (`save_user_msg`, `save_assistant_msg`, `save_tool_call_msg`,
//!   `save_tool_result_msg`).
//! - `load_llm` — `load_llm_history` + the multimodal/image helpers it
//!   uses, plus the parallel/serial tool-call merging tests that pin
//!   the LLM-format invariants.

mod builders;
mod cleanup;
#[cfg(test)]
mod insert_tests;
mod load_llm;

pub use builders::{save_assistant_msg, save_tool_call_msg, save_tool_result_msg, save_user_msg};
pub use cleanup::{clear_messages, delete_last_user_turn, truncate_messages_after};
pub use load_llm::load_llm_history;
