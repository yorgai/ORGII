//! VS-Code-style user settings.
//!
//! A single JSONC file at `~/.orgii/settings.jsonc` that can be edited via the
//! GUI or directly by agents.
//!
//! - **file_io**: Read/write JSONC with comment preservation.
//! - **watcher**: Watch for external file changes and emit Tauri events.
//! - **commands**: Tauri commands exposed to the frontend.
//! - **hooks**: IoC entry points for subsystems that want to react to settings
//!   changes (registered from `app::lib::run`).

pub mod commands;
pub mod file_io;
pub mod hooks;
pub mod watcher;

use std::sync::Mutex;

/// Global state for the settings module.
/// Holds the file watcher so it stays alive for the app's lifetime.
#[derive(Default)]
pub struct SettingsState {
    /// The file watcher handle (kept alive as long as the app runs)
    pub watcher_handle: Mutex<Option<watcher::SettingsWatcherHandle>>,
}

impl SettingsState {
    pub fn new() -> Self {
        Self::default()
    }
}
