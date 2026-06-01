//! LSP Manager
//!
//! Manages multiple language server processes keyed by `(root, server_id)`.
//! Today every caller (agent-core's `query_lsp` / `manage_lsp` tools, the
//! post-edit hook, the Tauri `lsp_start_server` command) passes a single
//! workspace root per session, so in practice the manager runs at most
//! one process per `(language, root)` pair. The map is keyed on `ServerKey`
//! to leave room for multi-root workspaces, but no producer attaches a
//! second root today — when one lands (frontend workspace-folders UI), it
//! will need:
//!
//! 1. capability-detection of `workspace.workspaceFolders.supported`,
//! 2. an `add_workspace_folder` / `remove_workspace_folder` path that
//!    re-uses an existing `LspServer` instead of spawning a new one,
//! 3. a `workspace/didChangeWorkspaceFolders` notification.
//!
//! Provides:
//! - On-demand spawning with deduplication (a single critical section
//!   on `spawning` covers the running / broken / spawning checks so two
//!   concurrent callers can never both insert primary spawners).
//! - Automatic server selection based on language ID via
//!   `find_server_for_language`.
//! - Broken-server cooldown tracking (5 min).
//!
//! Public API surface is language-keyed (`start_server`, `did_open`,
//! `goto_definition`, …) — these resolve the first running server
//! matching the requested language and delegate.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, RwLock};

use super::config::{get_server_override, is_server_enabled};
use super::server::LspServer;
use super::server_defs::{server_by_id, servers_for_language_id, ServerDef};
use super::types::{Diagnostic, GotoDefinitionResponse, Hover, Location, PublishDiagnosticsParams};

/// Composite key for identifying a running server instance.
/// A server is uniquely identified by its root directory and server ID.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ServerKey {
    /// The workspace/workspace root this server is initialized with
    pub root: PathBuf,
    /// The server definition ID (e.g., "typescript", "rust", "python")
    pub server_id: String,
}

impl ServerKey {
    pub fn new(root: impl Into<PathBuf>, server_id: impl Into<String>) -> Self {
        Self {
            root: root.into(),
            server_id: server_id.into(),
        }
    }
}

/// Information about a broken server for cooldown tracking.
#[derive(Debug, Clone)]
struct BrokenInfo {
    /// When the server was marked broken
    broken_at: Instant,
    /// Error message from the failure
    error: String,
}

/// Cooldown period before retrying a broken server (5 minutes).
const BROKEN_COOLDOWN: Duration = Duration::from_secs(300);

/// Pending spawn waiters per server key.
type SpawningMap = HashMap<ServerKey, Vec<oneshot::Sender<Result<(), String>>>>;

/// Manager for multiple LSP servers keyed by (root, server_id).
pub struct LspManager {
    /// Running servers keyed by (root, server_id)
    servers: Arc<RwLock<HashMap<ServerKey, LspServer>>>,

    /// Servers that are currently being spawned (deduplication)
    spawning: Arc<RwLock<SpawningMap>>,

    /// Servers that failed to start and their cooldown info
    broken: Arc<RwLock<HashMap<ServerKey, BrokenInfo>>>,
}

impl LspManager {
    /// Create a new LSP manager
    pub fn new() -> Self {
        log::info!("[LSP Manager] Initializing");
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            spawning: Arc::new(RwLock::new(HashMap::new())),
            broken: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start a server using a ServerDef.
    ///
    /// The "already running", "broken cooldown", and "already spawning"
    /// checks are folded into a single critical section on `self.spawning`
    /// so two concurrent callers can never both pass the running check and
    /// both insert primary spawners (TOCTOU). Whichever caller wins the
    /// `entry()` race becomes the primary; everyone else attaches a
    /// oneshot waiter and awaits the primary's result.
    async fn start_server_with_def(
        &self,
        key: &ServerKey,
        server_def: &dyn ServerDef,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        // Check if server is disabled in config (no shared state, cheap).
        if !is_server_enabled(&key.server_id).await {
            return Err(format!("Server {} is disabled in config", key.server_id));
        }

        // Single atomic critical section: running? broken? spawning?
        {
            let mut spawning = self.spawning.write().await;

            // 1. Already running — short-circuit.
            {
                let servers = self.servers.read().await;
                if servers.contains_key(key) {
                    log::debug!(
                        "[LSP Manager] Server {} at {:?} already running",
                        key.server_id,
                        key.root
                    );
                    return Ok(());
                }
            }

            // 2. In cooldown from a previous failure.
            {
                let broken = self.broken.read().await;
                if let Some(info) = broken.get(key) {
                    if info.broken_at.elapsed() < BROKEN_COOLDOWN {
                        return Err(format!(
                            "Server {} is in cooldown (failed {} ago): {}",
                            key.server_id,
                            humanize_duration(info.broken_at.elapsed()),
                            info.error
                        ));
                    }
                }
            }

            // 3. Spawn dedup. If a waiters vec already exists, attach.
            //    Otherwise we are the primary spawner.
            if let Some(waiters) = spawning.get_mut(key) {
                let (tx, rx) = oneshot::channel();
                waiters.push(tx);
                drop(spawning);
                return rx.await.map_err(|_| "Spawn cancelled".to_string())?;
            }

            spawning.insert(key.clone(), Vec::new());
        }

        // Outside the critical section: actually spawn. We always remove
        // our entry from `spawning` and notify waiters, even on early-return.
        let result = self.do_spawn_server(key, server_def, app_handle).await;

        let waiters = {
            let mut spawning = self.spawning.write().await;
            spawning.remove(key).unwrap_or_default()
        };

        for tx in waiters {
            let _ = tx.send(result.clone());
        }

        result
    }

    /// Actually spawn a server (called after deduplication checks).
    async fn do_spawn_server(
        &self,
        key: &ServerKey,
        server_def: &dyn ServerDef,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        log::info!(
            "[LSP Manager] Starting {} server at {:?}",
            key.server_id,
            key.root
        );

        // Get binary path (with potential auto-install)
        let binary_path = self.resolve_binary(server_def).await?;

        // Get command args
        let args: Vec<String> = server_def
            .command_args()
            .iter()
            .map(|s| s.to_string())
            .collect();

        // Get any config overrides
        let override_config = get_server_override(&key.server_id).await;
        let final_args = override_config
            .as_ref()
            .and_then(|o| o.args.clone())
            .unwrap_or(args);

        // Get env vars
        let mut env_vars: HashMap<String, String> = server_def
            .env_vars()
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();

        if let Some(ref config) = override_config {
            env_vars.extend(config.env.clone());
        }

        // Create and initialize server
        let root_str = key.root.to_string_lossy().to_string();

        let mut server = match LspServer::new_with_binary(
            &key.server_id,
            &binary_path,
            final_args,
            &root_str,
            env_vars,
        ) {
            Ok(server) => server,
            Err(err) => {
                self.mark_broken(key, &err).await;
                return Err(err);
            }
        };

        // Spawn the stdout reader BEFORE sending `initialize`. The
        // reader is what resolves the `oneshot::Receiver` returned by
        // `send_request_with_response`; if `initialize` is sent first,
        // its response sits in the OS pipe with no consumer and the
        // 60s timeout always fires (the cooldown error users see as
        // "initialize timed out after 60s for typescript").
        if let Err(err) = server.start_listening(app_handle.clone(), key.server_id.clone()) {
            self.mark_broken(key, &err).await;
            server.shutdown().await;
            return Err(err);
        }

        let init_options = server_def.initialization_options(&key.root);
        let workspace_config = server_def.workspace_configuration(&key.root);

        if let Err(err) = server
            .initialize_with_options(&root_str, init_options, workspace_config)
            .await
        {
            self.mark_broken(key, &err).await;
            // The server we just spawned hasn't been published into
            // `self.servers` yet, so reap its child here instead of
            // leaving cleanup to the (sync) Drop impl.
            server.shutdown().await;
            return Err(err);
        }

        // Store the server
        {
            let mut servers = self.servers.write().await;
            servers.insert(key.clone(), server);
        }

        // Clear from broken if it was there
        {
            let mut broken = self.broken.write().await;
            broken.remove(key);
        }

        log::info!(
            "[LSP Manager] Started {} server at {:?}",
            key.server_id,
            key.root
        );

        Ok(())
    }

    /// Resolve the binary path for a server definition.
    async fn resolve_binary(&self, server_def: &dyn ServerDef) -> Result<PathBuf, String> {
        let binary_name = server_def.binary_name();

        // Check for config override
        if let Some(config) = get_server_override(server_def.id()).await {
            if let Some(ref custom_path) = config.binary_path {
                let path = PathBuf::from(custom_path);
                if path.exists() {
                    return Ok(path);
                }
                return Err(format!(
                    "Custom binary path does not exist: {}",
                    custom_path
                ));
            }
        }

        // Try to find on PATH or in lsp-bin
        if let Some(path) = super::find_binary(binary_name) {
            return Ok(path);
        }

        // Try auto-install if enabled
        if super::config::is_auto_install_enabled().await {
            let install_method = server_def.install_method();
            match super::ensure_binary(&install_method, binary_name).await {
                Ok(path) => return Ok(path),
                Err(e) => {
                    log::warn!(
                        "[LSP Manager] Auto-install failed for {}: {}",
                        binary_name,
                        e
                    );
                }
            }
        }

        Err(format!(
            "Binary '{}' not found. Install with: {}",
            binary_name,
            server_def.install_hint()
        ))
    }

    /// Mark a server as broken (failed to start).
    ///
    /// Inline await — must complete before the caller returns the error to
    /// its waiters, otherwise a concurrent retry can race the broken-cooldown
    /// check and re-spawn the same failing process.
    async fn mark_broken(&self, key: &ServerKey, error: &str) {
        let mut guard = self.broken.write().await;
        guard.insert(
            key.clone(),
            BrokenInfo {
                broken_at: Instant::now(),
                error: error.to_string(),
            },
        );
    }

    /// Clear the broken-cooldown entry for every server matching
    /// `server_id` (any root). Used by the user-facing "Retry" / revive
    /// action so a transient init failure doesn't make the server
    /// unreachable for the full 5-minute cooldown.
    ///
    /// Returns the number of entries cleared. A zero return is not an
    /// error — it simply means the server was not in cooldown.
    pub async fn revive_server(&self, server_id: &str) -> usize {
        let mut guard = self.broken.write().await;
        let before = guard.len();
        guard.retain(|key, _| key.server_id != server_id);
        before - guard.len()
    }

    /// Clear every broken-cooldown entry. Used by "Revive all" and on
    /// app focus / network-recovery hooks.
    pub async fn revive_all(&self) -> usize {
        let mut guard = self.broken.write().await;
        let cleared = guard.len();
        guard.clear();
        cleared
    }

    /// Snapshot of currently-broken servers for diagnostic surfaces
    /// (Language Servers page, Problems panel). Each entry is
    /// `(server_id, error_message, seconds_in_cooldown)`. Servers
    /// whose cooldown has already expired are filtered out so callers
    /// don't have to know the `BROKEN_COOLDOWN` constant.
    pub async fn broken_snapshot(&self) -> Vec<(String, String, u64)> {
        let guard = self.broken.read().await;
        guard
            .iter()
            .filter(|(_, info)| info.broken_at.elapsed() < BROKEN_COOLDOWN)
            .map(|(key, info)| {
                (
                    key.server_id.clone(),
                    info.error.clone(),
                    info.broken_at.elapsed().as_secs(),
                )
            })
            .collect()
    }

    /// Debug-only: seed an entry into the broken-cooldown map without
    /// going through a real spawn-failure. Used by E2E tests to assert
    /// the cooldown consumer (the `BROKEN_COOLDOWN` short-circuit in
    /// `start_server_with_def`) honours its own map. The production
    /// `mark_broken` is private and only reachable via real
    /// `LspServer::new_with_binary` / `initialize` failures, neither of
    /// which is straightforward to provoke deterministically without a
    /// real LSP binary that crashes on init.
    #[cfg(debug_assertions)]
    pub async fn seed_broken_for_test(&self, key: ServerKey, error: String) {
        let mut guard = self.broken.write().await;
        guard.insert(
            key,
            BrokenInfo {
                broken_at: Instant::now(),
                error,
            },
        );
    }

    /// Start an LSP server for a specific language at the given root.
    pub async fn start_server(
        &self,
        language: &str,
        root_path: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        let base_lang = get_base_language(language);

        // Find server definition
        let servers = servers_for_language_id(base_lang);
        let server_def = servers
            .first()
            .ok_or_else(|| format!("No LSP server available for language: {}", language))?;

        let root = PathBuf::from(root_path);
        let key = ServerKey::new(root, server_def.id());

        self.start_server_with_def(&key, *server_def, app_handle)
            .await
    }

    /// Get the install hint for a language server.
    pub fn get_install_hint(language: &str) -> Option<String> {
        let base_lang = get_base_language(language);
        servers_for_language_id(base_lang)
            .first()
            .map(|s| s.install_hint())
    }

    /// Find a running server for a language.
    async fn find_server_for_language(&self, language: &str) -> Option<ServerKey> {
        let base_lang = get_base_language(language);
        let servers = self.servers.read().await;

        // Find first server that matches the language
        for key in servers.keys() {
            if key.server_id == base_lang {
                return Some(key.clone());
            }
            // Also check if server handles this language
            if let Some(def) = server_by_id(&key.server_id) {
                if def.language_ids().contains(&base_lang) {
                    return Some(key.clone());
                }
            }
        }

        None
    }

    /// Notify server that a document was opened.
    pub async fn did_open(
        &self,
        language: &str,
        uri: &str,
        version: i32,
        text: &str,
    ) -> Result<(), String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server.did_open(uri, language, version, text).await
    }

    /// Notify server that a document changed by re-shipping the full
    /// document text. Capability-gated on the server's
    /// `text_document_sync.change` — see `LspServer::did_change`.
    pub async fn did_change(
        &self,
        language: &str,
        uri: &str,
        version: i32,
        text: &str,
    ) -> Result<(), String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server.did_change(uri, version, text).await
    }

    /// Notify server that a document was closed.
    pub async fn did_close(&self, language: &str, uri: &str) -> Result<(), String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server.did_close(uri).await
    }

    /// Shutdown all LSP servers, draining each through `LspServer::shutdown`
    /// so child processes are reaped instead of leaked as zombies.
    pub async fn shutdown(&self) -> Result<(), String> {
        log::info!("[LSP Manager] Shutting down all servers");
        let drained: Vec<(ServerKey, LspServer)> = {
            let mut servers = self.servers.write().await;
            servers.drain().collect()
        };

        let count = drained.len();
        let futures = drained.into_iter().map(|(key, server)| async move {
            log::debug!(
                "[LSP Manager] Awaiting shutdown for {} at {:?}",
                key.server_id,
                key.root
            );
            server.shutdown().await;
        });

        futures::future::join_all(futures).await;
        log::info!("[LSP Manager] Shut down {} server(s)", count);
        Ok(())
    }

    /// Check if a server is running for a language.
    pub async fn is_server_running(&self, language: &str) -> bool {
        self.find_server_for_language(language).await.is_some()
    }

    /// Get list of running servers (server IDs / language names).
    /// Used by the agent-core `manage_lsp` tool to enumerate which
    /// language servers are currently up.
    pub async fn get_running_servers(&self) -> Vec<String> {
        let servers = self.servers.read().await;
        servers.keys().map(|k| k.server_id.clone()).collect()
    }

    /// Get cached diagnostics from a running LSP server.
    pub async fn get_cached_diagnostics(
        &self,
        language: &str,
    ) -> Result<HashMap<String, PublishDiagnosticsParams>, String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        Ok(server.get_cached_diagnostics().await)
    }

    /// Snapshot the per-server stdio log buffer for a running server.
    /// Used by the `lsp_get_server_log` Tauri command + the
    /// `LanguageServersPage` log drawer to surface what a server has
    /// been doing recently (helpful for diagnosing rust-analyzer OOMs,
    /// pyright panics, etc.). Returns an empty `Vec` if no server is
    /// running for the language — the caller treats "no server" as
    /// "no log to show" rather than an error, so the drawer can be
    /// opened on inactive rows without an exception.
    pub async fn get_server_log(&self, language: &str) -> Vec<crate::log_buffer::LogLine> {
        let Some(key) = self.find_server_for_language(language).await else {
            return Vec::new();
        };
        let servers = self.servers.read().await;
        match servers.get(&key) {
            Some(server) => server.log_snapshot(),
            None => Vec::new(),
        }
    }

    /// Get cached diagnostics for a single file.
    pub async fn get_file_diagnostics(
        &self,
        language: &str,
        uri: &str,
    ) -> Result<Vec<Diagnostic>, String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        Ok(server.get_file_diagnostics(uri).await)
    }

    /// Go to definition at a position in a file.
    pub async fn goto_definition(
        &self,
        language: &str,
        uri: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<GotoDefinitionResponse>, String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server.goto_definition(uri, line, character).await
    }

    /// Find all references to a symbol at a position.
    pub async fn find_references(
        &self,
        language: &str,
        uri: &str,
        line: u32,
        character: u32,
        include_declaration: bool,
    ) -> Result<Option<Vec<Location>>, String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server
            .find_references(uri, line, character, include_declaration)
            .await
    }

    /// Get hover information (type/docs) at a position.
    pub async fn hover(
        &self,
        language: &str,
        uri: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<Hover>, String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let servers = self.servers.read().await;
        let server = servers
            .get(&key)
            .ok_or_else(|| format!("Server not found: {:?}", key))?;

        server.hover(uri, line, character).await
    }

    /// Stop a specific LSP server (resolves first running server for the language).
    pub async fn stop_server(&self, language: &str) -> Result<(), String> {
        let key = self
            .find_server_for_language(language)
            .await
            .ok_or_else(|| format!("No LSP server running for language: {}", language))?;

        let server = {
            let mut servers = self.servers.write().await;
            servers.remove(&key)
        };

        if let Some(server) = server {
            server.shutdown().await;
            log::info!("[LSP Manager] Stopped {} server", language);
            Ok(())
        } else {
            Err(format!("No LSP server running for language: {}", language))
        }
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Normalize language to base language for server lookup.
/// typescript and typescriptreact share the same server.
fn get_base_language(language: &str) -> &str {
    match language {
        "typescriptreact" | "typescript" => "typescript",
        "javascriptreact" | "javascript" => "javascript",
        _ => language,
    }
}

/// Resolve the `ServerKey` that `start_server(language, root)` would
/// construct without actually starting anything. Used by E2E debug
/// endpoints to derive a key consistent with the production lookup
/// path (so a `seed_broken` call lands at the same map slot the next
/// `start_server` will read).
pub fn server_key_for_language(language: &str, root_path: &str) -> Option<ServerKey> {
    let base_lang = get_base_language(language);
    let server_def = servers_for_language_id(base_lang).first().copied()?;
    Some(ServerKey::new(PathBuf::from(root_path), server_def.id()))
}

/// Format a duration for human display
fn humanize_duration(d: Duration) -> String {
    let secs = d.as_secs();
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else {
        format!("{}h", secs / 3600)
    }
}

#[cfg(test)]
#[path = "tests/manager_tests.rs"]
mod tests;
