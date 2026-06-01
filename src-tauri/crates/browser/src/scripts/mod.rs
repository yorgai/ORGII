//! Browser initialization scripts
//!
//! Contains JavaScript that runs in webviews for various purposes:
//!
//! - [`navigation`]: SPA navigation detection (pushState/replaceState)
//! - [`anti_bot`]: Anti-bot detection evasion for platform-aware fingerprinting
//! - [`capture`]: Console and network log capture
//! - [`inspector`]: Element inspection (Chrome DevTools-like)
//! - [`page_agent`]: DOM automation (click, input, scroll) for inline webviews

mod anti_bot;
mod capture;
mod inspector;
mod navigation;
mod page_agent;
mod shortcut_forwarding;

pub use anti_bot::ANTI_BOT_DETECTION_SCRIPT;
pub use capture::{CONSOLE_CAPTURE_SCRIPT, NETWORK_CAPTURE_SCRIPT};
pub use inspector::ELEMENT_INSPECTOR_SCRIPT;
pub use navigation::SPA_NAVIGATION_SCRIPT;
pub use page_agent::PAGE_AGENT_SCRIPT;
pub use shortcut_forwarding::SHORTCUT_FORWARDING_SCRIPT;
