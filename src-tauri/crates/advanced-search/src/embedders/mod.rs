//! Embedder trait + concrete implementations.
//!
//! - [`MockEmbedder`] — deterministic test embedder, always available.
//! - [`GgmlEmbedder`] — in-process Metal/llama.cpp embedder (Apple Silicon).
//! - [`SubprocessEmbedder`] — spawns the `orgii-embedder` bin and talks to it
//!   over JSON-lines stdio (Apple Silicon).

use anyhow::Result;
use async_trait::async_trait;

use crate::types::{Embedding, EMBEDDING_DIM};

/// Trait for embedding providers.
#[async_trait]
pub trait Embedder: Send + Sync {
    /// Generate embedding for a single text.
    async fn embed(&self, text: &str) -> Result<Embedding>;

    /// Batch embed multiple texts.
    async fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Embedding>>;
}

/// Deterministic mock embedder for tests and pipeline checks.
///
/// Produces a normalized vector derived from the input hash. Not a real
/// embedding — never use in production search paths.
pub struct MockEmbedder {
    dim: usize,
}

impl MockEmbedder {
    pub fn new() -> Self {
        Self { dim: EMBEDDING_DIM }
    }
}

impl Default for MockEmbedder {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Embedder for MockEmbedder {
    async fn embed(&self, text: &str) -> Result<Embedding> {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        text.hash(&mut hasher);
        let seed = hasher.finish();

        let mut embedding = Vec::with_capacity(self.dim);
        for i in 0..self.dim {
            let val = ((seed.wrapping_add(i as u64) % 1000) as f32 / 1000.0) - 0.5;
            embedding.push(val);
        }

        let magnitude: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        for val in &mut embedding {
            *val /= magnitude;
        }

        Ok(embedding)
    }

    async fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Embedding>> {
        let mut results = Vec::with_capacity(texts.len());
        for text in texts {
            results.push(self.embed(text).await?);
        }
        Ok(results)
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod metal;

// IPC types are shared between SubprocessEmbedder and the `orgii-embedder` bin.
// The bin lives in this same crate; on non-Apple-Silicon targets the bin's
// `run_embedder_loop()` is a no-op stub but still needs the request type for
// JSON parsing — keep this module always-on and pub so the bin can reach it.
pub mod ipc;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub use metal::{GgmlEmbedder, SubprocessEmbedder};
