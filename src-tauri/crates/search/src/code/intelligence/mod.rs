//! Intelligence Module
//!
//! Provides Tree-sitter based code intelligence:
//! - Scope graph construction
//! - Symbol extraction
//! - Go-to-definition and find-references

// Many items are part of the public API but not yet used internally
#[allow(dead_code)]
mod language;
mod namespace;
mod scope_resolution;

pub use language::{Language, TSLanguage, TSLanguageConfig, ALL_LANGUAGES};
pub use namespace::*;
pub use scope_resolution::ScopeGraph;

use std::time::{Duration, Instant};

use scope_resolution::ResolutionMethod;
use streaming_iterator::StreamingIterator;
use tree_sitter::{ParseOptions, ParseState, Parser, Tree};

use super::super::text_range::TextRange;

/// A tree-sitter representation of a file
pub struct TreeSitterFile<'a> {
    /// The original source that was used to generate this file.
    src: &'a [u8],

    /// The syntax tree of this file.
    tree: Tree,

    /// The supplied language for this file.
    language: &'static TSLanguageConfig,
}

#[derive(Debug)]
pub enum TreeSitterFileError {
    UnsupportedLanguage,
    ParseTimeout,
    LanguageMismatch,
    QueryError(tree_sitter::QueryError),
    FileTooLarge,
}

const PARSE_TIMEOUT: Duration = Duration::from_secs(1);

fn parse_with_timeout(parser: &mut Parser, src: &[u8]) -> Option<Tree> {
    let deadline = Instant::now() + PARSE_TIMEOUT;
    let mut read = |byte_offset: usize, _position| &src[byte_offset..];
    let mut progress = |_state: &ParseState| Instant::now() < deadline;
    let options = ParseOptions::new().progress_callback(&mut progress);
    parser.parse_with_options(&mut read, None, Some(options))
}

impl<'a> TreeSitterFile<'a> {
    /// Create a TreeSitterFile out of a sourcefile
    pub fn try_build(src: &'a [u8], lang_id: &str) -> Result<Self, TreeSitterFileError> {
        // no scope-res for files larger than 500kb
        if src.len() > 500 * 10usize.pow(3) {
            return Err(TreeSitterFileError::FileTooLarge);
        }

        let language = match TSLanguage::from_id(lang_id) {
            Language::Supported(language) => Ok(language),
            Language::Unsupported => Err(TreeSitterFileError::UnsupportedLanguage),
        }?;

        let mut parser = Parser::new();
        parser
            .set_language(&(language.grammar)())
            .map_err(|_| TreeSitterFileError::LanguageMismatch)?;

        let tree = parse_with_timeout(&mut parser, src).ok_or(TreeSitterFileError::ParseTimeout)?;

        Ok(Self {
            src,
            tree,
            language,
        })
    }

    /// Create a TreeSitterFile from a file extension
    pub fn try_build_from_extension(
        src: &'a [u8],
        extension: &str,
    ) -> Result<Self, TreeSitterFileError> {
        if src.len() > 500 * 10usize.pow(3) {
            return Err(TreeSitterFileError::FileTooLarge);
        }

        let language = match TSLanguage::from_extension(extension) {
            Language::Supported(language) => Ok(language),
            Language::Unsupported => Err(TreeSitterFileError::UnsupportedLanguage),
        }?;

        let mut parser = Parser::new();
        parser
            .set_language(&(language.grammar)())
            .map_err(|_| TreeSitterFileError::LanguageMismatch)?;

        let tree = parse_with_timeout(&mut parser, src).ok_or(TreeSitterFileError::ParseTimeout)?;

        Ok(Self {
            src,
            tree,
            language,
        })
    }

    pub fn hoverable_ranges(self) -> Result<Vec<TextRange>, TreeSitterFileError> {
        let query = self
            .language
            .hoverable_query
            .query(self.language.grammar)
            .map_err(TreeSitterFileError::QueryError)?;
        let root_node = self.tree.root_node();
        let mut cursor = tree_sitter::QueryCursor::new();
        let mut matches = cursor.matches(query, root_node, self.src);
        let mut ranges = Vec::new();
        while let Some(m) = matches.next() {
            for capture in m.captures {
                ranges.push(capture.node.range().into());
            }
        }
        Ok(ranges)
    }

    /// Produce a lexical scope-graph for this TreeSitterFile.
    pub fn scope_graph(self) -> Result<ScopeGraph, TreeSitterFileError> {
        let query = self
            .language
            .scope_query
            .query(self.language.grammar)
            .map_err(TreeSitterFileError::QueryError)?;
        let root_node = self.tree.root_node();

        Ok(ResolutionMethod::Generic.build_scope(query, root_node, self.src, self.language))
    }

    /// Get the language configuration
    pub fn language(&self) -> &'static TSLanguageConfig {
        self.language
    }

    /// Get the source bytes
    pub fn source(&self) -> &[u8] {
        self.src
    }

    /// Get the syntax tree
    pub fn tree(&self) -> &Tree {
        &self.tree
    }
}
