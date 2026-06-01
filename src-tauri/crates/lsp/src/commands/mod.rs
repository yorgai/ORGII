//! LSP Tauri Commands
//!
//! Exposes LSP functionality to the frontend via Tauri commands.
//!
//! Organized into submodules by responsibility:
//! - `server`: LSP server lifecycle (start/stop/status/notifications)
//! - `discovery`: Detect installed LSP servers and lint tools
//! - `cache`: Persistent cache for LSP/Lint scan results
//! - `package_manager`: Package manager detection and command generation
//! - `install`: Install/uninstall commands for LSP servers and lint tools

mod cache;
mod install;
mod server;

// Public modules for reuse in other LSP modules
pub mod discovery;
pub mod package_manager;

use std::sync::Arc;
use tokio::sync::Mutex;

use super::manager::LspManager;

// Re-export state type
pub type LspManagerState = Arc<Mutex<LspManager>>;

// Re-export all items from submodules to ensure Tauri command macros work correctly.
// The #[tauri::command] macro generates __cmd__ prefixed functions that need to be
// accessible from the parent module for generate_handler! to work.
pub use discovery::*;
pub use install::*;
pub use server::*;
