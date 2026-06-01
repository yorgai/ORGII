//! UI Indexer
//!
//! Static analysis of frontend source code, indexed for instant in-IDE lookup.
//! Powers the embedded browser inspector and the component catalog UI.
//!
//! Four sub-pipelines, all keyed by repository path and held in a single
//! [`UiIndexState`]:
//!
//! 1. **Component locator** — React/Vue/Svelte component name → source
//!    file/line. Drives "click an element in the browser → jump to source".
//! 2. **Prop extraction** — TypeScript prop type parsing for the
//!    "Storybook for AI" component catalog (lazy, on-demand).
//! 3. **Story extraction** — parses `.orgii.tsx` story files for the
//!    component preview surface.
//! 4. **Token extraction** — scans CSS/SCSS files for `var(--token)` usage
//!    and definitions to back the design-token panel.
//!
//! ```text
//! Source files (tsx/jsx/vue/svelte/css) ─┐
//!                                        ├── tree-sitter / regex parsers
//! Repo path                            ──┘
//!                                        │
//!                                        ▼
//!                                 UiIndex  (HashMap, ~1ms lookup)
//! ```
//!
//! All Tauri commands prefixed `ui_index_*` (see [`commands`]). The six
//! commands without that prefix (`extract_stories`, `list_story_files`,
//! `extract_tokens`, `extract_tokens_from_files`, `scan_global_tokens`,
//! `extract_token_definitions`) are stateless file-parsers that don't
//! touch the shared [`UiIndexState`].

mod commands;
mod indexer;
mod parser;
mod types;

pub use commands::*;
pub use indexer::UiIndexer;
pub use types::*;
