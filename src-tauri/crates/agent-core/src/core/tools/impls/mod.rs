//! Shared tool implementations used by all agent variants.
//!
//! Organized by category. Each tool lives in a file (or subfolder) named
//! after its tool name, and consumers import via the deep path
//! `impls::<category>::<tool_name>::<ToolStruct>`. There are no flat
//! re-exports at the category level — discoverability is by directory.
//!
//! Folder names mirror the canonical `tools::categories::*` constants
//! (single source of truth for the category vocabulary).
//!
//! - [`agent_def`] — `manage_agent_def` (custom agent + org CRUD)
//! - [`coding`]    — file I/O, exec, code_search, edit_file, LSP, todo, worktree, …
//! - [`comms`]     — outbound messaging (`send_message`, `send_to_inbox`)
//! - [`database`]  — `db_explore`, `db_run`
//! - [`desktop`]   — native desktop automation tools
//! - [`meta`]      — tool discovery (`tool_search`)
//! - [`nodes`]     — compute-node CRUD (`manage_nodes`)
//! - [`orchestration`] — subagent invocation, session management, mode/next-step suggestions, ask_user_questions
//! - [`plan_mode`] — plan-mode planning tool (`create_plan`)
//! - [`project`]   — Project + work-item CRUD (`manage_project`, `manage_work_item`)
//! - [`web`]       — web search/fetch, browser control

pub mod agent_def;
pub mod coding;
pub mod comms;
pub mod database;
pub mod desktop;
pub mod meta;
pub mod nodes;
pub mod orchestration;
pub mod plan_mode;
pub mod project;
pub mod web;
