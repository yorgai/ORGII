//! Shared file operations service: read, write, edit, list_dir.
//!
//! Used by:
//! - Agent tools (`ReadFileTool`, `WriteFileTool`, `ListDirTool`)
//! - Tauri commands for frontend file operations
//!
//! All operations share the same path validation and optional sandboxing logic.
//! Each I/O call is wrapped with [`super::FILE_IO_TIMEOUT`] to guard against hangs
//! on network mounts or locked files.
//!
//! ## Layout
//!
//! - [`formats`]         — image / PDF / Jupyter detection + extraction
//! - [`path_resolution`] — tilde expansion, sandbox, lexical normalize, `EntryKind`
//! - [`fallback`]        — basename walk + Levenshtein "did you mean" chain
//! - [`read`]            — `read_file_in_range` (+ `_with_extras` variant)
//! - [`list`]            — `list_dir_with_extras`
//!
//! Only the variants actually called from outside this module are
//! re-exported flat. The unsuffixed `read_file` / `edit_file` / `list_dir` /
//! `resolve_path` helpers are kept as sibling-private and reached through
//! the explicit submodule path (`read::read_file`, etc.) when the rare
//! in-crate test needs them.

#[cfg(test)]
#[path = "../tests/file_tests.rs"]
mod tests;

mod fallback;
mod formats;
mod list;
mod path_resolution;
mod read;

use super::FILE_IO_TIMEOUT;

pub use list::list_dir_with_extras;
pub use path_resolution::resolve_path_with_extras;
pub(crate) use read::format_text_result;
pub use read::{read_file_in_range, read_file_in_range_with_extras, stat_file_with_extras};

// Re-exported for the in-crate test module (`tests/file_tests.rs`) which
// reaches into format-detection helpers.
#[cfg(test)]
pub(crate) use formats::{detect_image_mime, is_notebook, is_pdf, parse_notebook};

// Re-exported for `pill_resolver` to share the same PDF extraction path.
pub(crate) use formats::{extract_pdf_text, is_pdf as is_pdf_file};
