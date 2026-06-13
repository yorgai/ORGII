//! Optional advanced code search stack.

pub mod commands;

#[cfg(feature = "semantic-search")]
pub mod embedders;
#[cfg(feature = "semantic-search")]
mod index;
#[cfg(feature = "semantic-search")]
pub mod semantic;
#[cfg(feature = "semantic-search")]
mod types;

#[cfg(feature = "semantic-search")]
pub use embedders::Embedder;
#[cfg(feature = "semantic-search")]
pub use embedders::MockEmbedder;
#[cfg(feature = "semantic-search")]
pub use index::SemanticIndex;
#[cfg(feature = "semantic-search")]
pub use types::{
    chunk_code, generate_point_id, model_files_present, CodeChunk, CodeChunkPayload, Embedding,
    SemanticConfig, SemanticHit, EMBEDDING_DIM,
};

#[cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "semantic-search"
))]
pub use embedders::{GgmlEmbedder, SubprocessEmbedder};
