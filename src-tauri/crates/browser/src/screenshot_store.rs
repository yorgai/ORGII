//! Screenshot Storage
//!
//! **Note:** The `ScreenshotStore` struct has been moved to `shared_state::screenshot_state`
//! to resolve circular dependencies. This module re-exports it for compatibility.

// Re-export types from shared_state for backward compatibility
pub use shared_state::screenshot_state::{ScreenshotEntry, ScreenshotStore};

#[cfg(test)]
#[path = "tests/screenshot_store_tests.rs"]
mod tests;
