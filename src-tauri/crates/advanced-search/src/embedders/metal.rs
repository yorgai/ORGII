//! Apple Silicon Metal/llama.cpp embedder implementations.
//!
//! - `GgmlEmbedder` — in-process GGUF model on a dedicated GPU thread
//!   (Metal needs all ops on the same OS thread for stability).
//! - `SubprocessEmbedder` — spawns the `orgii-embedder` bin and talks to it
//!   over JSON-lines stdio so Metal crashes don't take the main app down.

use std::path::Path;
use std::sync::OnceLock;

use anyhow::Result;
use async_trait::async_trait;

use crate::embedders::Embedder;
use crate::types::Embedding;

const MAX_TOKENS: usize = 512;
const CONTEXT_SIZE: u32 = 1024;
const BATCH_SIZE: u32 = 512;

/// llama.cpp Metal crashes after ~400 embeddings due to GPU memory
/// corruption (https://github.com/ggml-org/llama.cpp/issues/18568).
/// Recreating the context every 20 embeddings resets the GPU state.
const MAX_EMBEDDINGS_BEFORE_CONTEXT_RESET: usize = 20;

static GPU_EXECUTOR: OnceLock<GpuExecutor> = OnceLock::new();

#[allow(dead_code)]
enum GpuMessage {
    EmbedSingle {
        text: String,
        response: tokio::sync::oneshot::Sender<Result<Embedding>>,
    },
    EmbedBatch {
        texts: Vec<String>,
        response: tokio::sync::oneshot::Sender<Result<Vec<Embedding>>>,
    },
    Shutdown,
}

/// Dedicated GPU-thread executor.
///
/// All Metal operations happen on the spawned `gpu-embedder` thread to
/// preserve thread affinity (a hard requirement for Metal stability).
struct GpuExecutor {
    sender: std::sync::mpsc::Sender<GpuMessage>,
}

impl GpuExecutor {
    fn new(model_dir: &Path, gpu_layers: u32) -> Result<Self> {
        use llama_cpp_2::context::params::LlamaContextParams;

        let ggml_dir = model_dir.join("coderank_ggml");

        if !ggml_dir.exists() {
            anyhow::bail!("GGUF directory not found: {:?}", ggml_dir);
        }

        let model_file = ggml_dir.join("coderankembed-q8_0.gguf");
        if !model_file.exists() {
            anyhow::bail!(
                "GGUF model not found: {:?}\n\nDownload from: https://huggingface.co/awhiteside/CodeRankEmbed-Q8_0-GGUF",
                model_file
            );
        }

        let model_file_clone = model_file.clone();

        let (sender, receiver) = std::sync::mpsc::channel::<GpuMessage>();

        std::thread::Builder::new()
            .name("gpu-embedder".to_string())
            .spawn(move || {
                println!("[GPU Thread] Starting dedicated GPU thread...");

                let mut backend = match llama_cpp_2::llama_backend::LlamaBackend::init() {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[GPU Thread] Failed to init backend: {}", e);
                        return;
                    }
                };
                backend.void_logs();

                let model_params = llama_cpp_2::model::params::LlamaModelParams::default()
                    .with_n_gpu_layers(gpu_layers);

                let gpu_mode = if gpu_layers > 0 {
                    format!("Metal GPU ({} layers)", gpu_layers)
                } else {
                    "CPU only".to_string()
                };
                println!("[GPU Thread] Loading model with {} mode...", gpu_mode);

                let model = match llama_cpp_2::model::LlamaModel::load_from_file(
                    &backend,
                    &model_file_clone,
                    &model_params,
                ) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("[GPU Thread] Failed to load model: {}", e);
                        if gpu_layers > 0 {
                            eprintln!(
                                "[GPU Thread] Try setting ORGII_GPU_LAYERS=0 to use CPU mode"
                            );
                        }
                        return;
                    }
                };

                let n_embd = model.n_embd() as usize;

                let make_ctx_params = || {
                    LlamaContextParams::default()
                        .with_n_ctx(Some(std::num::NonZeroU32::new(CONTEXT_SIZE).unwrap()))
                        .with_n_batch(BATCH_SIZE)
                        .with_embeddings(true)
                };

                let mut context = match model.new_context(&backend, make_ctx_params()) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[GPU Thread] Failed to create context: {}", e);
                        return;
                    }
                };

                if let Ok(tokens) = model.str_to_token("warmup", llama_cpp_2::model::AddBos::Always)
                {
                    use llama_cpp_2::llama_batch::LlamaBatch;
                    let mut batch = LlamaBatch::new(tokens.len(), 1);
                    let last_idx = tokens.len().saturating_sub(1);
                    for (i, token) in tokens.iter().enumerate() {
                        let _ = batch.add(*token, i as i32, &[0i32], i == last_idx);
                    }
                    let _ = context.decode(&mut batch);
                    batch.clear();
                    context.clear_kv_cache();
                }

                let mode_str = if gpu_layers > 0 { "Metal GPU" } else { "CPU" };
                println!(
                    "[GPU Thread] CodeRankEmbed Q8 ready ({}, {}d)",
                    mode_str, n_embd
                );

                let mut embedding_count: usize = 0;
                let needs_context_reset = gpu_layers > 0;

                loop {
                    if needs_context_reset
                        && embedding_count >= MAX_EMBEDDINGS_BEFORE_CONTEXT_RESET
                    {
                        println!(
                            "[GPU Thread] Recreating context after {} embeddings (Metal workaround)",
                            embedding_count
                        );

                        context.clear_kv_cache();
                        drop(context);

                        std::thread::sleep(std::time::Duration::from_millis(50));

                        context = match model.new_context(&backend, make_ctx_params()) {
                            Ok(c) => c,
                            Err(e) => {
                                eprintln!("[GPU Thread] Failed to recreate context: {}", e);
                                break;
                            }
                        };

                        embedding_count = 0;
                        println!("[GPU Thread] Context recreated successfully");
                    }

                    match receiver.recv() {
                        Ok(GpuMessage::EmbedSingle { text, response }) => {
                            let result =
                                Self::do_embed_single(&model, &mut context, &text, n_embd);
                            let _ = response.send(result);
                            embedding_count += 1;
                        }
                        Ok(GpuMessage::EmbedBatch { texts, response }) => {
                            let batch_size = texts.len();
                            let result =
                                Self::do_embed_batch(&model, &mut context, &texts, n_embd);
                            let _ = response.send(result);
                            embedding_count += batch_size;
                        }
                        Ok(GpuMessage::Shutdown) | Err(_) => {
                            println!("[GPU Thread] Shutting down");
                            break;
                        }
                    }
                }
            })?;

        println!("[Embedding] GPU executor thread spawned");

        Ok(Self { sender })
    }

    fn do_embed_single(
        model: &llama_cpp_2::model::LlamaModel,
        context: &mut llama_cpp_2::context::LlamaContext,
        text: &str,
        n_embd: usize,
    ) -> Result<Embedding> {
        use llama_cpp_2::llama_batch::LlamaBatch;

        let tokens = model.str_to_token(text, llama_cpp_2::model::AddBos::Always)?;
        let tokens: Vec<_> = tokens.into_iter().take(MAX_TOKENS).collect();

        if tokens.is_empty() {
            return Ok(vec![0.0f32; n_embd]);
        }

        context.clear_kv_cache();

        let mut batch = LlamaBatch::new(tokens.len(), 1);
        let last_idx = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            // Only the last token needs logits for embeddings.
            batch.add(*token, i as i32, &[0i32], i == last_idx)?;
        }

        context.decode(&mut batch)?;

        let mut embedding = vec![0.0f32; n_embd];
        if let Ok(emb) = context.embeddings_seq_ith(0) {
            let len = emb.len().min(n_embd);
            embedding[..len].copy_from_slice(&emb[..len]);
        }

        batch.clear();

        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in embedding.iter_mut() {
                *x /= norm;
            }
        }

        Ok(embedding)
    }

    fn do_embed_batch(
        model: &llama_cpp_2::model::LlamaModel,
        context: &mut llama_cpp_2::context::LlamaContext,
        texts: &[String],
        n_embd: usize,
    ) -> Result<Vec<Embedding>> {
        let mut results = Vec::with_capacity(texts.len());

        for (idx, text) in texts.iter().enumerate() {
            match Self::do_embed_single(model, context, text, n_embd) {
                Ok(emb) => results.push(emb),
                Err(e) => {
                    if idx == 0 {
                        println!("   [GPU] Embedding error: {}", e);
                    }
                    results.push(vec![0.0f32; n_embd]);
                }
            }
        }

        Ok(results)
    }

    async fn embed(&self, text: String) -> Result<Embedding> {
        let (tx, rx) = tokio::sync::oneshot::channel();

        self.sender
            .send(GpuMessage::EmbedSingle { text, response: tx })
            .map_err(|e| anyhow::anyhow!("Failed to send to GPU thread: {}", e))?;

        rx.await
            .map_err(|e| anyhow::anyhow!("GPU thread channel closed: {}", e))?
    }

    async fn batch_embed(&self, texts: Vec<String>) -> Result<Vec<Embedding>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let (tx, rx) = tokio::sync::oneshot::channel();

        self.sender
            .send(GpuMessage::EmbedBatch {
                texts,
                response: tx,
            })
            .map_err(|e| anyhow::anyhow!("Failed to send to GPU thread: {}", e))?;

        rx.await
            .map_err(|e| anyhow::anyhow!("GPU thread channel closed: {}", e))?
    }
}

/// In-process GGUF embedder using llama-cpp-2 with Metal GPU acceleration.
///
/// Uses a process-wide singleton GPU executor thread; constructing multiple
/// `GgmlEmbedder` instances reuses the same backend.
pub struct GgmlEmbedder {
    _marker: std::marker::PhantomData<()>,
}

impl GgmlEmbedder {
    pub fn new(model_dir: &Path, gpu_layers: u32) -> Result<Self> {
        if GPU_EXECUTOR.get().is_none() {
            let executor = GpuExecutor::new(model_dir, gpu_layers)?;
            let _ = GPU_EXECUTOR.set(executor);
        } else {
            println!("[Embedding] Reusing existing GPU executor");
        }

        Ok(Self {
            _marker: std::marker::PhantomData,
        })
    }
}

#[async_trait]
impl Embedder for GgmlEmbedder {
    async fn embed(&self, sequence: &str) -> Result<Embedding> {
        let executor = GPU_EXECUTOR
            .get()
            .ok_or_else(|| anyhow::anyhow!("GPU executor not initialized"))?;

        executor.embed(sequence.to_string()).await
    }

    async fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Embedding>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let executor = GPU_EXECUTOR
            .get()
            .ok_or_else(|| anyhow::anyhow!("GPU executor not initialized"))?;

        let texts: Vec<String> = texts.iter().map(|s| s.to_string()).collect();
        executor.batch_embed(texts).await
    }
}

// =============================================================================
// SUBPROCESS EMBEDDER — isolated process for crash resilience.
//
// Spawns the `orgii-embedder` bin (built from this same crate, see
// `src/bin/embedder.rs`) and talks to it over JSON-lines on stdio. If Metal
// crashes the subprocess, the main app survives and the embedder is
// restarted up to MAX_CRASHES times.
// =============================================================================

use crate::embedders::ipc::{Request as IpcRequest, Response as IpcResponse};

pub struct SubprocessEmbedder {
    child: std::sync::Mutex<Option<std::process::Child>>,
    stdin: std::sync::Mutex<Option<std::process::ChildStdin>>,
    stdout_rx: std::sync::Mutex<Option<std::sync::mpsc::Receiver<String>>>,
    model_dir: std::path::PathBuf,
    gpu_layers: u32,
    dimensions: std::sync::atomic::AtomicUsize,
    request_id: std::sync::atomic::AtomicU64,
    crash_count: std::sync::atomic::AtomicU32,
}

impl SubprocessEmbedder {
    const MAX_CRASHES: u32 = 5;

    /// Spawn the `orgii-embedder` subprocess and run the init handshake.
    ///
    /// `gpu_layers` is forwarded to the subprocess via the `ORGII_GPU_LAYERS`
    /// environment variable. Caller is responsible for resolving the
    /// preferred value (env override → user setting → default).
    pub fn new(model_dir: &Path, gpu_layers: u32) -> Result<Self> {
        let embedder = Self {
            child: std::sync::Mutex::new(None),
            stdin: std::sync::Mutex::new(None),
            stdout_rx: std::sync::Mutex::new(None),
            model_dir: model_dir.to_path_buf(),
            gpu_layers,
            dimensions: std::sync::atomic::AtomicUsize::new(768),
            request_id: std::sync::atomic::AtomicU64::new(1),
            crash_count: std::sync::atomic::AtomicU32::new(0),
        };

        embedder.spawn_process()?;
        Ok(embedder)
    }

    fn find_embedder_binary() -> Result<std::path::PathBuf> {
        if let Ok(exe) = std::env::current_exe() {
            let dir = exe.parent().unwrap_or(Path::new("."));
            let embedder = dir.join("orgii-embedder");
            if embedder.exists() {
                return Ok(embedder);
            }
        }

        #[cfg(unix)]
        let which_cmd = "which";
        #[cfg(windows)]
        let which_cmd = "where";

        if let Ok(output) = std::process::Command::new(which_cmd)
            .arg("orgii-embedder")
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = path.lines().next() {
                    return Ok(std::path::PathBuf::from(first_line.trim()));
                }
            }
        }

        anyhow::bail!("orgii-embedder binary not found")
    }

    fn spawn_process(&self) -> Result<()> {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let binary = Self::find_embedder_binary()?;
        println!("[Subprocess] Starting isolated embedder: {:?}", binary);

        let mut cmd = Command::new(&binary);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        cmd.env("ORGII_GPU_LAYERS", self.gpu_layers.to_string());

        let mut child = cmd
            .spawn()
            .map_err(|e| anyhow::anyhow!("Failed to spawn embedder: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to get stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to get stdout"))?;

        let (tx, rx) = std::sync::mpsc::channel::<String>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        *self.child.lock().unwrap() = Some(child);
        *self.stdin.lock().unwrap() = Some(stdin);
        *self.stdout_rx.lock().unwrap() = Some(rx);

        let id = self.next_id();
        self.send_request(&IpcRequest::Init {
            id,
            model_dir: self.model_dir.to_string_lossy().to_string(),
        })?;

        match self.recv_response(std::time::Duration::from_secs(60))? {
            IpcResponse::Ready {
                dimensions, mode, ..
            } => {
                self.dimensions
                    .store(dimensions, std::sync::atomic::Ordering::SeqCst);
                println!("[Subprocess] Embedder ready ({}, {}d)", mode, dimensions);
                Ok(())
            }
            IpcResponse::Error { message, .. } => {
                anyhow::bail!("Embedder init failed: {}", message)
            }
            other => {
                anyhow::bail!("Unexpected response: {:?}", other)
            }
        }
    }

    fn next_id(&self) -> u64 {
        self.request_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    fn send_request(&self, request: &IpcRequest) -> Result<()> {
        use std::io::Write;

        let mut stdin = self.stdin.lock().unwrap();
        if let Some(ref mut stdin) = *stdin {
            let json = serde_json::to_string(request)?;
            writeln!(stdin, "{}", json)?;
            stdin.flush()?;
            Ok(())
        } else {
            anyhow::bail!("Embedder stdin not available")
        }
    }

    fn recv_response(&self, timeout: std::time::Duration) -> Result<IpcResponse> {
        let rx = self.stdout_rx.lock().unwrap();
        if let Some(ref rx) = *rx {
            match rx.recv_timeout(timeout) {
                Ok(line) => {
                    let response: IpcResponse = serde_json::from_str(&line)?;
                    Ok(response)
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    anyhow::bail!("Embedder response timeout")
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    anyhow::bail!("Embedder process disconnected")
                }
            }
        } else {
            anyhow::bail!("Embedder stdout not available")
        }
    }

    fn is_alive(&self) -> bool {
        let mut child = self.child.lock().unwrap();
        if let Some(ref mut child) = *child {
            match child.try_wait() {
                Ok(Some(_)) => false,
                Ok(None) => true,
                Err(_) => false,
            }
        } else {
            false
        }
    }

    fn restart_after_crash(&self) -> Result<()> {
        let crashes = self
            .crash_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;

        if crashes > Self::MAX_CRASHES {
            anyhow::bail!(
                "Embedder crashed {} times, giving up. Set ORGII_GPU_LAYERS=0 for CPU mode.",
                crashes
            );
        }

        println!(
            "[Subprocess] Embedder crashed (attempt {}/{}), restarting...",
            crashes,
            Self::MAX_CRASHES
        );

        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        *self.stdin.lock().unwrap() = None;
        *self.stdout_rx.lock().unwrap() = None;

        std::thread::sleep(std::time::Duration::from_millis(100));

        self.spawn_process()
    }

    fn reset_crash_count(&self) {
        self.crash_count
            .store(0, std::sync::atomic::Ordering::SeqCst);
    }

    fn embed_with_recovery(&self, texts: Vec<String>) -> Result<Vec<Embedding>> {
        if !self.is_alive() {
            self.restart_after_crash()?;
        }

        let id = self.next_id();
        self.send_request(&IpcRequest::Embed {
            id,
            texts: texts.clone(),
        })?;

        match self.recv_response(std::time::Duration::from_secs(300)) {
            Ok(IpcResponse::Result { embeddings, .. }) => {
                self.reset_crash_count();
                Ok(embeddings)
            }
            Ok(IpcResponse::Error { message, .. }) => {
                anyhow::bail!("Embed error: {}", message)
            }
            Ok(other) => {
                anyhow::bail!("Unexpected response: {:?}", other)
            }
            Err(e) => {
                eprintln!("[Subprocess] Error: {}, attempting restart...", e);
                self.restart_after_crash()?;

                let id = self.next_id();
                self.send_request(&IpcRequest::Embed { id, texts })?;

                match self.recv_response(std::time::Duration::from_secs(300))? {
                    IpcResponse::Result { embeddings, .. } => {
                        self.reset_crash_count();
                        Ok(embeddings)
                    }
                    IpcResponse::Error { message, .. } => {
                        anyhow::bail!("Embed error after restart: {}", message)
                    }
                    other => anyhow::bail!("Unexpected response after restart: {:?}", other),
                }
            }
        }
    }
}

impl Drop for SubprocessEmbedder {
    fn drop(&mut self) {
        if let Ok(()) = self.send_request(&IpcRequest::Shutdown { id: 0 }) {
            let _ = self.recv_response(std::time::Duration::from_secs(1));
        }

        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[async_trait]
impl Embedder for SubprocessEmbedder {
    async fn embed(&self, sequence: &str) -> Result<Embedding> {
        let results = self.embed_with_recovery(vec![sequence.to_string()])?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("No embedding returned"))
    }

    async fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Embedding>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let texts: Vec<String> = texts.iter().map(|s| s.to_string()).collect();
        self.embed_with_recovery(texts)
    }
}
