//! Individual LSP Server Process
//!
//! Manages a single language server process, handling:
//! - Process spawning and lifecycle
//! - stdin/stdout communication
//! - Request/response correlation
//! - Notification sending

use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex, RwLock};

use super::protocol::*;
use super::types::*;

/// Parse a stringly-typed URI into the `lsp_types::Uri` newtype.
///
/// Returns a `Result` rather than `unwrap`ing because the wire
/// surface (Tauri commands, agent-core query_lsp) hands us URIs that
/// originated from frontend / LLM input, so a malformed one is a
/// runtime error and not a programmer error.
pub(crate) fn parse_uri(input: &str) -> Result<Uri, String> {
    Uri::from_str(input).map_err(|err| format!("Invalid URI {:?}: {}", input, err))
}

/// Strip the `Content-Length: N\r\n\r\n` framing prefix from an
/// outbound message before pushing the body into the log buffer.
/// Returns the original input unchanged if the separator isn't found
/// (e.g. an unframed debug write) so the log still captures
/// something useful.
pub(crate) fn strip_framing_prefix(framed: &str) -> &str {
    framed
        .find("\r\n\r\n")
        .map(|idx| &framed[idx + 4..])
        .unwrap_or(framed)
}

/// Resolve the effective `TextDocumentSyncKind` for a capability set.
///
/// Phase 11 capability gating: if a server hasn't completed
/// `initialize` yet (so `caps` is `None`), we conservatively default
/// to `Full` — the server might be picky about ordering and we'd
/// rather send a redundant full document than skip a required change.
/// Once we've seen the real capabilities we honour whatever kind they
/// advertised, including `None` (the gate that lets `did_change`
/// short-circuit).
pub(crate) fn resolve_sync_kind(caps: Option<&ServerCapabilities>) -> TextDocumentSyncKind {
    match caps {
        Some(caps) => caps.text_document_sync_kind(),
        None => TextDocumentSyncKind::FULL,
    }
}

/// Time we give a server to respond to `initialize` before we abort
/// startup. Some servers (rust-analyzer cold-start on a fresh workspace,
/// pyright with a large monorepo) genuinely need 20–30s here, so we
/// pick a generous bound rather than the per-request default.
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);

/// Time we give a server to acknowledge `shutdown` before we send `exit`
/// and SIGTERM the process.
const SHUTDOWN_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Time we wait for the child to actually exit after SIGTERM before
/// escalating to SIGKILL.
const PROCESS_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

/// Maximum number of file URIs cached per LSP server. When the cache is
/// full and a new URI arrives, the oldest entry is evicted (FIFO order
/// approximating LRU on insertion). 500 is well above realistic editor
/// fan-out (a single workspace rarely has hundreds of distinct files
/// open at once) and bounds memory at roughly a few MB per server.
const MAX_DIAGNOSTIC_FILES: usize = 500;

/// Bounded diagnostics cache for `textDocument/publishDiagnostics`.
///
/// LSP servers continuously publish diagnostics as they re-analyse the
/// workspace, so an unbounded `HashMap` would grow without limit in
/// long-lived sessions. This wrapper keeps insertion order in a
/// `VecDeque` and evicts the oldest entry when the cap is hit.
///
/// Empty diagnostic arrays are NOT stored — when the server reports
/// "this file is now clean" we eagerly evict the entry instead, which
/// keeps the cache focused on files that actually have problems.
#[derive(Default)]
pub(crate) struct DiagnosticsCache {
    map: HashMap<String, PublishDiagnosticsParams>,
    order: VecDeque<String>,
}

impl DiagnosticsCache {
    /// Insert/replace diagnostics for a URI, evicting the oldest entry
    /// when over the cap. Empty diagnostics arrays cause eviction
    /// rather than insertion — once a file is "now clean" there's
    /// nothing useful to surface and keeping the URI around just
    /// pressures the bounded cap.
    pub fn upsert(&mut self, uri: String, params: PublishDiagnosticsParams) {
        if params.diagnostics.is_empty() {
            self.evict(&uri);
            return;
        }

        use std::collections::hash_map::Entry;
        if let Entry::Occupied(mut occupied) = self.map.entry(uri.clone()) {
            occupied.insert(params);
            return;
        }

        if self.map.len() >= MAX_DIAGNOSTIC_FILES {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }

        self.order.push_back(uri.clone());
        self.map.insert(uri, params);
    }

    /// Drop a single URI (called on `textDocument/didClose` and on
    /// "now clean" notifications).
    pub fn evict(&mut self, uri: &str) {
        if self.map.remove(uri).is_some() {
            if let Some(pos) = self.order.iter().position(|u| u == uri) {
                self.order.remove(pos);
            }
        }
    }

    pub fn snapshot(&self) -> HashMap<String, PublishDiagnosticsParams> {
        self.map.clone()
    }

    pub fn get(&self, uri: &str) -> Option<&PublishDiagnosticsParams> {
        self.map.get(uri)
    }
}

/// LSP Server instance managing a single language server process.
///
/// `process` and `stdin` are wrapped in `Option` so `shutdown` can `take()`
/// them and drive a clean async kill+wait sequence. `Drop` is a sync
/// best-effort fallback that only sends SIGKILL — the canonical cleanup
/// path is `LspServer::shutdown(self).await`, called by `LspManager`.
pub struct LspServer {
    /// Language identifier (e.g., "typescript", "python")
    language: String,

    /// Child process handle. `None` after `shutdown()` consumes it.
    process: Option<Child>,

    /// Stdin for sending requests/notifications. `None` after `shutdown()`
    /// drops the writer to flush EOF to the server.
    stdin: Arc<Mutex<Option<ChildStdin>>>,

    /// Stdout pipe — taken from the child in `new_with_binary` BEFORE
    /// `initialize` writes anything, then consumed by `start_listening`.
    /// Pre-taking matters: rust-analyzer / json-language-server serialize
    /// large schemas during initialize, and if the OS pipe fills before
    /// anyone is reading stdout, the server blocks on its first write
    /// and `initialize` hangs forever.
    stdout: Option<ChildStdout>,

    /// Stderr pipe — drained by a background task right after spawn so
    /// servers that log heavily on startup (gopls, pyright) don't fill
    /// their stderr pipe and block. The drained lines are also forwarded
    /// to `log::warn!` for diagnostics.
    stderr: Option<ChildStderr>,

    /// Monotonically-increasing JSON-RPC request ID. Atomic so we can
    /// allocate IDs without taking a lock — every outbound request hits
    /// this counter and contention here directly bounds throughput.
    next_request_id: Arc<AtomicU64>,

    /// Pending requests — maps request ID to a oneshot sender for the response.
    /// The stdout listener resolves these when a response with a matching ID arrives.
    /// On EOF (server crashed) the listener drains this map so awaiters get an
    /// immediate `Canceled` instead of waiting the per-request timeout.
    ///
    /// Uses `parking_lot::Mutex` (sync) rather than `tokio::sync::Mutex`
    /// because the critical sections are short HashMap mutations that
    /// never `.await` while holding the guard.
    pending_requests: Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,

    /// Bounded cache of diagnostics from `textDocument/publishDiagnostics`.
    /// Capped at `MAX_DIAGNOSTIC_FILES` URIs with FIFO eviction so the
    /// cache cannot grow unboundedly in long-lived sessions.
    diagnostics_cache: Arc<tokio::sync::RwLock<DiagnosticsCache>>,

    /// Server capabilities advertised in the `initialize` response.
    /// `None` until `initialize_with_options` succeeds. Wrapped in
    /// `RwLock` so the typical "every reader after init" path is
    /// lock-free with no writer contention.
    capabilities: Arc<RwLock<Option<ServerCapabilities>>>,

    /// Bounded ring buffer of recent stdio activity. Outbound writes,
    /// inbound JSON-RPC method tags, and stderr lines are pushed here
    /// for the `LanguageServersPage` log drawer to surface. See
    /// `crate::log_buffer` for the cap (`MAX_LOG_LINES = 500`) and
    /// per-line truncation rules.
    log_buffer: crate::log_buffer::LogBuffer,
}

impl LspServer {
    /// Create and spawn a new LSP server process
    pub fn new(
        language: &str,
        command: &str,
        args: Vec<&str>,
        root_path: &str,
    ) -> Result<Self, String> {
        Self::new_with_binary(
            language,
            &std::path::PathBuf::from(command),
            args.into_iter().map(String::from).collect(),
            root_path,
            HashMap::new(),
        )
    }

    /// Create and spawn a new LSP server process with explicit binary path and env vars.
    pub fn new_with_binary(
        language: &str,
        binary_path: &std::path::Path,
        args: Vec<String>,
        root_path: &str,
        env_vars: HashMap<String, String>,
    ) -> Result<Self, String> {
        let command_str = binary_path.to_string_lossy();
        log::info!(
            "[LSP] Spawning {} server: {} {:?}",
            language,
            command_str,
            args
        );
        log::info!("[LSP] Working directory: {}", root_path);

        let mut cmd = Command::new(binary_path);
        cmd.args(&args)
            .current_dir(root_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Add environment variables
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }

        // Suppress console window on Windows.
        #[cfg(windows)]
        cmd.creation_flags(app_platform::CREATE_NO_WINDOW);

        let mut process = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn {} LSP server: {}. Is {} installed?",
                language, e, command_str
            )
        })?;

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| "Failed to get stdin".to_string())?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "Failed to get stdout".to_string())?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| "Failed to get stderr".to_string())?;

        log::info!(
            "[LSP] Successfully spawned {} server (PID: {:?})",
            language,
            process.id()
        );

        Ok(Self {
            language: language.to_string(),
            process: Some(process),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            stdout: Some(stdout),
            stderr: Some(stderr),
            next_request_id: Arc::new(AtomicU64::new(1)),
            pending_requests: Arc::new(parking_lot::Mutex::new(HashMap::new())),
            diagnostics_cache: Arc::new(tokio::sync::RwLock::new(DiagnosticsCache::default())),
            capabilities: Arc::new(RwLock::new(None)),
            log_buffer: crate::log_buffer::LogBuffer::new(),
        })
    }

    /// Snapshot of the recent stdio ring buffer. Used by
    /// `lsp_get_server_log` and the agent-core `manage_lsp` tool to
    /// surface server activity in the UI.
    pub fn log_snapshot(&self) -> Vec<crate::log_buffer::LogLine> {
        self.log_buffer.snapshot()
    }

    /// Initialize the LSP server with the given initialization options
    /// and post-init workspace configuration.
    ///
    /// Both `init_options` and `workspace_config` come from the
    /// caller-resolved `ServerDef` (typically via
    /// `LspManager::start_server_with_def`). The LSP host itself is
    /// language-agnostic and does NOT inspect `self.language` here —
    /// any server-specific defaults belong on the `ServerDef` impl.
    ///
    /// On success, `result.capabilities` from the `initialize`
    /// response is parsed into `self.capabilities` so subsequent
    /// `hover` / `goto_definition` / `find_references` calls can
    /// fail fast when the feature is not advertised.
    pub async fn initialize_with_options(
        &self,
        root_path: &str,
        init_options: Option<serde_json::Value>,
        workspace_config: Option<serde_json::Value>,
    ) -> Result<(), String> {
        log::info!(
            "[LSP] Initializing {} server for workspace: {}",
            self.language,
            root_path
        );

        let final_init_options = init_options.unwrap_or_else(|| serde_json::json!({}));

        let params = serde_json::json!({
            "processId": std::process::id(),
            "rootPath": root_path,
            "rootUri": format!("file://{}", root_path),
            "capabilities": {
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": true,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "didSave": false
                    },
                    "completion": {
                        "dynamicRegistration": true,
                        "completionItem": {
                            "snippetSupport": false
                        }
                    },
                    "hover": { "dynamicRegistration": true },
                    "definition": { "dynamicRegistration": true },
                    "references": { "dynamicRegistration": true },
                    "documentSymbol": {
                        "dynamicRegistration": true,
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "documentHighlight": { "dynamicRegistration": true },
                    "publishDiagnostics": {
                        "relatedInformation": true
                    }
                },
                "workspace": {
                    "applyEdit": true,
                    "workspaceEdit": {
                        "documentChanges": true
                    },
                    "didChangeConfiguration": {
                        "dynamicRegistration": true
                    },
                    "didChangeWatchedFiles": {
                        "dynamicRegistration": true
                    },
                    "symbol": {
                        "dynamicRegistration": true
                    },
                    "configuration": true
                }
            },
            "initializationOptions": final_init_options,
            "workspaceFolders": [{
                "uri": format!("file://{}", root_path),
                "name": "workspace"
            }]
        });

        let (init_id, receiver) = self
            .send_request_with_response("initialize", Some(params))
            .await?;
        let init_result = match tokio::time::timeout(INITIALIZE_TIMEOUT, receiver).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => {
                return Err("initialize response channel closed".to_string());
            }
            Err(_) => {
                self.cancel_request(init_id).await;
                return Err(format!(
                    "initialize timed out after {:?} for {}",
                    INITIALIZE_TIMEOUT, self.language
                ));
            }
        };

        // Parse the full `InitializeResult` so future fields (server
        // info, offset encoding, …) become available with no extra
        // wire-walking. A malformed result is logged but not fatal —
        // we degrade to default capabilities rather than refusing to
        // start the server.
        let capabilities = match serde_json::from_value::<InitializeResult>(init_result) {
            Ok(parsed) => parsed.capabilities,
            Err(err) => {
                log::warn!(
                    "[LSP] {} returned unparseable InitializeResult ({}); \
                     falling back to default capabilities",
                    self.language,
                    err
                );
                ServerCapabilities::default()
            }
        };
        *self.capabilities.write().await = Some(capabilities);

        self.send_notification("initialized", Some(serde_json::json!({})))
            .await?;

        if let Some(settings) = workspace_config {
            self.send_notification(
                "workspace/didChangeConfiguration",
                Some(serde_json::json!({ "settings": settings })),
            )
            .await?;
        }

        log::info!("[LSP] {} server initialized successfully", self.language);
        Ok(())
    }

    /// Write a framed LSP message to stdin. Centralised so `Option<ChildStdin>`
    /// handling lives in exactly one place — every `send_*` path goes through
    /// this. Returns a clear error if stdin was already taken by `shutdown`.
    ///
    /// Also pushes the JSON-RPC body (without the `Content-Length`
    /// framing prefix) into the per-server log buffer so the
    /// `LanguageServersPage` log drawer can show what the host sent.
    async fn write_message(&self, message: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "LSP stdin closed (server is shutting down)".to_string())?;
        stdin
            .write_all(message.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;

        // Strip the LSP framing prefix before logging — the user
        // doesn't care about `Content-Length: N\r\n\r\n`. The codec
        // mirror (`crate::codec::LspCodec`) does the same on the
        // inbound side.
        let body = strip_framing_prefix(message);
        self.log_buffer.push(crate::log_buffer::IoKind::StdIn, body);

        Ok(())
    }

    /// Send a request and return a receiver for the response.
    ///
    /// The returned `(id, receiver)` pair lets callers send a
    /// `$/cancelRequest` notification with the matching id when their
    /// per-request timeout fires. The receiver resolves when the stdout
    /// listener receives a JSON-RPC response with the matching request
    /// ID, or is `Canceled` if the listener drains the pending map on
    /// EOF.
    pub async fn send_request_with_response(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(u64, oneshot::Receiver<serde_json::Value>), String> {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);

        let request = JsonRpcRequest::new(id, method.to_string(), params);

        let json = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;

        let message = format_lsp_message(&json);

        log::debug!("[LSP] Sending request {}: {}", id, method);

        // Register the oneshot before writing so a fast response can never
        // race ahead of the registration.
        let (sender, receiver) = oneshot::channel();
        self.pending_requests.lock().insert(id, sender);

        if let Err(err) = self.write_message(&message).await {
            self.pending_requests.lock().remove(&id);
            return Err(err);
        }

        Ok((id, receiver))
    }

    /// Best-effort `$/cancelRequest` for a previously-sent request.
    ///
    /// Called from per-request timeout sites so the server stops
    /// computing a response we'll never read. Also evicts the pending
    /// entry locally — the server's eventual response (if any) will
    /// hit a missing pending entry and be dropped by the listener.
    ///
    /// Errors writing the cancel message are logged at `debug` and
    /// otherwise swallowed: cancellation is advisory and the timeout
    /// error path must not be masked by a write failure.
    async fn cancel_request(&self, id: u64) {
        self.pending_requests.lock().remove(&id);
        if let Err(err) = self
            .send_notification("$/cancelRequest", Some(serde_json::json!({ "id": id })))
            .await
        {
            log::debug!(
                "[LSP] Failed to send $/cancelRequest for {} request {}: {}",
                self.language,
                id,
                err
            );
        }
    }

    /// Send a request (fire-and-forget, no awaitable response).
    /// Returns the request ID.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<u64, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);

        let request = JsonRpcRequest::new(id, method.to_string(), params);

        let json = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;

        let message = format_lsp_message(&json);

        log::debug!("[LSP] Sending request {}: {}", id, method);

        self.write_message(&message).await?;
        Ok(id)
    }

    /// Send a notification (no response expected)
    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let notification = JsonRpcNotification::new(method.to_string(), params);

        let json = serde_json::to_string(&notification)
            .map_err(|e| format!("Failed to serialize notification: {}", e))?;

        let message = format_lsp_message(&json);

        log::debug!("[LSP] Sending notification: {}", method);

        self.write_message(&message).await
    }

    /// Convenience wrapper that serializes a `lsp_types::*` payload via
    /// `serde_json::to_value` before forwarding to `send_notification`.
    /// Lets call sites stay typed without each one having to rebuild
    /// the JSON-RPC envelope.
    async fn send_typed_notification<P: serde::Serialize>(
        &self,
        method: &str,
        params: &P,
    ) -> Result<(), String> {
        let value = serde_json::to_value(params)
            .map_err(|err| format!("Failed to serialize {} params: {}", method, err))?;
        self.send_notification(method, Some(value)).await
    }

    /// Convenience wrapper that serializes a `lsp_types::*` payload via
    /// `serde_json::to_value` before forwarding to
    /// `send_request_with_response`. Returns the typed response (`R`)
    /// or a string error.
    ///
    /// `method` is `&'static str` to match `request_with_timeout`'s
    /// signature — every LSP method we send is a const string literal.
    async fn send_typed_request<P, R>(
        &self,
        method: &'static str,
        params: &P,
        timeout: Duration,
    ) -> Result<R, String>
    where
        P: serde::Serialize,
        R: serde::de::DeserializeOwned,
    {
        let value = serde_json::to_value(params)
            .map_err(|err| format!("Failed to serialize {} params: {}", method, err))?;
        let raw = self.request_with_timeout(method, value, timeout).await?;
        serde_json::from_value(raw)
            .map_err(|err| format!("Failed to deserialize {} response: {}", method, err))
    }

    /// Notify server that a document was opened.
    pub async fn did_open(
        &self,
        uri: &str,
        language_id: &str,
        version: i32,
        text: &str,
    ) -> Result<(), String> {
        let params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: parse_uri(uri)?,
                language_id: language_id.to_string(),
                version,
                text: text.to_string(),
            },
        };
        self.send_typed_notification("textDocument/didOpen", &params)
            .await
    }

    /// Notify server that a document changed by re-shipping the full
    /// document text.
    ///
    /// Capability-gated on the cached
    /// `ServerCapabilities.text_document_sync` resolved kind:
    ///
    /// * `Full` — send the single full-text change event.
    /// * `Incremental` — also send the full-text event. Per the LSP
    ///   spec, a server that advertises `Incremental` still accepts a
    ///   single change event with no `range`, treating it as a full
    ///   replacement (this is exactly how rust-analyzer / pyright
    ///   behave today). We don't ship per-keystroke ranges here
    ///   because no caller has a diff against the previous version —
    ///   agent-core's post-edit refresh and `LspTool::ensure_open`
    ///   both read the file from disk, and the frontend WebSocket
    ///   producer ships the full buffer too. A future incremental
    ///   wire path can be added when a change-set producer
    ///   materializes (CodeMirror integration); that would grow a new
    ///   arm here, not a parallel method, to keep the capability gate
    ///   authoritative.
    /// * `None` — server doesn't accept `didChange`; skip silently
    ///   with a debug log so editor refreshes don't spam errors at
    ///   servers that only sync on `didOpen`/`didClose` (rare, but
    ///   the spec allows it).
    pub async fn did_change(&self, uri: &str, version: i32, text: &str) -> Result<(), String> {
        let kind = self.resolved_sync_kind().await;
        if kind == TextDocumentSyncKind::NONE {
            log::debug!(
                "[LSP] {} skipping didChange (server advertised sync kind None) for {}",
                self.language,
                uri
            );
            return Ok(());
        }

        let params = DidChangeTextDocumentParams {
            text_document: VersionedTextDocumentIdentifier {
                uri: parse_uri(uri)?,
                version,
            },
            content_changes: vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: text.to_string(),
            }],
        };
        self.send_typed_notification("textDocument/didChange", &params)
            .await
    }

    /// Read the cached `text_document_sync` capability. Pre-init
    /// callers (no capabilities stored yet) get `Full` so the
    /// document still syncs — this matches the `require_capability`
    /// "degrade open" contract used by hover / definition / refs.
    ///
    /// We collapse `Full` and `Incremental` into "send the change
    /// notification" because today every caller has the full file
    /// content (no per-keystroke diff is available — agent-core's
    /// post-edit hook reads from disk, `LspTool::ensure_open` reads
    /// from disk, the frontend WebSocket producer ships full text).
    /// When a frontend producer that emits incremental ranges lands,
    /// this helper grows a third return value and `did_change` gains
    /// a new arm — see the LSP optimisation plan, Phase 11.
    async fn resolved_sync_kind(&self) -> TextDocumentSyncKind {
        resolve_sync_kind(self.capabilities.read().await.as_ref())
    }

    /// Notify server that a document was closed.
    ///
    /// Also evicts the file's cached diagnostics — once the editor has
    /// dropped the buffer there's no consumer for them, and keeping
    /// stale entries around just bloats the bounded cache.
    pub async fn did_close(&self, uri: &str) -> Result<(), String> {
        let params = DidCloseTextDocumentParams {
            text_document: TextDocumentIdentifier {
                uri: parse_uri(uri)?,
            },
        };
        let result = self
            .send_typed_notification("textDocument/didClose", &params)
            .await;

        self.diagnostics_cache.write().await.evict(uri);

        result
    }

    /// Get a read-only snapshot of all cached diagnostics.
    /// Returns a map of file URI → typed `PublishDiagnosticsParams`.
    pub async fn get_cached_diagnostics(&self) -> HashMap<String, PublishDiagnosticsParams> {
        self.diagnostics_cache.read().await.snapshot()
    }

    /// Get cached diagnostics for a single file URI.
    /// Returns the typed `Diagnostic` list, or empty if none cached.
    pub async fn get_file_diagnostics(&self, uri: &str) -> Vec<lsp_types::Diagnostic> {
        let cache = self.diagnostics_cache.read().await;
        cache
            .get(uri)
            .map(|params| params.diagnostics.clone())
            .unwrap_or_default()
    }

    /// Request textDocument/definition (go-to-definition).
    ///
    /// `Ok(None)` means the server replied but had no definition for the
    /// position (`null` result), which is distinct from an error.
    pub async fn goto_definition(
        &self,
        uri: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<GotoDefinitionResponse>, String> {
        self.require_capability(|c| c.supports_definition(), "definition")
            .await?;
        let params = GotoDefinitionParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: parse_uri(uri)?,
                },
                position: Position { line, character },
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };
        self.send_typed_request("textDocument/definition", &params, Duration::from_secs(10))
            .await
    }

    /// Request textDocument/references (find all references).
    ///
    /// `Ok(None)` means the server replied with `null`; `Ok(Some(vec))`
    /// is the (possibly empty) list of references.
    pub async fn find_references(
        &self,
        uri: &str,
        line: u32,
        character: u32,
        include_declaration: bool,
    ) -> Result<Option<Vec<Location>>, String> {
        self.require_capability(|c| c.supports_references(), "references")
            .await?;
        let params = ReferenceParams {
            text_document_position: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: parse_uri(uri)?,
                },
                position: Position { line, character },
            },
            context: ReferenceContext {
                include_declaration,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };
        self.send_typed_request("textDocument/references", &params, Duration::from_secs(15))
            .await
    }

    /// Request textDocument/hover (type/doc info at position).
    ///
    /// `Ok(None)` means no hover info at that position.
    pub async fn hover(
        &self,
        uri: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<Hover>, String> {
        self.require_capability(|c| c.supports_hover(), "hover")
            .await?;
        let params = HoverParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier {
                    uri: parse_uri(uri)?,
                },
                position: Position { line, character },
            },
            work_done_progress_params: Default::default(),
        };
        self.send_typed_request("textDocument/hover", &params, Duration::from_secs(10))
            .await
    }

    /// Request textDocument/documentSymbol for a synced file.
    pub async fn document_symbol(
        &self,
        uri: &str,
    ) -> Result<Option<DocumentSymbolResponse>, String> {
        self.require_capability(|c| c.supports_document_symbol(), "document symbols")
            .await?;
        let params = DocumentSymbolParams {
            text_document: TextDocumentIdentifier {
                uri: parse_uri(uri)?,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };
        self.send_typed_request(
            "textDocument/documentSymbol",
            &params,
            Duration::from_secs(15),
        )
        .await
    }

    /// Request workspace/symbol for the initialized workspace.
    pub async fn workspace_symbol(
        &self,
        query: &str,
    ) -> Result<Option<WorkspaceSymbolResponse>, String> {
        self.require_capability(|c| c.supports_workspace_symbol(), "workspace symbols")
            .await?;
        let params = WorkspaceSymbolParams {
            partial_result_params: Default::default(),
            work_done_progress_params: Default::default(),
            query: query.to_string(),
        };
        self.send_typed_request("workspace/symbol", &params, Duration::from_secs(15))
            .await
    }

    /// Send a request, await the response with a timeout, and emit
    /// `$/cancelRequest` if the timeout fires so the server stops
    /// computing a result no one will read. Pre-init (capabilities
    /// not yet stored) callers must skip this — `initialize` itself
    /// has its own bespoke timeout path.
    async fn request_with_timeout(
        &self,
        method: &'static str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        let (id, receiver) = self
            .send_request_with_response(method, Some(params))
            .await?;
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => Err(format!("{} response channel closed", method)),
            Err(_) => {
                self.cancel_request(id).await;
                Err(format!("{} timed out after {:?}", method, timeout))
            }
        }
    }

    /// Returns `Ok(())` if `predicate` holds on the cached
    /// `ServerCapabilities`. Returns `Err` if the capability is missing,
    /// so the caller can short-circuit before sending a request the
    /// server cannot answer.
    ///
    /// If `initialize` somehow ran without storing capabilities (e.g.
    /// a server returned a malformed `result`), we degrade open
    /// rather than refusing service — `request_with_timeout` will
    /// surface any `MethodNotFound` JSON-RPC error from the server.
    async fn require_capability<F>(&self, predicate: F, feature: &'static str) -> Result<(), String>
    where
        F: Fn(&ServerCapabilities) -> bool,
    {
        let guard = self.capabilities.read().await;
        match guard.as_ref() {
            Some(caps) if !predicate(caps) => Err(format!(
                "{} server does not advertise '{}' capability",
                self.language, feature
            )),
            _ => Ok(()),
        }
    }

    /// Start listening to stdout and emit diagnostic events.
    ///
    /// Consumes the pre-taken `self.stdout` (taken in `new_with_binary` to
    /// avoid pipe-fill deadlocks during `initialize`). Also spawns a
    /// background task to drain `self.stderr` into `log::warn!` so noisy
    /// servers (gopls, pyright) don't block on a full stderr pipe.
    pub fn start_listening(
        &mut self,
        _app_handle: tauri::AppHandle,
        language: String,
    ) -> Result<(), String> {
        let stdout = self
            .stdout
            .take()
            .ok_or_else(|| "LSP stdout already consumed".to_string())?;

        if let Some(stderr) = self.stderr.take() {
            let lang_for_stderr = language.clone();
            let stderr_log = self.log_buffer.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let trimmed = line.trim_end();
                            if !trimmed.is_empty() {
                                log::warn!("[LSP {} stderr] {}", lang_for_stderr, trimmed);
                                stderr_log.push(crate::log_buffer::IoKind::StdErr, trimmed);
                            }
                        }
                        Err(err) => {
                            log::debug!(
                                "[LSP] stderr drain for {} stopped: {}",
                                lang_for_stderr,
                                err
                            );
                            break;
                        }
                    }
                }
            });
        }

        log::info!("[LSP] Starting stdout listener for {} server", language);

        let cache = self.diagnostics_cache.clone();
        let pending = self.pending_requests.clone();
        let stdout_log = self.log_buffer.clone();

        // Spawn task to read stdout. We drive the LSP framing layer
        // through `tokio_util::codec::FramedRead<LspCodec>`, which
        // owns the read buffer and hands us one body's worth of bytes
        // at a time. The previous hand-rolled loop revalidated UTF-8
        // on every poll and did O(n) `buffer.drain(..consumed)` shifts;
        // the codec works on `BytesMut` slices directly and only
        // touches header bytes (always 7-bit ASCII).
        tokio::spawn(async move {
            use crate::codec::LspCodec;
            use futures::StreamExt;
            use tokio_util::codec::FramedRead;

            let mut framed = FramedRead::with_capacity(stdout, LspCodec::new(), 8 * 1024);

            while let Some(frame) = framed.next().await {
                let body = match frame {
                    Ok(body) => body,
                    Err(err) => {
                        // Codec errors are unrecoverable — a server
                        // emitting malformed framing means it's in a
                        // bad state. Log loudly and end the listener
                        // so `drain_pending_on_close` runs.
                        log::error!("[LSP] {} stdout framing error: {}", language, err);
                        break;
                    }
                };

                let value: serde_json::Value = match serde_json::from_slice(&body) {
                    Ok(value) => value,
                    Err(err) => {
                        log::warn!(
                            "[LSP] {} sent unparseable JSON-RPC message: {}",
                            language,
                            err
                        );
                        // Still log the raw bytes so the user can see
                        // what the server actually printed when it
                        // emitted unparseable JSON.
                        let lossy = String::from_utf8_lossy(&body).to_string();
                        stdout_log.push(crate::log_buffer::IoKind::StdOut, lossy);
                        continue;
                    }
                };

                // Push the parsed body into the log buffer. We use the
                // already-validated UTF-8 bytes from the codec rather
                // than re-serializing `value` so the log preserves
                // exactly what the server sent.
                let lossy_body = String::from_utf8_lossy(&body).to_string();
                stdout_log.push(crate::log_buffer::IoKind::StdOut, lossy_body);

                // Response correlation. A JSON-RPC response has `id`
                // and no `method`. We resolve the matching `oneshot`
                // sender; the sync `parking_lot::Mutex` critical
                // section is intentionally short (no `.await`).
                if let Some(id) = value.get("id").and_then(|v| v.as_u64()) {
                    if value.get("method").is_none() {
                        let removed = pending.lock().remove(&id);
                        if let Some(sender) = removed {
                            let result = value
                                .get("result")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);
                            let _ = sender.send(result);
                            log::debug!("[LSP] Resolved response for request {}", id);
                        }
                    }
                }

                // Notification dispatch. Today we only act on
                // `textDocument/publishDiagnostics`; everything else
                // (window/logMessage, $/progress, …) is ignored at
                // this layer.
                if let Some(method) = value.get("method").and_then(|m| m.as_str()) {
                    if method == "textDocument/publishDiagnostics" {
                        log::debug!("[LSP] Received publishDiagnostics for {}", language);

                        // Typed cache update — see Phase 9. Caching
                        // the typed payload means downstream readers
                        // (post-edit hook, query_lsp) never walk raw
                        // JSON.
                        if let Some(params_value) = value.get("params") {
                            match serde_json::from_value::<PublishDiagnosticsParams>(
                                params_value.clone(),
                            ) {
                                Ok(parsed) => {
                                    let uri_str = parsed.uri.to_string();
                                    let mut diag_cache = cache.write().await;
                                    diag_cache.upsert(uri_str, parsed);
                                }
                                Err(err) => {
                                    log::warn!(
                                        "[LSP] {} sent unparseable publishDiagnostics payload: {}",
                                        language,
                                        err
                                    );
                                }
                            }
                        }

                        // WebSocket fan-out keeps the raw JSON-RPC
                        // payload for the frontend, since the IDE
                        // renderer expects the full envelope.
                        let message = serde_json::json!({
                            "type": "lsp:diagnostics",
                            "language": language,
                            "data": value,
                            "timestamp": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis() as u64,
                        });
                        crate::broadcast::send(message.to_string());
                    }
                }
            }

            log::debug!("[LSP] {} server stdout closed", language);

            // Server stdout has ended (clean shutdown or crash). Drain any
            // pending requests so awaiters get an immediate `Canceled`
            // instead of waiting the full per-request timeout.
            drain_pending_on_close(&pending, &language).await;

            log::info!("[LSP] {} server stdout listener stopped", language);
        });

        Ok(())
    }

    /// Cleanly shut down the LSP server.
    ///
    /// This is the canonical cleanup path — call it from `LspManager::shutdown`
    /// and `stop_server_by_key`. The sequence is:
    ///   1. Send `shutdown` request and wait up to `SHUTDOWN_REQUEST_TIMEOUT`.
    ///   2. Send `exit` notification.
    ///   3. Drop stdin to flush EOF to the server.
    ///   4. SIGTERM via `start_kill`, then await the child for up to
    ///      `PROCESS_WAIT_TIMEOUT`.
    ///   5. If still alive, SIGKILL via `kill().await`.
    ///   6. Drain `pending_requests` so any racers get cancelled instead of
    ///      timing out.
    ///
    /// After this returns the child process is guaranteed to be reaped — no
    /// zombies, no leaked PIDs.
    pub async fn shutdown(mut self) {
        log::info!("[LSP] Shutting down {} server", self.language);

        // Best-effort `shutdown` request — many servers reject further work
        // after this and respond with `null`. Ignore the result; if the
        // server has already crashed the write will fail and we move on.
        if let Ok((_id, receiver)) = self.send_request_with_response("shutdown", None).await {
            let _ = tokio::time::timeout(SHUTDOWN_REQUEST_TIMEOUT, receiver).await;
        }

        // Tell the server to exit (notification, no response expected).
        let _ = self.send_notification("exit", None).await;

        // Drop stdin so the server sees EOF on its stdin and exits cleanly
        // even if it ignored our `exit` notification.
        {
            let mut guard = self.stdin.lock().await;
            *guard = None;
        }

        if let Some(mut process) = self.process.take() {
            // Queue SIGTERM (sync, returns immediately).
            if let Err(err) = process.start_kill() {
                log::warn!(
                    "[LSP] start_kill failed for {} server: {}",
                    self.language,
                    err
                );
            }

            // Reap the child within the wait timeout.
            match tokio::time::timeout(PROCESS_WAIT_TIMEOUT, process.wait()).await {
                Ok(Ok(status)) => {
                    log::info!(
                        "[LSP] {} server exited with status {:?}",
                        self.language,
                        status
                    );
                }
                Ok(Err(err)) => {
                    log::warn!("[LSP] Failed to wait for {} server: {}", self.language, err);
                }
                Err(_) => {
                    log::warn!(
                        "[LSP] {} server did not exit within {:?}, sending SIGKILL",
                        self.language,
                        PROCESS_WAIT_TIMEOUT
                    );
                    let _ = process.kill().await;
                }
            }
        }

        // Final drain in case the listener task hadn't yet observed EOF.
        drain_pending_on_close(&self.pending_requests, &self.language).await;
    }
}

/// Drain every pending request, dropping the senders so awaiters resolve
/// with `oneshot::error::RecvError` immediately instead of waiting for the
/// per-request timeout.
pub(crate) async fn drain_pending_on_close(
    pending: &Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    language: &str,
) {
    let mut guard = pending.lock();
    let count = guard.len();
    if count > 0 {
        log::info!(
            "[LSP] Cancelling {} in-flight {} request(s) due to server close",
            count,
            language
        );
        guard.clear();
    }
}

impl Drop for LspServer {
    fn drop(&mut self) {
        // Best-effort sync fallback for the case where the server is dropped
        // without going through `shutdown().await` (e.g. panic unwind). We
        // can only queue SIGKILL; we cannot await `wait()` here. The
        // canonical cleanup path is `LspServer::shutdown`.
        if let Some(process) = self.process.as_mut() {
            log::warn!(
                "[LSP] {} server dropped without shutdown(); sending SIGKILL fallback",
                self.language
            );
            let _ = process.start_kill();
        }
    }
}

// Pure-logic helper tests live in `tests/server_tests.rs` so they
// stay close to the rest of the crate's per-module test layout.
#[cfg(test)]
#[path = "tests/server_tests.rs"]
mod tests;

// `drain_pending_on_close` is exercised by the integration harness
// in `tests/server_integration_tests.rs`, which wires a stub child
// process via `tokio::io::duplex` to drive the EOF path without a
// real LSP binary on disk.
#[cfg(test)]
#[path = "tests/server_integration_tests.rs"]
mod integration_tests;
