//! Turn executor helpers, grouped by concern.
//!
//! - [`truncate`] — UTF-8 safe output truncation (`safe_truncate_end`,
//!   `truncate_output`).
//! - [`message_writer`] — append assistant / tool-result messages onto the
//!   conversation history with the right wire shape (`add_assistant_message`,
//!   `add_tool_result*`, structured-sidecar plumbing).
//! - [`message_accessor`] — read-only typed accessors over OpenAI-compat
//!   message JSON (`msg_role`, `msg_tool_calls`, `last_assistant_text`).
//! - [`permission`] — `check_permission` wrapper around the
//!   `PermissionProvider` trait, with cancel-flag race.
//!
//! Items are re-exported flat so existing callers (`tool_execution::*`,
//! `length_recovery`, `stream_error_recovery`) continue to import via
//! `super::helpers::{add_tool_result, …}` without churn.

mod message_accessor;
mod message_writer;
mod permission;
mod truncate;

pub use message_accessor::{last_assistant_text, msg_role, msg_tool_calls};
pub use message_writer::{
    add_assistant_message, add_tool_result, add_tool_result_rich_with_timestamp,
    add_tool_result_with_timestamp, STRUCTURED_CONTENT_BLOCKS_KEY, STRUCTURED_SIDECAR_KEY,
    TOOL_RESULT_IS_ERROR_KEY,
};
pub(crate) use permission::check_permission;
pub use truncate::{safe_truncate_end, truncate_output};
