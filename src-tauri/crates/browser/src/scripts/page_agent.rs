//! Page Agent initialization script
//!
//! Provides DOM automation capabilities for Tauri inline webviews:
//! - DOM tree extraction with interactive element detection
//! - Element highlighting with index labels
//! - Synthetic event dispatch for clicks, inputs, scrolls
//! - User takeover mask for blocking interaction during automation
//!
//! Exposes API on `window.__PAGE_AGENT__`

/// Page Agent script that gets injected into inline webviews.
pub const PAGE_AGENT_SCRIPT: &str = include_str!("page_agent/page_agent.js");
