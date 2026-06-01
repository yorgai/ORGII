//! Security module for agent tool execution.
//!
//! Provides execution-time security controls that complement the
//! tool-level access policy (`ResolvedToolPolicy`):
//!
//! - **[`SecurityPolicy`]**: Command allowlisting, pipeline validation,
//!   risk classification, rate limiting, path traversal prevention
//! - **[`ActionTracker`]**: Sliding-window rate limiter
//! - **[`AutonomyLevel`]**: ReadOnly / Full access modes

pub mod config;
pub mod policy;
pub mod tracker;

// Items kept at the `security::` surface:
// - `SecurityPolicy`, `ValidationResult` — flat-imported by tool registration
//   and exec tool sites.
// - `AutonomyLevel`, `requires_user_confirmation` — flat-imported by
//   `core::definitions::schema` (`security::AutonomyLevel`) and the exec
//   tool (`security::requires_user_confirmation`); also referenced as
//   `super::AutonomyLevel` from sibling `config.rs`.
//
// `SecurityConfig`, `ActionTracker`, and `CommandRiskLevel` were flat
// re-exported but never imported as `security::<name>` anywhere; they're
// always reached via the deeper `config::` / `tracker::` / `policy::`
// segment, so we no longer flatten them.
pub use policy::{
    requires_user_confirmation, AutonomyLevel, CommandRiskRules, SecurityPolicy, ValidationResult,
};
