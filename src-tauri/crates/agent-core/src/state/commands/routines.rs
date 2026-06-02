//! Routine direct-run commands.

use crate::definitions::builtin::SDE_AGENT_ID;
use crate::definitions::orgs::AgentOrgsStore;
use crate::session::launch::{
    launch_rust_agent_run, AgentRunLaunchRequest, AgentRunTarget, LaunchProvenance,
    LaunchResourceSelection, WorkspaceLaunchTarget,
};
use crate::state::AgentAppState;
use project_management::projects::{io, types};

const ROUTINE_CREATED_BY: &str = "routine";
const WORK_ITEM_ASSIGNEE_AGENT: &str = "agent";
const WORK_ITEM_PRIORITY_NONE: &str = "none";

#[tauri::command]
pub async fn project_fire_routine(
    state: tauri::State<'_, AgentAppState>,
    org_store: tauri::State<'_, AgentOrgsStore>,
    routine_id: String,
) -> Result<types::RoutineFireResult, String> {
    let routine_id_for_read = routine_id.clone();
    let routine = tokio::task::spawn_blocking(move || io::read_routine(&routine_id_for_read))
        .await
        .map_err(|err| format!("Task join error: {}", err))??;

    if !routine.enabled {
        return Err(format!("Routine is disabled: {routine_id}"));
    }
    let routine_id_for_fire = routine.id.clone();
    let output_policy_for_fire = routine.output_policy.clone();
    let pending_fire = tokio::task::spawn_blocking(move || {
        io::create_routine_fire_for_policy(&routine_id_for_fire, &output_policy_for_fire)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if !matches!(pending_fire.status, types::RoutineFireStatus::Pending) {
        return Ok(types::RoutineFireResult {
            fire: pending_fire,
            session_id: None,
            agent_org_run_id: None,
        });
    }

    match &routine.output_policy.mode {
        types::RoutineOutputMode::DirectSession => {
            launch_routine_direct_session(&state, org_store.inner(), &routine, &pending_fire).await
        }
        types::RoutineOutputMode::CreateWorkItem => {
            match create_work_item_from_routine(&routine, &pending_fire).await {
                Ok(result) => Ok(result),
                Err(err) => {
                    let fire_id = pending_fire.id.clone();
                    let error = err.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        io::mark_routine_fire_failed(&fire_id, &error)
                    })
                    .await;
                    Err(err)
                }
            }
        }
        types::RoutineOutputMode::UpdateExistingWorkItem => {
            let fire_id = pending_fire.id.clone();
            let error =
                "Routine output mode update_existing_work_item is not implemented".to_string();
            let error_for_mark = error.clone();
            let _ = tokio::task::spawn_blocking(move || {
                io::mark_routine_fire_failed(&fire_id, &error_for_mark)
            })
            .await;
            Err(error)
        }
    }
}

async fn launch_routine_direct_session(
    state: &AgentAppState,
    org_store: &AgentOrgsStore,
    routine: &types::RoutineDefinition,
    pending_fire: &types::RoutineFire,
) -> Result<types::RoutineFireResult, String> {
    let launch_request = routine_to_launch_request(routine, &pending_fire.id);
    let launch_result = match launch_rust_agent_run(state, Some(org_store), launch_request).await {
        Ok(result) => result,
        Err(err) => {
            let fire_id = pending_fire.id.clone();
            let error = err.clone();
            let _ =
                tokio::task::spawn_blocking(move || io::mark_routine_fire_failed(&fire_id, &error))
                    .await;
            return Err(err);
        }
    };

    let fire_id = pending_fire.id.clone();
    let session_id = launch_result.session_id.clone();
    let agent_org_run_id = launch_result.agent_org_run_id.clone();
    let fire = tokio::task::spawn_blocking(move || {
        io::mark_routine_fire_started(&fire_id, &session_id, agent_org_run_id.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    Ok(types::RoutineFireResult {
        fire,
        session_id: Some(launch_result.session_id),
        agent_org_run_id: launch_result.agent_org_run_id,
    })
}

async fn create_work_item_from_routine(
    routine: &types::RoutineDefinition,
    pending_fire: &types::RoutineFire,
) -> Result<types::RoutineFireResult, String> {
    let routine = routine.clone();
    let pending_fire = pending_fire.clone();
    tokio::task::spawn_blocking(move || {
        let project_slug = routine
            .output_policy
            .create_work_item_project_slug
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "Routine create_work_item output requires createWorkItemProjectSlug".to_string()
            })?
            .to_string();
        let short_id = io::allocate_short_id(&project_slug)?;
        let now = chrono::Utc::now().to_rfc3339();
        let title = routine
            .output_policy
            .create_work_item_title
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                routine
                    .run_template
                    .name
                    .clone()
                    .unwrap_or_else(|| routine.name.clone())
            });
        let body = routine
            .output_policy
            .create_work_item_body
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| routine.run_template.prompt.clone());

        let frontmatter = types::WorkItemFrontmatter {
            id: short_id.clone(),
            short_id: short_id.clone(),
            title,
            project: None,
            status: routine.output_policy.create_work_item_status.clone(),
            priority: WORK_ITEM_PRIORITY_NONE.to_string(),
            assignee: None,
            assignee_type: Some(WORK_ITEM_ASSIGNEE_AGENT.to_string()),
            labels: Vec::new(),
            milestone: None,
            parent: None,
            start_date: None,
            target_date: None,
            created_by: Some(ROUTINE_CREATED_BY.to_string()),
            created_at: now.clone(),
            updated_at: now.clone(),
            deleted_at: None,
            starred: false,
            todos: Vec::new(),
            comments: Vec::new(),
            history: Vec::new(),
            delegations: Vec::new(),
            linked_sessions: Vec::new(),
            proof_of_work: None,
            orchestrator_config: Some(routine_to_orchestrator_config(&routine)),
            orchestrator_state: None,
            follow_up_items: Vec::new(),
            schedule: None,
            routine_source: Some(types::WorkItemRoutineSource {
                routine_id: routine.id.clone(),
                routine_fire_id: pending_fire.id.clone(),
                routine_name: routine.name.clone(),
                fired_at: pending_fire.fired_at.clone(),
            }),
            execution_lock: None,
            close_out: None,
            work_products: Vec::new(),
        };

        io::write_work_item(&project_slug, &short_id, &frontmatter, &body)?;
        let fire = io::mark_routine_fire_work_item_created(&pending_fire.id, &short_id)?;
        Ok(types::RoutineFireResult {
            fire,
            session_id: None,
            agent_org_run_id: None,
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

fn routine_to_orchestrator_config(routine: &types::RoutineDefinition) -> types::OrchestratorConfig {
    let mut config = types::OrchestratorConfig {
        selected_account_id: routine.run_template.resources.account_id.clone(),
        selected_model_id: routine.run_template.resources.model.clone(),
        agent_mode: routine.run_template.mode.clone(),
        worktree_path: routine_workspace_path(&routine.run_template.workspace),
        ..Default::default()
    };

    match &routine.run_template.target {
        types::RoutineRunTarget::AgentDefinition {
            agent_definition_id,
        } => {
            config.agent_definition_id = agent_definition_id
                .clone()
                .or_else(|| Some(SDE_AGENT_ID.to_string()));
        }
        types::RoutineRunTarget::AgentOrg { agent_org_id } => {
            config.org_id = Some(agent_org_id.clone());
        }
    }

    config
}

fn routine_workspace_path(workspace: &types::RoutineWorkspaceTarget) -> Option<String> {
    match workspace {
        types::RoutineWorkspaceTarget::None => None,
        types::RoutineWorkspaceTarget::LocalWorkspace { workspace_path, .. } => {
            Some(workspace_path.clone())
        }
        types::RoutineWorkspaceTarget::Worktree {
            worktree_path,
            workspace_path,
            ..
        } => worktree_path
            .clone()
            .or_else(|| Some(workspace_path.clone())),
    }
}

fn routine_to_launch_request(
    routine: &types::RoutineDefinition,
    fire_id: &str,
) -> AgentRunLaunchRequest {
    let target = match &routine.run_template.target {
        types::RoutineRunTarget::AgentDefinition {
            agent_definition_id,
        } => AgentRunTarget::AgentDefinition {
            agent_definition_id: agent_definition_id.clone(),
        },
        types::RoutineRunTarget::AgentOrg { agent_org_id } => AgentRunTarget::AgentOrg {
            agent_org_id: agent_org_id.clone(),
            agent_definition_id: None,
            member_overrides: std::collections::HashMap::new(),
            apply_member_overrides_for_future: false,
        },
    };

    let workspace = match &routine.run_template.workspace {
        types::RoutineWorkspaceTarget::None => WorkspaceLaunchTarget::LocalWorkspace {
            workspace_path: String::new(),
            additional_directories: Vec::new(),
        },
        types::RoutineWorkspaceTarget::LocalWorkspace {
            workspace_path,
            additional_directories,
        } => WorkspaceLaunchTarget::LocalWorkspace {
            workspace_path: workspace_path.clone(),
            additional_directories: additional_directories.clone(),
        },
        types::RoutineWorkspaceTarget::Worktree {
            workspace_path,
            worktree_path,
            branch,
            create_isolated,
            additional_directories,
        } => WorkspaceLaunchTarget::Worktree {
            workspace_path: workspace_path.clone(),
            worktree_path: worktree_path.clone(),
            branch: branch.clone(),
            create_isolated: *create_isolated,
            additional_directories: additional_directories.clone(),
        },
    };

    AgentRunLaunchRequest {
        content: routine.run_template.prompt.clone(),
        target,
        resources: LaunchResourceSelection {
            key_source: routine.run_template.resources.key_source.clone(),
            account_id: routine.run_template.resources.account_id.clone(),
            model: routine.run_template.resources.model.clone(),
            native_harness_type: routine.run_template.resources.native_harness_type.clone(),
        },
        workspace,
        provenance: LaunchProvenance::RoutineFire {
            routine_fire_id: fire_id.to_string(),
        },
        mode: routine.run_template.mode.clone(),
        name: routine
            .run_template
            .name
            .clone()
            .or_else(|| Some(routine.name.clone())),
        images: None,
        ide_context: None,
        sub_agent_ids: Vec::new(),
    }
}
