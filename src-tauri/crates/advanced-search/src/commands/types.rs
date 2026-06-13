//! Shared advanced search command wire types.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilters {
    pub file_extensions: Option<Vec<String>>,
    pub exclude_dirs: Option<Vec<String>>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub use_regex: Option<bool>,
    pub max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalResult {
    pub files_updated: usize,
    pub files_failed: usize,
    pub failed_paths: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct EmbeddingModelStatus {
    pub installed: bool,
    pub model_size_bytes: Option<u64>,
    pub model_dir: String,
}
