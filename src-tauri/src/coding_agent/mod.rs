//! coding_agent — Coding-focused agent built on agent_core.
//!
//! A Rust-native coding agent with project-scoped context, tool execution,
//! and context compaction. Reuses the shared `agent_core` infrastructure
//! (providers, tools, processor, compaction) and `osagent` tool implementations.
//!
//! # Session Prefix
//!
//! All coding agent session IDs use the `codingagent-` prefix.

pub mod commands;
pub mod config;
pub mod context;
pub mod modes;
pub mod permission;
pub mod persistence;
pub mod processor;
pub mod question;
pub mod tools;

// Re-export Tauri commands so `lib.rs` can reference them as `coding_agent::coding_agent_create`.
pub use commands::*;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use serde::{Deserialize, Serialize};

use crate::agent_core::compaction::CompactionState;
use crate::agent_core::mcp::McpManager;
use crate::agent_core::providers::base::LLMProvider;
use crate::agent_core::tools::policy::ResolvedToolPolicy;
use crate::agent_core::tools::registry::ToolRegistry;

use self::config::CodingAgentConfig;
use self::permission::PermissionManager;
use self::question::QuestionManager;

/// Session ID prefix for coding agent sessions.
pub const SESSION_PREFIX: &str = "codingagent-";

// ============================================
// Per-Session Runtime
// ============================================

/// Resources initialized per coding-agent session.
///
/// Each session gets its own provider, tool registry, policy, and MCP
/// connections so that multiple sessions can run concurrently with
/// different models or projects.
pub(crate) struct SessionRuntime {
    pub provider: Arc<dyn LLMProvider>,
    pub tool_registry: Arc<ToolRegistry>,
    pub policy: Arc<ResolvedToolPolicy>,
    pub config: CodingAgentConfig,
    pub model: String,
    pub account_id: Option<String>,
    pub project_path: PathBuf,
    mcp_manager: Arc<McpManager>,
}

// ============================================
// Tauri State
// ============================================

/// Managed state for the coding_agent module.
///
/// Provider, tool registry, policy, and MCP connections are per-session
/// (stored in `session_runtimes`) so multiple sessions can run concurrently.
pub struct CodingAgentState {
    /// Per-session runtime resources (provider, registry, policy, config).
    pub(crate) session_runtimes: Arc<Mutex<HashMap<String, Arc<SessionRuntime>>>>,
    /// Per-session compaction state. Key = session_id.
    pub(crate) compaction_states: Arc<Mutex<HashMap<String, CompactionState>>>,
    /// Per-session permission managers. Key = session_id.
    pub(crate) permission_managers: Arc<Mutex<HashMap<String, Arc<PermissionManager>>>>,
    /// Per-session question managers. Key = session_id.
    pub(crate) question_managers: Arc<Mutex<HashMap<String, Arc<QuestionManager>>>>,
    /// Per-session cancellation flags. Key = session_id.
    pub(crate) cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Shared PTY sessions (from PtyState).
    pub(crate) pty_sessions: Option<
        Arc<
            tauri::async_runtime::Mutex<
                std::collections::HashMap<String, crate::terminal::pty::PtySession>,
            >,
        >,
    >,
    /// Tauri app handle.
    pub(crate) app_handle: Option<tauri::AppHandle>,
}

impl CodingAgentState {
    pub fn new() -> Self {
        Self {
            session_runtimes: Arc::new(Mutex::new(HashMap::new())),
            compaction_states: Arc::new(Mutex::new(HashMap::new())),
            permission_managers: Arc::new(Mutex::new(HashMap::new())),
            question_managers: Arc::new(Mutex::new(HashMap::new())),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            pty_sessions: None,
            app_handle: None,
        }
    }

    pub fn set_pty_sessions(
        &mut self,
        sessions: Arc<
            tauri::async_runtime::Mutex<
                std::collections::HashMap<String, crate::terminal::pty::PtySession>,
            >,
        >,
    ) {
        self.pty_sessions = Some(sessions);
    }

    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }
}

// ============================================
// Response Type
// ============================================

/// Response from the coding agent.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingAgentResponse {
    pub content: String,
    pub session_id: String,
    pub model: String,
}

// ============================================
// Initialization
// ============================================

/// Initialize a session's runtime (provider, tools, policy, MCP).
///
/// Returns the existing runtime if the session already has one with
/// matching model/account/project. Otherwise builds a new one.
///
/// Each session gets its own runtime so multiple sessions can run
/// concurrently with different models or projects.
pub(crate) async fn ensure_session_initialized(
    state: &CodingAgentState,
    session_id: &str,
    model: &str,
    account_id: Option<&str>,
    project_path: &std::path::Path,
) -> Result<Arc<SessionRuntime>, String> {
    // Fast path: session already has a matching runtime
    {
        let runtimes = state.session_runtimes.lock().await;
        if let Some(existing) = runtimes.get(session_id) {
            if existing.model == model
                && existing.account_id.as_deref() == account_id
                && existing.project_path == project_path
            {
                return Ok(Arc::clone(existing));
            }
        }
    }

    // Slow path: build a new runtime (lock is released so other sessions aren't blocked)
    info!(
        "[coding_agent] Initializing session {} (model={}, project={})",
        session_id,
        model,
        project_path.display()
    );

    let config = CodingAgentConfig::load_for_project(project_path);

    let provider = crate::osagent::providers::create_provider(model, account_id)
        .map_err(|err| format!("Failed to create LLM provider: {}", err))?;

    let question_manager = {
        let mut managers = state.question_managers.lock().await;
        managers
            .entry("__global__".to_string())
            .or_insert_with(|| Arc::new(QuestionManager::new()))
            .clone()
    };

    let disabled_set: HashSet<String> = config.disabled_tools.iter().cloned().collect();

    let mut tool_registry = tools::build_tool_registry(
        project_path,
        config.exec_timeout,
        state.pty_sessions.clone(),
        state.app_handle.clone(),
        Some(Arc::clone(&question_manager)),
        Some(&disabled_set),
        config.knowledge_graph.enabled,
    );

    // Per-session MCP connections
    let mcp_manager = Arc::new(McpManager::new());
    let mcp_errors = mcp_manager.connect_all(Some(project_path), true).await;
    for err in &mcp_errors {
        warn!("[coding_agent] MCP (session {}): {}", session_id, err);
    }
    let _ = crate::agent_core::mcp::register_mcp_tools(
        &mut tool_registry,
        &mcp_manager,
        Some(&disabled_set),
        None,
        Some(project_path),
        true,
    )
    .await;

    let policy_arc = Arc::new(ResolvedToolPolicy::build(&config.policy, None, None, false));

    let inner_registry = Arc::new(tools::build_tool_registry(
        project_path,
        config.exec_timeout,
        state.pty_sessions.clone(),
        state.app_handle.clone(),
        Some(question_manager),
        Some(&disabled_set),
        config.knowledge_graph.enabled,
    ));
    tool_registry.register(Box::new(tools::batch::BatchTool::new(
        Arc::clone(&inner_registry),
        Arc::clone(&policy_arc),
    )));

    let provider_arc: Arc<dyn LLMProvider> = Arc::from(provider);
    tool_registry.register(Box::new(tools::task::TaskTool::new(
        inner_registry,
        Arc::clone(&policy_arc),
        Arc::clone(&provider_arc),
        model.to_string(),
        config.max_tokens,
        config.temperature,
    )));

    let runtime = Arc::new(SessionRuntime {
        provider: provider_arc,
        tool_registry: Arc::new(tool_registry),
        policy: policy_arc,
        config,
        model: model.to_string(),
        account_id: account_id.map(|s| s.to_string()),
        project_path: project_path.to_path_buf(),
        mcp_manager,
    });

    // Insert into runtimes map (replaces stale runtime if config changed)
    {
        let mut runtimes = state.session_runtimes.lock().await;
        if let Some(old) = runtimes.insert(session_id.to_string(), Arc::clone(&runtime)) {
            let old_mcp = Arc::clone(&old.mcp_manager);
            tokio::spawn(async move {
                old_mcp.shutdown_all().await;
            });
        }
    }

    info!("[coding_agent] Session {} initialized successfully", session_id);
    Ok(runtime)
}

/// Remove a session's runtime and clean up its MCP connections.
pub(crate) async fn cleanup_session_runtime(state: &CodingAgentState, session_id: &str) {
    let runtime = {
        let mut runtimes = state.session_runtimes.lock().await;
        runtimes.remove(session_id)
    };
    if let Some(rt) = runtime {
        rt.mcp_manager.shutdown_all().await;
    }
}
