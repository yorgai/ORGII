//! Workspace preparation for the agent run launch service.
//!
//! Handles worktree creation, workspace persistence, and work-item
//! execution lock acquisition / release.

use project_management::projects::{io as project_io, types as project_types};

pub(super) async fn prepare_rust_agent_workspace_for_launch(
    session_id: &str,
    workspace_path: &str,
    branch: Option<&str>,
    isolate: bool,
    existing_worktree_path: Option<&str>,
    additional_directories: &[String],
) -> Result<Option<String>, String> {
    if workspace_path.is_empty() {
        if isolate || existing_worktree_path.is_some() {
            return Err("Worktree mode requires a workspace path".to_string());
        }
        return Ok(None);
    }

    let session_id = session_id.to_string();
    let workspace_root = std::path::PathBuf::from(workspace_path);
    let branch = branch.map(str::to_string);
    let existing_worktree_path = existing_worktree_path.map(str::to_string);
    let additional_directories = additional_directories.to_vec();

    tokio::task::spawn_blocking(move || {
        use crate::session::persistence as workspace_persistence;
        use crate::session::workspace::{AdditionalDirectory, DirectorySource, SessionWorkspace};

        let mut created_worktree = false;
        let mut worktree_path = None;
        let mut worktree_metadata: Option<(String, String)> = None;
        let mut workspace = if let Some(existing_path) = existing_worktree_path {
            worktree_path = Some(existing_path.clone());
            SessionWorkspace::new_worktree(
                workspace_root.clone(),
                std::path::PathBuf::from(existing_path),
            )
        } else if isolate {
            let worktree_info = git::worktree::create_session_worktree(
                &workspace_root,
                &session_id,
                branch.as_deref(),
                crate::state::commands::session::common::worktree_max_count(),
            )?;
            created_worktree = true;
            worktree_path = Some(worktree_info.path.clone());
            worktree_metadata = worktree_info
                .base_branch
                .clone()
                .map(|base_branch| (worktree_info.branch.clone(), base_branch));
            SessionWorkspace::new_worktree(
                workspace_root.clone(),
                std::path::PathBuf::from(worktree_info.path),
            )
        } else {
            SessionWorkspace::new(workspace_root.clone())
        };

        for extra in additional_directories {
            let path = std::path::PathBuf::from(&extra);
            if path == workspace.workspace_root || path == workspace.working_dir {
                continue;
            }
            workspace.add_directory(AdditionalDirectory {
                path,
                source: DirectorySource::Session,
            });
        }

        if let Err(err) = workspace_persistence::save_workspace(&session_id, &workspace) {
            if created_worktree {
                if let Err(cleanup_err) =
                    git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
                {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %cleanup_err,
                        "[session_launch] failed to remove worktree during workspace-persist rollback; orphan on disk"
                    );
                }
            }
            return Err(err.to_string());
        }

        if let Some((worktree_branch, base_branch)) = worktree_metadata {
            if let Err(err) = workspace_persistence::save_worktree_metadata(
                &session_id,
                &worktree_branch,
                &base_branch,
                git::worktree::WorktreeMergeStatus::Pending,
            ) {
                if created_worktree {
                    if let Err(cleanup_err) =
                        git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
                    {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %cleanup_err,
                            "[session_launch] failed to remove worktree during metadata-persist rollback; orphan on disk"
                        );
                    }
                    if let Err(reset_err) = workspace_persistence::save_workspace(
                        &session_id,
                        &SessionWorkspace::new(workspace_root.clone()),
                    ) {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %reset_err,
                            "[session_launch] failed to reset workspace during metadata-persist rollback; DB may be stale"
                        );
                    }
                    let _ = workspace_persistence::clear_worktree_metadata(&session_id);
                }
                return Err(err.to_string());
            }
        }
        Ok(worktree_path)
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(super) async fn acquire_work_item_execution_lock(
    project_slug: &str,
    work_item_id: &str,
    session_id: &str,
    agent_role: Option<&str>,
    lock_reason: project_types::WorkItemExecutionLockReason,
) -> Result<(), String> {
    let project_slug = project_slug.to_string();
    let work_item_id = work_item_id.to_string();
    let session_id = session_id.to_string();
    let agent_role = agent_role.map(str::to_string);
    tokio::task::spawn_blocking(move || {
        project_io::acquire_execution_lock(
            &project_slug,
            &work_item_id,
            &session_id,
            agent_role.as_deref(),
            lock_reason,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(super) async fn release_work_item_execution_lock_if_present(
    project_slug: Option<&str>,
    work_item_id: Option<&str>,
    session_id: &str,
    app_handle: Option<&tauri::AppHandle>,
) {
    let (Some(project_slug), Some(work_item_id)) = (project_slug, work_item_id) else {
        return;
    };
    let project_slug = project_slug.to_string();
    let work_item_id = work_item_id.to_string();
    let session_id = session_id.to_string();
    let result = tokio::task::spawn_blocking({
        let project_slug = project_slug.clone();
        let work_item_id = work_item_id.clone();
        let session_id = session_id.clone();
        move || project_io::release_execution_lock(&project_slug, &work_item_id, &session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => {
            if let Some(handle) = app_handle {
                use tauri::Emitter;
                let ts = chrono::Utc::now().to_rfc3339();
                let _ = handle.emit(
                    project_management::projects::events::DATA_CHANGED_EVENT,
                    &ts,
                );
            }
        }
        Ok(Err(err)) => {
            tracing::warn!(
                error = %err,
                "[session_launch] failed to release work item execution lock"
            );
        }
        Err(err) => {
            tracing::warn!(
                error = %err,
                "[session_launch] failed to join work item execution lock release task"
            );
        }
    }
}
