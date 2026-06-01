//! Isolated GPU embedder subprocess.
//!
//! Runs as a separate process to isolate Metal GPU crashes from the main
//! application. If this process crashes, the main app can restart it
//! without losing state.
//!
//! Communication is JSON-lines over stdin/stdout. Wire types live in the
//! library half of this crate (`advanced_search::embedders::ipc`).

use anyhow::Result;
use std::io::{BufRead, Write};

// Re-use the wire format from the library half so the bin and the
// `SubprocessEmbedder` client cannot drift.
use advanced_search::embedders::ipc::{Request, Response};

fn send_response(response: &Response) {
    let json = serde_json::to_string(response).unwrap();
    println!("{}", json);
    std::io::stdout().flush().ok();
}

fn send_error(id: u64, message: &str) {
    send_response(&Response::Error {
        id,
        message: message.to_string(),
    });
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod gpu_embedder {
    use anyhow::Result;
    use std::path::Path;

    const MAX_TOKENS: usize = 512;
    const CONTEXT_SIZE: u32 = 1024;
    const BATCH_SIZE: u32 = 512;

    /// Reset the context every N embeddings to dodge llama.cpp's Metal
    /// memory-corruption bug (crashes observed at 30-60 on M1 Pro).
    const MAX_EMBEDDINGS_BEFORE_RESET: usize = 20;

    pub struct GpuEmbedder {
        _backend: Box<llama_cpp_2::llama_backend::LlamaBackend>,
        model: Box<llama_cpp_2::model::LlamaModel>,
        context: llama_cpp_2::context::LlamaContext<'static>,
        n_embd: usize,
        embedding_count: usize,
        gpu_mode: bool,
    }

    impl GpuEmbedder {
        pub fn new(model_dir: &str) -> Result<Self> {
            use llama_cpp_2::context::params::LlamaContextParams;

            let model_path = Path::new(model_dir)
                .join("coderank_ggml")
                .join("coderankembed-q8_0.gguf");

            if !model_path.exists() {
                anyhow::bail!("Model not found: {:?}", model_path);
            }

            let gpu_layers: u32 = std::env::var("ORGII_GPU_LAYERS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(99);

            eprintln!("[Embedder] Initializing with {} GPU layers...", gpu_layers);

            let mut backend = Box::new(llama_cpp_2::llama_backend::LlamaBackend::init()?);
            backend.void_logs();

            let model_params = llama_cpp_2::model::params::LlamaModelParams::default()
                .with_n_gpu_layers(gpu_layers);

            let model = Box::new(llama_cpp_2::model::LlamaModel::load_from_file(
                &backend,
                &model_path,
                &model_params,
            )?);

            let n_embd = model.n_embd() as usize;

            let ctx_params = LlamaContextParams::default()
                .with_n_ctx(Some(std::num::NonZeroU32::new(CONTEXT_SIZE).unwrap()))
                .with_n_batch(BATCH_SIZE)
                .with_embeddings(true);

            // SAFETY: backend and model are heap-allocated (Box) so their
            // addresses are stable. The context borrows from them via raw
            // pointers internally. All three live for the program's
            // duration in this subprocess.
            let context = unsafe {
                std::mem::transmute::<
                    llama_cpp_2::context::LlamaContext<'_>,
                    llama_cpp_2::context::LlamaContext<'static>,
                >(model.new_context(&backend, ctx_params)?)
            };

            let mut embedder = Self {
                _backend: backend,
                model,
                context,
                n_embd,
                embedding_count: 0,
                gpu_mode: gpu_layers > 0,
            };

            eprintln!("[Embedder] Warming up with test embedding...");
            match embedder.embed_single("test warmup") {
                Ok(_) => {
                    eprintln!("[Embedder] Warmup successful");
                    embedder.embedding_count = 0;
                }
                Err(e) => {
                    anyhow::bail!("Warmup embedding failed (GPU may be unstable): {}", e);
                }
            }

            Ok(embedder)
        }

        pub fn dimensions(&self) -> usize {
            self.n_embd
        }

        pub fn mode(&self) -> &str {
            if self.gpu_mode {
                "Metal GPU"
            } else {
                "CPU"
            }
        }

        fn maybe_reset_context(&mut self) -> Result<()> {
            if self.gpu_mode && self.embedding_count >= MAX_EMBEDDINGS_BEFORE_RESET {
                use llama_cpp_2::context::params::LlamaContextParams;

                eprintln!(
                    "[Embedder] Resetting context after {} embeddings",
                    self.embedding_count
                );

                self.context.clear_kv_cache();

                std::thread::sleep(std::time::Duration::from_millis(50));

                let ctx_params = LlamaContextParams::default()
                    .with_n_ctx(Some(std::num::NonZeroU32::new(CONTEXT_SIZE).unwrap()))
                    .with_n_batch(BATCH_SIZE)
                    .with_embeddings(true);

                self.context = unsafe {
                    std::mem::transmute::<
                        llama_cpp_2::context::LlamaContext<'_>,
                        llama_cpp_2::context::LlamaContext<'static>,
                    >(self.model.new_context(&self._backend, ctx_params)?)
                };

                self.embedding_count = 0;
                eprintln!("[Embedder] Context reset complete");
            }
            Ok(())
        }

        fn embed_single(&mut self, text: &str) -> Result<Vec<f32>> {
            use llama_cpp_2::llama_batch::LlamaBatch;

            let tokens = self
                .model
                .str_to_token(text, llama_cpp_2::model::AddBos::Always)?;
            let tokens: Vec<_> = tokens.into_iter().take(MAX_TOKENS).collect();

            if tokens.is_empty() {
                return Ok(vec![0.0f32; self.n_embd]);
            }

            self.context.clear_kv_cache();

            let mut batch = LlamaBatch::new(tokens.len(), 1);
            let last_idx = tokens.len() - 1;
            for (i, token) in tokens.iter().enumerate() {
                batch.add(*token, i as i32, &[0i32], i == last_idx)?;
            }

            self.context.decode(&mut batch)?;

            let mut embedding = vec![0.0f32; self.n_embd];
            if let Ok(emb) = self.context.embeddings_seq_ith(0) {
                let len = emb.len().min(self.n_embd);
                embedding[..len].copy_from_slice(&emb[..len]);
            }

            let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm > 0.0 {
                for x in embedding.iter_mut() {
                    *x /= norm;
                }
            }

            self.embedding_count += 1;
            Ok(embedding)
        }

        pub fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
            use llama_cpp_2::llama_batch::LlamaBatch;

            let mut results = Vec::with_capacity(texts.len());

            eprintln!(
                "[Embedder] Processing batch of {} texts (total so far: {})",
                texts.len(),
                self.embedding_count
            );

            for (idx, text) in texts.iter().enumerate() {
                self.maybe_reset_context()?;

                if idx % 10 == 0 {
                    eprintln!(
                        "[Embedder] Embedding {}/{} in batch (global #{})",
                        idx,
                        texts.len(),
                        self.embedding_count
                    );
                }

                let tokens = self
                    .model
                    .str_to_token(text, llama_cpp_2::model::AddBos::Always)?;
                let tokens: Vec<_> = tokens.into_iter().take(MAX_TOKENS).collect();

                if tokens.is_empty() {
                    results.push(vec![0.0f32; self.n_embd]);
                    self.embedding_count += 1;
                    continue;
                }

                use std::io::Write;
                let _ = std::io::stderr().flush();

                self.context.clear_kv_cache();

                let mut batch = LlamaBatch::new(tokens.len(), 1);
                let last_idx = tokens.len() - 1;
                for (i, token) in tokens.iter().enumerate() {
                    batch.add(*token, i as i32, &[0i32], i == last_idx)?;
                }

                self.context.decode(&mut batch)?;

                let mut embedding = vec![0.0f32; self.n_embd];
                if let Ok(emb) = self.context.embeddings_seq_ith(0) {
                    let len = emb.len().min(self.n_embd);
                    embedding[..len].copy_from_slice(&emb[..len]);
                }

                batch.clear();

                let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
                if norm > 0.0 {
                    for x in embedding.iter_mut() {
                        *x /= norm;
                    }
                }

                results.push(embedding);
                self.embedding_count += 1;
            }

            eprintln!(
                "[Embedder] Batch complete. Total embeddings: {}",
                self.embedding_count
            );

            Ok(results)
        }
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn run_embedder_loop() -> Result<()> {
    use gpu_embedder::GpuEmbedder;

    eprintln!("[Embedder] Starting isolated GPU embedder subprocess...");

    let stdin = std::io::stdin();
    let mut embedder: Option<GpuEmbedder> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[Embedder] stdin read error: {}", e);
                break;
            }
        };

        if line.is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                send_error(0, &format!("Invalid JSON: {}", e));
                continue;
            }
        };

        match request {
            Request::Init { id, model_dir } => match GpuEmbedder::new(&model_dir) {
                Ok(e) => {
                    let dims = e.dimensions();
                    let mode = e.mode().to_string();
                    embedder = Some(e);
                    send_response(&Response::Ready {
                        id,
                        dimensions: dims,
                        mode,
                    });
                }
                Err(e) => {
                    send_error(id, &format!("Init failed: {}", e));
                }
            },

            Request::Embed { id, texts } => {
                if let Some(ref mut e) = embedder {
                    match e.embed_batch(&texts) {
                        Ok(embeddings) => {
                            send_response(&Response::Result { id, embeddings });
                        }
                        Err(err) => {
                            send_error(id, &format!("Embed failed: {}", err));
                        }
                    }
                } else {
                    send_error(id, "Embedder not initialized");
                }
            }

            Request::Ping { id } => {
                send_response(&Response::Pong { id });
            }

            Request::Shutdown { id } => {
                send_response(&Response::Bye { id });
                break;
            }
        }
    }

    eprintln!("[Embedder] Shutting down");
    Ok(())
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn run_embedder_loop() -> Result<()> {
    eprintln!("[Embedder] GPU embedder only available on Apple Silicon");
    send_error(
        0,
        "GPU embedder only available on Apple Silicon (aarch64-apple-darwin)",
    );
    Ok(())
}

fn main() {
    if let Err(e) = run_embedder_loop() {
        eprintln!("[Embedder] Fatal error: {}", e);
        std::process::exit(1);
    }
}
