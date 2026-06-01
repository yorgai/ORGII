//! Shared application state.
//!
//! Holds runtime handles (agent browser controller, screenshot store) that both
//! `agent_core` and `browser` need to read or write. Lives in its own
//! crate so neither side has to depend on the other.

pub mod browser_state;
pub mod screenshot_state;

pub use browser_state::{
    run_browser_cli_command, split_browser_cli_command, AgentBrowserConfig, AgentBrowserController,
    BrowserAutomationProvider, BrowserCliConfig, BrowserCliOutput,
};
pub use screenshot_state::ScreenshotStore;
