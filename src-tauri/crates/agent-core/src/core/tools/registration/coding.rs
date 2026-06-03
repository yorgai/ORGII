//! Coding tool registration: file I/O, exec, search, edit, patch, LSP, etc.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::tools::impls::coding::{
    action_router::ActionRouter,
    apply_patch::ApplyPatchTool,
    code_search::SearchTool,
    edit_file::EditTool,
    exec::{await_tool::AwaitTool, ExecTool},
    files::{DeleteFileTool, ListDirTool, ReadFileTool},
    inspect_terminals::InspectTerminalsTool,
    manage_file_history::ManageFileHistoryTool,
    manage_lsp::ManageLspTool,
    manage_todo::{TodoSessionContext, TodoTool},
    manage_workspace::ManageWorkspaceTool,
    query_lsp::LspTool,
    render_inline_canvas::RenderInlineCanvasTool,
    setup_repo::RepoSetupTool,
    terminal_log::resolve_logs_root,
    worktree::WorktreeTool,
};
use crate::tools::registry::ToolRegistry;
use tauri::Manager;

use super::{register_if_enabled, ToolDeps};

/// Register all coding-category tools that `deps` can support.
///
/// Covers: `read_file`, `list_dir`, `delete_file`, `exec`, `search`,
/// `manage_workspace`, `edit_file`, `apply_patch`, `query_lsp`,
/// `manage_lsp`, `todo`, `repo_setup`, `work_item`.
pub fn register(registry: &mut ToolRegistry, deps: &ToolDeps, disabled: &HashSet<String>) {
    // Snapshot the current `working_dir()` once for tools that still pin
    // a launch-time cwd. File tools and the worktree mutator take `workspace`
    // as an `Arc` clone so mid-session workspace updates are visible without
    // rebuilding the registry.
    let working_dir: PathBuf = deps.workspace.read().working_dir().to_path_buf();

    let allowed_dir = if deps.restrict_to_workspace {
        Some(working_dir.clone())
    } else {
        None
    };

    let make_router = || -> Option<ActionRouter> {
        deps.action_bridge
            .as_ref()
            .map(|bridge| ActionRouter::new(Arc::clone(bridge), deps.execution_mode))
    };

    // Resolve terminal logs root directory for file-backed process logs.
    // Priority: app_data_dir > workspace/.orgii/terminals/
    let terminal_logs_root = deps.app_handle.as_ref().and_then(|handle| {
        handle
            .path()
            .app_data_dir()
            .ok()
            .map(|app_data| resolve_logs_root(Some(&app_data), &working_dir))
    });

    // ── File tools ──
    let mut read = ReadFileTool::new(allowed_dir.clone());
    if let Some(ref scratch) = deps.scratchpad_dir {
        read = read.with_scratchpad(scratch.clone());
    }
    for directory in &deps.readonly_extra_dirs {
        read = read.with_readonly_extra_dir(directory.clone());
    }
    read = read.with_workspace_state(Arc::clone(&deps.workspace));
    if let Some(router) = make_router() {
        read = read.with_router(router);
    }
    register_if_enabled(registry, Box::new(read), disabled);

    let mut list_dir = ListDirTool::new(allowed_dir);
    if let Some(ref scratch) = deps.scratchpad_dir {
        list_dir = list_dir.with_scratchpad(scratch.clone());
    }
    list_dir = list_dir.with_workspace_state(Arc::clone(&deps.workspace));
    if let Some(router) = make_router() {
        list_dir = list_dir.with_router(router);
    }
    register_if_enabled(registry, Box::new(list_dir), disabled);

    // ── Exec tool ──
    if let (Some(ref pty), Some(ref handle)) = (&deps.pty_sessions, &deps.app_handle) {
        let mut exec = ExecTool::new_with_pty(
            working_dir.clone(),
            deps.exec_timeout,
            deps.restrict_to_workspace,
            pty.clone(),
            handle.clone(),
        );
        exec = exec.with_workspace_state(Arc::clone(&deps.workspace));
        if let Some(ref logs_root) = terminal_logs_root {
            exec = exec.with_terminal_logs_root(logs_root.clone());
        }
        if let Some(ref policy) = deps.security_policy {
            exec = exec.with_security_policy(Arc::clone(policy));
        }
        if let Some(router) = make_router() {
            exec = exec.with_router(router);
        }
        register_if_enabled(registry, Box::new(exec), disabled);
    } else {
        let mut exec = ExecTool::new(
            working_dir.clone(),
            deps.exec_timeout,
            deps.restrict_to_workspace,
        );
        exec = exec.with_workspace_state(Arc::clone(&deps.workspace));
        if let Some(ref logs_root) = terminal_logs_root {
            exec = exec.with_terminal_logs_root(logs_root.clone());
        }
        if let Some(ref policy) = deps.security_policy {
            exec = exec.with_security_policy(Arc::clone(policy));
        }
        if let Some(router) = make_router() {
            exec = exec.with_router(router);
        }
        register_if_enabled(registry, Box::new(exec), disabled);
    }

    // ── Await output (monitors backgrounded processes) ──
    register_if_enabled(registry, Box::new(AwaitTool::new()), disabled);

    // ── Terminal inspection ──
    if let Some(ref pty_sessions) = deps.pty_sessions {
        register_if_enabled(
            registry,
            Box::new(InspectTerminalsTool::new(pty_sessions.clone())),
            disabled,
        );
    }

    // ── Search ──
    let mut search =
        SearchTool::new(working_dir.clone()).with_workspace_state(Arc::clone(&deps.workspace));
    if let Some(router) = make_router() {
        search = search.with_router(router);
    }
    register_if_enabled(registry, Box::new(search), disabled);

    // ── Workspace management (list / add / remove) ──
    register_if_enabled(registry, Box::new(ManageWorkspaceTool::new()), disabled);

    // ── Edit (fuzzy replace) ──
    let mut edit = EditTool::new().with_workspace(working_dir.clone());
    if let Some(ref scratch) = deps.scratchpad_dir {
        edit = edit.with_scratchpad(scratch.clone());
    }
    edit = edit.with_workspace_state(Arc::clone(&deps.workspace));
    register_if_enabled(registry, Box::new(edit), disabled);

    // ── Delete file ──
    let mut delete_file = DeleteFileTool::new(if deps.restrict_to_workspace {
        Some(working_dir.clone())
    } else {
        None
    });
    if let Some(ref scratch) = deps.scratchpad_dir {
        delete_file = delete_file.with_scratchpad(scratch.clone());
    }
    delete_file = delete_file.with_workspace_state(Arc::clone(&deps.workspace));
    if let Some(router) = make_router() {
        delete_file = delete_file.with_router(router);
    }
    register_if_enabled(registry, Box::new(delete_file), disabled);

    // ── Apply patch ──
    register_if_enabled(
        registry,
        Box::new(
            ApplyPatchTool::new(working_dir.clone())
                .with_workspace_state(Arc::clone(&deps.workspace)),
        ),
        disabled,
    );

    // ── LSP ──
    if let Some(ref handle) = deps.app_handle {
        if let Some(lsp_state) = handle.try_state::<lsp::LspManagerState>() {
            register_if_enabled(
                registry,
                Box::new(LspTool::new(
                    lsp_state.inner().clone(),
                    handle.clone(),
                    working_dir.clone(),
                )),
                disabled,
            );
            register_if_enabled(
                registry,
                Box::new(ManageLspTool::new(
                    lsp_state.inner().clone(),
                    handle.clone(),
                    working_dir.clone(),
                )),
                disabled,
            );
        }
    }

    // ── Todo ──
    let todo_ctx = Arc::new(TodoSessionContext::new());
    register_if_enabled(registry, Box::new(TodoTool::new(todo_ctx)), disabled);

    // ── Repo setup ──
    register_if_enabled(registry, Box::new(RepoSetupTool::new()), disabled);

    // ── Worktree ──
    register_if_enabled(
        registry,
        Box::new(WorktreeTool::new(
            deps.session_id.clone(),
            Arc::clone(&deps.workspace),
        )),
        disabled,
    );

    // ── File history (undo/redo) ──
    register_if_enabled(registry, Box::new(ManageFileHistoryTool::new()), disabled);

    // ── Inline canvas (SDE + OS) ──
    register_if_enabled(registry, Box::new(RenderInlineCanvasTool::new()), disabled);
}
