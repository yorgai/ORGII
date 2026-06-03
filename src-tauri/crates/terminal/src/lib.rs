//! Terminal crate: PTY session management + agent-core terminal tool plumbing.
//!
//! Two halves, one crate:
//!
//! - [`pty_commands`] — front-side: PTY lifecycle (`create_pty`, `write_pty`,
//!   `resize_pty`, `close_pty`, …) exposed as Tauri commands; shell detection
//!   (`detect_available_shells`); shell-integration script payloads.
//! - [`agent_tool`] — back-side: LLM-tool helpers (`create_session`,
//!   `write_to_session`, `exec_in_pty`, `clean_pty_output`, `truncate_output`,
//!   …) used by `agent_core` `Tool` impls.
//!
//! Hoisting both halves into one crate collapses the previous back-edge from
//! `agent_core::foundation::tool_infra::terminal` → `work_station::terminal`
//! into an internal call between two sibling modules.

pub mod agent_tool;
pub mod pty_commands;
pub mod redaction;
