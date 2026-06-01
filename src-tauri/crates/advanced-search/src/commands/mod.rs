//! Advanced search command surface.

#[cfg(feature = "semantic-search")]
pub(crate) mod helpers;
#[cfg(feature = "semantic-search")]
pub mod semantic_commands;
#[cfg(not(feature = "semantic-search"))]
pub mod stubs;
#[cfg(feature = "semantic-search")]
pub mod tantivy_commands;
pub mod types;

#[cfg(feature = "semantic-search")]
pub(crate) use semantic_commands::get_model_dir;
#[cfg(feature = "semantic-search")]
pub use semantic_commands::*;
#[cfg(not(feature = "semantic-search"))]
pub use stubs::*;
#[cfg(feature = "semantic-search")]
pub use tantivy_commands::*;
pub use types::*;

#[tauri::command]
pub fn check_advanced_search_enabled() -> bool {
    cfg!(feature = "semantic-search")
}
