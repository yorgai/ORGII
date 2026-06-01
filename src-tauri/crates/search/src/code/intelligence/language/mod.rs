//! Language Module
//!
//! Provides Tree-sitter language configurations.
//! Currently supports: Rust, JavaScript, TypeScript, Python

mod javascript;
mod python;
mod rust;
mod typescript;

use super::NameSpaces;
use std::sync::OnceLock;

/// A collection of all supported language definitions
pub static ALL_LANGUAGES: &[&TSLanguageConfig] = &[
    &rust::RUST,
    &javascript::JAVASCRIPT,
    &typescript::TYPESCRIPT,
    &python::PYTHON,
];

/// A generic language wrapper type.
pub enum Language<Config: 'static> {
    /// A supported language, with some `Config`.
    Supported(&'static Config),

    /// An unsupported language
    Unsupported,
}

/// Languages based on tree-sitter grammars
#[derive(Debug)]
pub struct TSLanguageConfig {
    /// A list of language names that can be processed by these scope queries
    pub language_ids: &'static [&'static str],

    /// Extensions that can help classify the file
    pub file_extensions: &'static [&'static str],

    /// tree-sitter grammar for this language
    pub grammar: fn() -> tree_sitter::Language,

    /// Compiled tree-sitter scope query for this language.
    pub scope_query: MemoizedQuery,

    /// Compiled tree-sitter hoverables query
    pub hoverable_query: MemoizedQuery,

    /// Namespaces defined by this language
    pub namespaces: NameSpaces,
}

#[derive(Debug)]
pub struct MemoizedQuery {
    slot: OnceLock<tree_sitter::Query>,
    scope_query: &'static str,
}

impl MemoizedQuery {
    pub const fn new(scope_query: &'static str) -> Self {
        Self {
            slot: OnceLock::new(),
            scope_query,
        }
    }

    /// Get a reference to the relevant tree sitter compiled query.
    ///
    /// Stable equivalent of `OnceLock::get_or_try_init` (nightly-only,
    /// tracking issue #109737): try `get`, otherwise compile the query
    /// and `set` it. Two threads racing here both compile, but at most
    /// one wins the `set` — losers drop their freshly compiled `Query`
    /// and read the winner's via `get`. tree-sitter `Query::new` is
    /// idempotent and fast enough that the duplicated work is fine,
    /// and avoids needing nightly.
    pub fn query(
        &self,
        grammar: fn() -> tree_sitter::Language,
    ) -> Result<&tree_sitter::Query, tree_sitter::QueryError> {
        if let Some(query) = self.slot.get() {
            return Ok(query);
        }
        let compiled = tree_sitter::Query::new(&grammar(), self.scope_query)?;
        // Ignore the `Err(_)` from a lost race — `get()` will return
        // the winner's instance on the next line.
        let _ = self.slot.set(compiled);
        Ok(self
            .slot
            .get()
            .expect("OnceLock just had a value set or already had one"))
    }
}

pub type TSLanguage = Language<TSLanguageConfig>;

impl TSLanguage {
    /// Find a tree-sitter language configuration from a language identifier
    pub fn from_id(lang_id: &str) -> Self {
        ALL_LANGUAGES
            .iter()
            .copied()
            .find(|target| {
                target
                    .language_ids
                    .iter()
                    .any(|&id| id.to_lowercase() == lang_id.to_lowercase())
            })
            .map_or(Language::Unsupported, Language::Supported)
    }

    /// Find a tree-sitter language configuration from a file extension
    pub fn from_extension(ext: &str) -> Self {
        ALL_LANGUAGES
            .iter()
            .copied()
            .find(|target| target.file_extensions.contains(&ext))
            .map_or(Language::Unsupported, Language::Supported)
    }
}
