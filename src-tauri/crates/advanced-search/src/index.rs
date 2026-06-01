//! USearch-backed semantic index with sled metadata storage.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};

use crate::embedders::Embedder;
use crate::types::{
    generate_point_id, CodeChunkPayload, SemanticConfig, SemanticHit, EMBEDDING_DIM,
};

pub struct SemanticIndex {
    index: usearch::Index,
    metadata_db: sled::Db,
    embedder: Arc<dyn Embedder>,
    index_path: PathBuf,
    last_access: AtomicU64,
    vector_count: AtomicU64,
    #[allow(dead_code)]
    config: SemanticConfig,
}

impl SemanticIndex {
    /// Create or open a semantic index.
    ///
    /// `index_path` is the directory where `vectors.usearch` and the sled
    /// metadata DB live. The caller is responsible for resolving it (e.g.
    /// `~/.orgii/semantic_index/`).
    pub async fn new(
        config: SemanticConfig,
        embedder: Arc<dyn Embedder>,
        index_path: PathBuf,
    ) -> Result<Self> {
        std::fs::create_dir_all(&index_path)?;

        let usearch_path = index_path.join("vectors.usearch");
        let metadata_path = index_path.join("metadata");

        let metadata_db = sled::open(&metadata_path).context("Failed to open metadata database")?;

        let index = usearch::new_index(&usearch::IndexOptions {
            dimensions: EMBEDDING_DIM,
            metric: usearch::MetricKind::Cos,
            quantization: usearch::ScalarKind::F16,
            connectivity: 16,
            expansion_add: 128,
            expansion_search: 64,
            multi: false,
        })
        .context("Failed to create USearch index")?;

        const INITIAL_CAPACITY: usize = 100_000;

        let vector_count = if usearch_path.exists() {
            println!(
                "📂 [USearch] Loading existing index from {:?}",
                usearch_path
            );
            index
                .load(&usearch_path.to_string_lossy())
                .context("Failed to load existing USearch index")?;
            let current_size = index.size();
            let current_capacity = index.capacity();

            let free_capacity = current_capacity.saturating_sub(current_size);
            if free_capacity < 10_000 {
                let new_capacity = current_capacity + 50_000;
                println!(
                    "📈 [USearch] Expanding capacity: {} -> {} (current size: {})",
                    current_capacity, new_capacity, current_size
                );
                index
                    .reserve(new_capacity)
                    .context("Failed to expand index capacity")?;
            }

            current_size
        } else {
            println!("🆕 [USearch] Creating new index at {:?}", usearch_path);
            index
                .reserve(INITIAL_CAPACITY)
                .context("Failed to reserve index capacity")?;
            0
        };

        println!(
            "✅ [USearch] Index ready with {} vectors (capacity: {})",
            vector_count,
            index.capacity()
        );

        Ok(Self {
            index,
            metadata_db,
            embedder,
            index_path,
            last_access: AtomicU64::new(now_millis()),
            vector_count: AtomicU64::new(vector_count as u64),
            config,
        })
    }

    pub fn save(&self) -> Result<()> {
        let usearch_path = self.index_path.join("vectors.usearch");
        self.index
            .save(&usearch_path.to_string_lossy())
            .context("Failed to save USearch index")?;
        self.metadata_db
            .flush()
            .context("Failed to flush metadata database")?;
        println!(
            "💾 [USearch] Index saved ({} vectors)",
            self.vector_count.load(Ordering::Relaxed)
        );
        Ok(())
    }

    fn touch(&self) {
        self.last_access.store(now_millis(), Ordering::Relaxed);
    }

    pub fn idle_duration(&self) -> Duration {
        let last = self.last_access.load(Ordering::Relaxed);
        let now = now_millis();
        Duration::from_millis(now.saturating_sub(last))
    }

    pub fn size(&self) -> usize {
        self.index.size()
    }

    pub async fn index_chunk(&self, chunk: CodeChunkPayload) -> Result<()> {
        let embedding = self.embedder.embed(&chunk.content).await?;

        let id = generate_point_id(&chunk.repo_path, &chunk.relative_path, chunk.start_line);

        self.index
            .add(id, &embedding)
            .context("Failed to add vector to index")?;

        let metadata_bytes = serde_json::to_vec(&chunk)?;
        self.metadata_db.insert(id.to_be_bytes(), metadata_bytes)?;

        self.vector_count.fetch_add(1, Ordering::Relaxed);
        self.touch();

        Ok(())
    }

    /// Batch index multiple chunks at once for optimal performance.
    ///
    /// Uses batch embedding and batch USearch operations for 5-10x speedup.
    pub async fn batch_index_chunks(&self, chunks: Vec<CodeChunkPayload>) -> Result<usize> {
        if chunks.is_empty() {
            return Ok(0);
        }

        let chunk_count = chunks.len();

        let current_size = self.index.size();
        let current_capacity = self.index.capacity();
        let needed_capacity = current_size + chunk_count;

        if needed_capacity > current_capacity {
            let new_capacity = (needed_capacity as f64 * 1.5) as usize;
            println!(
                "   📈 [USearch] Expanding capacity: {} -> {} (need {} for {} new vectors)",
                current_capacity, new_capacity, needed_capacity, chunk_count
            );
            self.index
                .reserve(new_capacity)
                .context("Failed to expand index capacity")?;
        }

        let texts: Vec<&str> = chunks.iter().map(|c| c.content.as_str()).collect();

        if chunk_count > 50 {
            println!("   🔄 Embedding {} chunks...", chunk_count);
        }

        let embeddings = self.embedder.batch_embed(&texts).await?;

        if chunk_count > 50 {
            println!("   ✓ Embedded {} chunks, adding to USearch...", chunk_count);
        }

        let mut batch = sled::Batch::default();
        let mut add_errors = 0;

        for (chunk, embedding) in chunks.into_iter().zip(embeddings) {
            let id = generate_point_id(&chunk.repo_path, &chunk.relative_path, chunk.start_line);

            match self.index.add(id, &embedding) {
                Ok(_) => {
                    let metadata_bytes = serde_json::to_vec(&chunk)?;
                    batch.insert(id.to_be_bytes().as_slice(), metadata_bytes);
                }
                Err(e) => {
                    add_errors += 1;
                    if add_errors <= 3 {
                        println!("   ⚠️ [USearch] Failed to add vector (id={}): {}", id, e);
                    }
                    let _ = self.index.remove(id);
                    if let Err(e2) = self.index.add(id, &embedding) {
                        if add_errors <= 3 {
                            println!("   ❌ [USearch] Retry also failed: {}", e2);
                        }
                    } else {
                        let metadata_bytes = serde_json::to_vec(&chunk)?;
                        batch.insert(id.to_be_bytes().as_slice(), metadata_bytes);
                        add_errors -= 1;
                    }
                }
            }
        }

        self.metadata_db.apply_batch(batch)?;

        let successfully_added = chunk_count - add_errors;
        self.vector_count
            .fetch_add(successfully_added as u64, Ordering::Relaxed);
        self.touch();

        if chunk_count > 50 {
            if add_errors > 0 {
                println!(
                    "   ⚠️ Added {}/{} vectors to USearch ({} errors)",
                    successfully_added, chunk_count, add_errors
                );
            } else {
                println!("   ✓ Added {} vectors to USearch", chunk_count);
            }
        }

        if add_errors > 0 && successfully_added == 0 {
            anyhow::bail!("Failed to add any vectors to index ({} errors)", add_errors);
        }

        Ok(successfully_added)
    }

    pub async fn search(
        &self,
        query: &str,
        repo_filter: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SemanticHit>> {
        self.touch();

        println!(
            "🔍 [USearch] Searching: query='{}', repo_filter={:?}, limit={}",
            query, repo_filter, limit
        );

        let query_embedding = self.embedder.embed(query).await?;
        println!("   ✓ Query embedded ({}d vector)", query_embedding.len());

        let search_limit = if repo_filter.is_some() {
            limit * 5
        } else {
            limit
        };

        let results = self
            .index
            .search(&query_embedding, search_limit)
            .context("USearch search failed")?;

        println!("   📊 USearch returned {} raw results", results.keys.len());

        let mut hits = Vec::with_capacity(limit);
        let mut parse_errors = 0;

        for (key, distance) in results.keys.iter().zip(results.distances.iter()) {
            let metadata_bytes = match self.metadata_db.get(key.to_be_bytes())? {
                Some(bytes) => bytes,
                None => {
                    parse_errors += 1;
                    continue;
                }
            };

            let payload: CodeChunkPayload = match serde_json::from_slice(&metadata_bytes) {
                Ok(p) => p,
                Err(_) => {
                    parse_errors += 1;
                    continue;
                }
            };

            if let Some(filter_repo_id) = repo_filter {
                if payload.repo_id != filter_repo_id {
                    continue;
                }
            }

            // USearch cosine returns distance (1 - similarity); flip back to a
            // similarity score in [-1, 1].
            let score = 1.0 - distance;

            const MIN_SIMILARITY_THRESHOLD: f32 = 0.25;
            if score < MIN_SIMILARITY_THRESHOLD {
                continue;
            }

            hits.push(SemanticHit {
                repo_id: payload.repo_id,
                repo_path: payload.repo_path,
                relative_path: payload.relative_path,
                language: payload.language,
                content: payload.content,
                start_line: payload.start_line,
                end_line: payload.end_line,
                score,
            });

            if hits.len() >= limit {
                break;
            }
        }

        if parse_errors > 0 {
            println!("   ⚠️ Parse errors: {}", parse_errors);
        }
        println!("   ✅ Returning {} hits", hits.len());

        Ok(hits)
    }

    pub async fn delete_file_chunks(
        &self,
        repo_id: &str,
        relative_paths: &[String],
    ) -> Result<usize> {
        let mut deleted = 0;
        let mut keys_to_delete = Vec::new();

        for result in self.metadata_db.iter() {
            let (key_bytes, value_bytes) = result?;

            if let Ok(payload) = serde_json::from_slice::<CodeChunkPayload>(&value_bytes) {
                if payload.repo_id == repo_id && relative_paths.contains(&payload.relative_path) {
                    if key_bytes.len() == 8 {
                        let key = u64::from_be_bytes(key_bytes.as_ref().try_into().unwrap());
                        keys_to_delete.push(key);
                    }
                }
            }
        }

        let mut batch = sled::Batch::default();
        for key in &keys_to_delete {
            if self.index.remove(*key).is_ok() {
                deleted += 1;
            }
            batch.remove(key.to_be_bytes().as_slice());
        }

        self.metadata_db.apply_batch(batch)?;
        self.vector_count
            .fetch_sub(deleted as u64, Ordering::Relaxed);

        Ok(deleted)
    }

    pub async fn delete_repo(&self, repo_id: &str) -> Result<usize> {
        println!("🗑️  [USearch] Deleting vectors for repo: {}", repo_id);

        let mut deleted = 0;
        let mut keys_to_delete = Vec::new();

        for result in self.metadata_db.iter() {
            let (key_bytes, value_bytes) = result?;

            if let Ok(payload) = serde_json::from_slice::<CodeChunkPayload>(&value_bytes) {
                if payload.repo_id == repo_id {
                    if key_bytes.len() == 8 {
                        let key = u64::from_be_bytes(key_bytes.as_ref().try_into().unwrap());
                        keys_to_delete.push(key);
                    }
                }
            }
        }

        let mut batch = sled::Batch::default();
        for key in &keys_to_delete {
            if self.index.remove(*key).is_ok() {
                deleted += 1;
            }
            batch.remove(key.to_be_bytes().as_slice());
        }

        self.metadata_db.apply_batch(batch)?;

        self.vector_count
            .fetch_sub(deleted as u64, Ordering::Relaxed);

        println!("   ✓ Deleted {} vectors", deleted);
        Ok(deleted)
    }

    pub fn get_info(&self) -> HashMap<String, serde_json::Value> {
        let mut info = HashMap::new();
        info.insert(
            "vector_count".to_string(),
            serde_json::json!(self.index.size()),
        );
        info.insert(
            "capacity".to_string(),
            serde_json::json!(self.index.capacity()),
        );
        info.insert("dimensions".to_string(), serde_json::json!(EMBEDDING_DIM));
        info.insert(
            "index_path".to_string(),
            serde_json::json!(self.index_path.to_string_lossy()),
        );
        info.insert(
            "idle_seconds".to_string(),
            serde_json::json!(self.idle_duration().as_secs()),
        );
        info
    }
}

impl Drop for SemanticIndex {
    fn drop(&mut self) {
        if let Err(e) = self.save() {
            eprintln!("⚠️ [USearch] Failed to save index on drop: {}", e);
        }
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
