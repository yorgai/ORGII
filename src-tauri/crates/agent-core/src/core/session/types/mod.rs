//! Unified session types for all agent types.
//!
//! This module defines the core abstractions that unify session management
//! across different agent variants (OS, SDE, Custom).

mod context;
mod enums;
mod filter;
mod turn;

pub use context::{
    presence_mode_ids, IdeContext, PresenceStance, ProcessingContext, ProcessingResult,
    SystemPromptConfig, ToolSummary, UserPresence, UserProfile,
};
pub use enums::{AgentExecMode, SessionStatus};
pub use filter::SessionListFilter;
pub use turn::{DialogTurn, DialogTurnState, TurnStats};
