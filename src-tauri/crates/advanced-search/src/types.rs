//! Pure types and helpers (no heavy deps, no async runtime).

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Embedding vector (typically 384 or 768 dimensions).
pub type Embedding = Vec<f32>;

/// Dimension of embeddings.
///
/// CodeRankEmbed uses 768 dimensions. Jina embeddings v2 base code also
/// produces 768 dimensions.
pub const EMBEDDING_DIM: usize = 768;

/// Payload stored with each vector point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunkPayload {
    pub repo_id: String,
    pub repo_path: String,
    pub relative_path: String,
    pub language: String,
    pub content: String,
    pub start_line: u64,
    pub end_line: u64,
    pub content_hash: String,
}

/// Semantic search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticHit {
    pub repo_id: String,
    pub repo_path: String,
    pub relative_path: String,
    pub language: String,
    pub content: String,
    pub start_line: u64,
    pub end_line: u64,
    pub score: f32,
}

/// Semantic index configuration.
///
/// Path resolution (e.g. `~/.orgii/semantic_index/`) is the caller's
/// responsibility; pass the resolved path to [`crate::SemanticIndex::new`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticConfig {
    pub collection_name: String,
    pub embedding_model: String,
    pub chunk_size: usize,
    pub chunk_overlap: usize,
}

impl Default for SemanticConfig {
    fn default() -> Self {
        Self {
            collection_name: "orgii_code_vectors".to_string(),
            embedding_model: "CodeRankEmbed".to_string(),
            chunk_size: 512,
            chunk_overlap: 64,
        }
    }
}

/// Code chunk for indexing.
pub struct CodeChunk {
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub hash: String,
}

/// Generate unique point ID for vector storage.
///
/// Returns a u64 hash derived from `(repo_path, relative_path, start_line)`.
pub fn generate_point_id(repo_path: &str, relative_path: &str, start_line: u64) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    repo_path.hash(&mut hasher);
    relative_path.hash(&mut hasher);
    start_line.hash(&mut hasher);
    hasher.finish()
}

/// Chunk source code into overlapping line windows ready for embedding.
pub fn chunk_code(content: &str, chunk_size: usize, overlap: usize) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    let mut chunks = Vec::new();

    if lines.is_empty() {
        return chunks;
    }

    let mut start = 0;
    while start < lines.len() {
        let end = (start + chunk_size).min(lines.len());
        let chunk_lines = &lines[start..end];
        let chunk_content = chunk_lines.join("\n");

        let hash = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(chunk_content.as_bytes());
            hasher.finalize().to_hex().to_string()
        };

        chunks.push(CodeChunk {
            content: chunk_content,
            start_line: start + 1,
            end_line: end,
            hash,
        });

        if end >= lines.len() {
            break;
        }

        start = end.saturating_sub(overlap);
    }

    chunks
}

/// Returns true when the GGUF model + tokenizer are present under
/// `<model_dir>/coderank_ggml/`.
pub fn model_files_present(model_dir: &Path) -> bool {
    let ggml_dir = model_dir.join("coderank_ggml");
    ggml_dir.join("coderankembed-q8_0.gguf").exists() && ggml_dir.join("tokenizer.json").exists()
}
