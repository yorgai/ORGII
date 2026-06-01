//! Routine direct-run commands.

use crate::definitions::orgs::AgentOrgsStore;
use crate::session::launch::{
    launch_rust_agent_run, AgentRunLaunchRequest, AgentRunTarget, LaunchProvenance,
    LaunchResourceSelection, WorkspaceLaunchTarget,
};
use crate::state::AgentAppState;
use project_management::projects::{io, types};

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
    let pending_fire =
        tokio::task::spawn_blocking(move || io::create_routine_fire(&routine_id_for_fire))
            .await
            .map_err(|err| format!("Task join error: {}", err))??;

    let launch_request = routine_to_launch_request(&routine, &pending_fire.id);
    let launch_result = match launch_rust_agent_run(&state, Some(org_store.inner()), launch_request)
        .await
    {
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
        session_id: launch_result.session_id,
        agent_org_run_id: launch_result.agent_org_run_id,
    })
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
