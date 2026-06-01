//! Semantic search exports and availability helper.

#[cfg(feature = "semantic-search")]
pub use crate::{
    chunk_code, generate_point_id, model_files_present, CodeChunk, CodeChunkPayload, Embedder,
    Embedding, MockEmbedder, SemanticConfig, SemanticHit, SemanticIndex, EMBEDDING_DIM,
};

#[cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "semantic-search"
))]
pub use crate::{GgmlEmbedder, SubprocessEmbedder};

pub fn is_semantic_available() -> bool {
    #[cfg(feature = "semantic-search")]
    {
        let model_dir = crate::commands::get_model_dir();
        crate::model_files_present(&model_dir)
    }
    #[cfg(not(feature = "semantic-search"))]
    {
        false
    }
}
