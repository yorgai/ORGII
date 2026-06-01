//! Shared types for code search commands.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSearchResult {
    pub file_path: String,
    pub matches: Vec<CodeSearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSearchMatch {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub text: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolSearchResult {
    pub file_path: String,
    pub symbols: Vec<CodeSymbolInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSymbolInfo {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeLocation {
    pub file_path: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilters {
    pub file_extensions: Option<Vec<String>>,
    pub exclude_dirs: Option<Vec<String>>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub use_regex: Option<bool>,
    pub max_results: Option<usize>,
}

#[derive(Serialize, Clone)]
pub struct EmbeddingModelStatus {
    pub installed: bool,
    pub model_size_bytes: Option<u64>,
    pub model_dir: String,
}
