//! Automation module.
//!
//! General-purpose trigger→action engine for unified rule-based automation.

pub mod actions;
pub mod bridge;
pub mod engine;
pub mod persistence;
pub mod triggers;
pub mod types;

pub use engine::AutomationEngine;
pub use triggers::GitBroadcastEvent;
// `AutomationRule` / `AutomationStatus` are referenced flat by
// `state::commands::automation` and `gateway::service`; the
// `AutomationAction` / `AutomationTrigger` enums are only used through
// the deeper `automation::types::*` path (`policies::behavior`,
// `automation::actions`, the test modules), so they don't need to be
// flattened onto `automation::*`.
pub use types::{AutomationRule, AutomationStatus};
