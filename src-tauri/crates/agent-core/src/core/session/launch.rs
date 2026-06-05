//! Canonical Rust-agent launch service.
//!
//! This module is the single runtime entry point for creating a Rust-native
//! agent session and optionally starting its first turn. Tauri commands,
//! WorkItem orchestration, Routine fires, and debug probes should adapt their
//! wire/domain DTOs into `AgentRunLaunchRequest` instead of duplicating session
//! creation or first-turn startup logic.

use std::collections::{HashMap, HashSet};

use tauri::Manager;

use crate::coordination::agent_org_runs::{
    AgentOrgRunEntryMode, AgentOrgRunStatus, AgentOrgRunStore, CreateAgentOrgRunParams,
    COORDINATOR_MEMBER_ID,
};
use core_types::key_source::KeySource;

use crate::definitions::orgs::{
    is_cli_agent_org_reference, parse_cli_agent_org_reference, AgentOrgsStore, OrgDefinition,
    OrgMember, OrgMemberLaunchOverride, OrgMemberRuntimeConfig,
};
use crate::definitions::AgentDefinitionsStore;
use crate::session::persistence::{
    self as session_persistence, session_type, UnifiedSessionRecord,
};
use crate::session::turn::streaming::{
    broadcast_agent_error_structured, classify_streaming_error_message, StreamingError,
};
use crate::session::IdeContext;
use crate::state::AgentAppState;
use project_management::projects::{io as project_io, types as project_types};

const MAX_AUTO_NAME_LEN: usize = 80;

#[derive(Debug, Clone)]
pub(crate) struct AgentRunLaunchRequest {
    pub content: String,
    pub target: AgentRunTarget,
    pub resources: LaunchResourceSelection,
    pub workspace: WorkspaceLaunchTarget,
    pub provenance: LaunchProvenance,
    pub mode: Option<String>,
    pub name: Option<String>,
    pub images: Option<Vec<String>>,
    pub ide_context: Option<IdeContext>,
    pub sub_agent_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) enum AgentRunTarget {
    AgentDefinition {
        agent_definition_id: Option<String>,
    },
    AgentOrg {
        agent_org_id: String,
        agent_definition_id: Option<String>,
        member_overrides: HashMap<String, OrgMemberLaunchOverride>,
        apply_member_overrides_for_future: bool,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct LaunchResourceSelection {
    pub key_source: Option<String>,
    pub account_id: Option<String>,
    pub model: Option<String>,
    pub native_harness_type: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) enum WorkspaceLaunchTarget {
    LocalWorkspace {
        workspace_path: String,
        additional_directories: Vec<String>,
    },
    Worktree {
        workspace_path: String,
        worktree_path: Option<String>,
        branch: Option<String>,
        create_isolated: bool,
        additional_directories: Vec<String>,
    },
}

#[derive(Debug, Clone)]
pub(crate) enum LaunchProvenance {
    UserSession,
    WorkItem {
        project_slug: String,
        work_item_id: String,
        agent_role: Option<String>,
    },
    RoutineFire {
        routine_fire_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LaunchReturnStatus {
    Idle,
    FirstTurnStarted,
}

impl LaunchReturnStatus {
    pub(crate) fn session_status(self) -> crate::session::SessionStatus {
        match self {
            Self::Idle => crate::session::SessionStatus::Idle,
            Self::FirstTurnStarted => crate::session::SessionStatus::Running,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AgentRunLaunchResult {
    pub session_id: String,
    pub status: LaunchReturnStatus,
    pub created_at: String,
    pub workspace_path: Option<String>,
    pub worktree_path: Option<String>,
    pub agent_org_id: Option<String>,
    pub agent_org_run_id: Option<String>,
}

/// Create and start an agent session linked to a work item.
///
/// This remains as the public WorkItem-facing adapter for existing callers;
/// all actual launch behavior is delegated to `launch_rust_agent_run`.
pub struct WorkItemLaunchRequest<'a> {
    pub workspace_path: &'a str,
    pub prompt: &'a str,
    pub model: &'a str,
    pub account_id: &'a str,
    pub work_item_id: &'a str,
    pub project_slug: &'a str,
    pub worktree_path: Option<&'a str>,
    pub agent_definition_id: Option<&'a str>,
    pub agent_role: &'a str,
    pub sub_agent_ids: &'a [String],
}

pub async fn launch_agent_session(
    app: &tauri::AppHandle,
    request: WorkItemLaunchRequest<'_>,
) -> Result<String, String> {
    let state: tauri::State<'_, AgentAppState> = app.state();
    let WorkItemLaunchRequest {
        workspace_path,
        prompt,
        model,
        account_id,
        work_item_id,
        project_slug,
        worktree_path,
        agent_definition_id,
        agent_role,
        sub_agent_ids,
    } = request;

    let workspace = match worktree_path.filter(|path| !path.is_empty()) {
        Some(path) => WorkspaceLaunchTarget::Worktree {
            workspace_path: workspace_path.to_string(),
            worktree_path: Some(path.to_string()),
            branch: None,
            create_isolated: false,
            additional_directories: Vec::new(),
        },
        None => WorkspaceLaunchTarget::LocalWorkspace {
            workspace_path: workspace_path.to_string(),
            additional_directories: Vec::new(),
        },
    };

    let result = launch_rust_agent_run(
        &state,
        None,
        AgentRunLaunchRequest {
            content: prompt.to_string(),
            target: AgentRunTarget::AgentDefinition {
                agent_definition_id: agent_definition_id.map(str::to_string),
            },
            resources: LaunchResourceSelection {
                key_source: Some(
                    core_types::key_source::KeySource::OwnKey
                        .as_ref()
                        .to_string(),
                ),
                account_id: Some(account_id.to_string()),
                model: Some(model.to_string()),
                native_harness_type: None,
            },
            workspace,
            provenance: LaunchProvenance::WorkItem {
                project_slug: project_slug.to_string(),
                work_item_id: work_item_id.to_string(),
                agent_role: Some(agent_role.to_string()),
            },
            mode: Some(crate::session::AgentExecMode::Build.as_str().to_string()),
            name: Some(format!("{}: {}", agent_role, work_item_id)),
            images: None,
            ide_context: None,
            sub_agent_ids: sub_agent_ids.to_vec(),
        },
    )
    .await?;

    Ok(result.session_id)
}

pub(crate) async fn launch_rust_agent_run(
    state: &AgentAppState,
    org_store: Option<&AgentOrgsStore>,
    request: AgentRunLaunchRequest,
) -> Result<AgentRunLaunchResult, String> {
    let (workspace_path, branch, isolate, existing_worktree_path, additional_directories) =
        match &request.workspace {
            WorkspaceLaunchTarget::LocalWorkspace {
                workspace_path,
                additional_directories,
            } => (
                workspace_path.clone(),
                None,
                false,
                None,
                additional_directories.clone(),
            ),
            WorkspaceLaunchTarget::Worktree {
                workspace_path,
                worktree_path,
                branch,
                create_isolated,
                additional_directories,
            } => (
                workspace_path.clone(),
                branch.clone(),
                *create_isolated,
                worktree_path.clone(),
                additional_directories.clone(),
            ),
        };
    let (
        agent_org_id,
        coordinator_agent_id,
        agent_definition_id,
        org_definition,
        member_overrides,
        apply_member_overrides_for_future,
    ) = match &request.target {
        AgentRunTarget::AgentOrg {
            agent_org_id,
            agent_definition_id,
            member_overrides,
            apply_member_overrides_for_future,
        } => {
            let store = org_store.ok_or_else(|| {
                "Agent Org launch requires AgentOrgsStore, but none was provided".to_string()
            })?;
            let org = store.get(agent_org_id)?;
            let resolved = org.agent_id.trim();
            if resolved.is_empty() {
                return Err(format!(
                    "Agent Org '{}' has no coordinator agent configured",
                    org.name
                ));
            }
            if let Some(requested_agent_id) = agent_definition_id.as_deref() {
                if requested_agent_id != resolved {
                    return Err(format!(
                        "Agent Org '{}' coordinator '{}' conflicts with requested agent definition '{}'",
                        agent_org_id, resolved, requested_agent_id
                    ));
                }
            }
            (
                Some(agent_org_id.clone()),
                Some(resolved.to_string()),
                Some(resolved.to_string()),
                Some(org),
                member_overrides.clone(),
                *apply_member_overrides_for_future,
            )
        }
        AgentRunTarget::AgentDefinition {
            agent_definition_id,
        } => (
            None,
            None,
            agent_definition_id.clone(),
            None,
            HashMap::new(),
            false,
        ),
    };
    let effective_org_definition = org_definition
        .as_ref()
        .map(|org| {
            let mut effective_org = org.clone();
            apply_member_launch_overrides_to_snapshot(
                &mut effective_org.children,
                &member_overrides,
            )
            .map(|()| effective_org)
        })
        .transpose()?;
    validate_launch_agent_definitions(
        agent_definition_id.as_deref(),
        effective_org_definition.as_ref(),
    )?;

    let (project_slug, work_item_id, agent_role, routine_fire_id) =
        provenance_fields(&request.provenance);
    let name = request
        .name
        .clone()
        .unwrap_or_else(|| derive_name(None, &request.content));

    let create_result = crate::state::commands::session::create::create_session_impl(
        None,
        workspace_path.clone(),
        request.resources.model.clone(),
        request.resources.account_id.clone(),
        Some(name.clone()),
        work_item_id.clone(),
        agent_role.clone(),
        existing_worktree_path.clone(),
        project_slug.clone(),
        agent_definition_id.clone(),
        request.resources.key_source.clone(),
        request.mode.clone(),
        request.resources.native_harness_type.clone(),
    )
    .await?;

    let session_id = create_result
        .get("sessionId")
        .and_then(|value| value.as_str())
        .ok_or("create_session_impl did not return sessionId")?
        .to_string();

    if let (Some(project_slug_value), Some(work_item_id_value)) =
        (project_slug.as_deref(), work_item_id.as_deref())
    {
        if let Err(err) = acquire_work_item_execution_lock(
            project_slug_value,
            work_item_id_value,
            &session_id,
            agent_role.as_deref(),
        )
        .await
        {
            cleanup_session_after_org_run_create_failure(session_id.clone()).await;
            return Err(err);
        }
    }

    let agent_org_run_id = match (agent_org_id.as_ref(), coordinator_agent_id.as_ref()) {
        (Some(org_id), Some(coordinator_id)) => {
            let org_snapshot = effective_org_definition
                .as_ref()
                .ok_or("Agent Org launch is missing resolved org definition")?
                .clone();
            let run = AgentOrgRunStore::create(CreateAgentOrgRunParams {
                org_id: org_id.clone(),
                coordinator_agent_id: coordinator_id.clone(),
                root_session_id: Some(session_id.clone()),
                org_snapshot,
                entry_mode: AgentOrgRunEntryMode::StandaloneSession,
                status: AgentOrgRunStatus::Running,
                work_item_id: work_item_id.clone(),
                project_slug: project_slug.clone(),
                routine_fire_id,
            });
            match run {
                Ok(record) => {
                    session_persistence::update_org_member_id(&session_id, COORDINATOR_MEMBER_ID)
                        .map_err(|err| format!("failed to persist coordinator member_id: {err}"))?;
                    if let Some(org) = effective_org_definition.as_ref() {
                        spawn_agent_org_member_materialization(
                            record.id.clone(),
                            org.clone(),
                            session_id.clone(),
                            name.clone(),
                            workspace_path.clone(),
                            request.resources.model.clone(),
                            request.resources.account_id.clone(),
                            request.resources.key_source.clone(),
                            request.mode.clone(),
                            request.resources.native_harness_type.clone(),
                            work_item_id.clone(),
                            project_slug.clone(),
                        );
                    }
                    if apply_member_overrides_for_future {
                        if let Some(store) = org_store {
                            store.apply_member_launch_overrides(org_id, &member_overrides)?;
                        }
                    }
                    Some(record.id)
                }
                Err(err) => {
                    cleanup_session_after_org_run_create_failure(session_id.clone()).await;
                    return Err(err);
                }
            }
        }
        _ => None,
    };

    let created_at = chrono::Utc::now().to_rfc3339();
    let has_initial_content = !request.content.trim().is_empty();
    let native_harness_type_for_send = request
        .resources
        .native_harness_type
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| {
            core_types::providers::NativeHarnessType::parse(value)
                .ok_or_else(|| format!("Unknown native_harness_type: {value:?}"))
        })
        .transpose()?;

    if agent_org_run_id.is_some() {
        let state_for_background = state.clone();
        let session_id_for_background = session_id.clone();
        let workspace_path_for_background = workspace_path.clone();
        let branch_for_background = branch.clone();
        let existing_worktree_path_for_background = existing_worktree_path.clone();
        let additional_directories_for_background = additional_directories.clone();
        let content_for_send = request.content.clone();
        let model_for_send = request.resources.model.clone();
        let account_id_for_send = request.resources.account_id.clone();
        let mode_for_send = request.mode.clone();
        let images_for_send = request.images.clone();
        let ide_context_for_send = request.ide_context.clone();
        let sub_agent_ids_for_send = request.sub_agent_ids.clone();
        let agent_definition_id_for_send = agent_definition_id.clone();
        let agent_org_run_id_for_background = agent_org_run_id.clone();
        let project_slug_for_background = project_slug.clone();
        let work_item_id_for_background = work_item_id.clone();
        let app_handle_for_background = state.app_handle.clone();

        tokio::spawn(async move {
            let prepared_worktree_path = match prepare_rust_agent_workspace_for_launch(
                &session_id_for_background,
                &workspace_path_for_background,
                branch_for_background.as_deref(),
                isolate,
                existing_worktree_path_for_background.as_deref(),
                &additional_directories_for_background,
            )
            .await
            {
                Ok(path) => path,
                Err(err) => {
                    let message = format!(
                        "[session_launch] workspace preparation failed for {}: {}",
                        session_id_for_background, err
                    );
                    handle_background_launch_failure(
                        &session_id_for_background,
                        agent_org_run_id_for_background.as_deref(),
                        project_slug_for_background.as_deref(),
                        work_item_id_for_background.as_deref(),
                        app_handle_for_background.as_ref(),
                        &message,
                        "[session_launch] failed to mark Agent Org run failed after workspace preparation error",
                        "[session_launch] failed to mark session failed after workspace preparation error",
                    )
                    .await;
                    return;
                }
            };

            if !has_initial_content {
                return;
            }

            let workspace_path_for_send = prepared_worktree_path
                .clone()
                .unwrap_or_else(|| workspace_path_for_background.clone());
            let send_result = send_initial_turn(
                &state_for_background,
                &session_id_for_background,
                content_for_send,
                model_for_send,
                account_id_for_send,
                workspace_path_for_send,
                native_harness_type_for_send,
                mode_for_send,
                images_for_send,
                ide_context_for_send,
                agent_definition_id_for_send,
                sub_agent_ids_for_send,
            )
            .await;

            if let Err(err) = send_result {
                let message = format!(
                    "[session_launch] send_message failed for {}: {}",
                    session_id_for_background, err
                );
                handle_background_launch_failure(
                    &session_id_for_background,
                    agent_org_run_id_for_background.as_deref(),
                    project_slug_for_background.as_deref(),
                    work_item_id_for_background.as_deref(),
                    app_handle_for_background.as_ref(),
                    &message,
                    "[session_launch] failed to mark Agent Org run failed",
                    "[session_launch] failed to mark session failed after first-message error",
                )
                .await;
            }
        });

        return Ok(AgentRunLaunchResult {
            session_id,
            status: if has_initial_content {
                LaunchReturnStatus::FirstTurnStarted
            } else {
                LaunchReturnStatus::Idle
            },
            created_at,
            workspace_path: Some(workspace_path).filter(|path| !path.is_empty()),
            worktree_path: existing_worktree_path,
            agent_org_id,
            agent_org_run_id,
        });
    }

    let worktree_path = match prepare_rust_agent_workspace_for_launch(
        &session_id,
        &workspace_path,
        branch.as_deref(),
        isolate,
        existing_worktree_path.as_deref(),
        &additional_directories,
    )
    .await
    {
        Ok(path) => path,
        Err(err) => {
            release_work_item_execution_lock_if_present(
                project_slug.as_deref(),
                work_item_id.as_deref(),
                &session_id,
                state.app_handle.as_ref(),
            )
            .await;
            return Err(err);
        }
    };

    if has_initial_content {
        let state_for_send = state.clone();
        let session_id_for_send = session_id.clone();
        let workspace_path_for_send = worktree_path
            .clone()
            .unwrap_or_else(|| workspace_path.clone());
        let content_for_send = request.content.clone();
        let model_for_send = request.resources.model.clone();
        let account_id_for_send = request.resources.account_id.clone();
        let mode_for_send = request.mode.clone();
        let images_for_send = request.images.clone();
        let ide_context_for_send = request.ide_context.clone();
        let sub_agent_ids_for_send = request.sub_agent_ids.clone();
        let agent_definition_id_for_send = agent_definition_id.clone();
        let agent_org_run_id_for_send = agent_org_run_id.clone();
        let project_slug_for_send = project_slug.clone();
        let work_item_id_for_send = work_item_id.clone();
        let app_handle_for_send = state.app_handle.clone();

        tokio::spawn(async move {
            let send_result = send_initial_turn(
                &state_for_send,
                &session_id_for_send,
                content_for_send,
                model_for_send,
                account_id_for_send,
                workspace_path_for_send,
                native_harness_type_for_send,
                mode_for_send,
                images_for_send,
                ide_context_for_send,
                agent_definition_id_for_send,
                sub_agent_ids_for_send,
            )
            .await;

            if let Err(err) = send_result {
                let message = format!(
                    "[session_launch] send_message failed for {}: {}",
                    session_id_for_send, err
                );
                handle_background_launch_failure(
                    &session_id_for_send,
                    agent_org_run_id_for_send.as_deref(),
                    project_slug_for_send.as_deref(),
                    work_item_id_for_send.as_deref(),
                    app_handle_for_send.as_ref(),
                    &message,
                    "[session_launch] failed to mark Agent Org run failed",
                    "[session_launch] failed to mark session failed after first-message error",
                )
                .await;
            }
        });
    }

    Ok(AgentRunLaunchResult {
        session_id,
        status: if has_initial_content {
            LaunchReturnStatus::FirstTurnStarted
        } else {
            LaunchReturnStatus::Idle
        },
        created_at,
        workspace_path: Some(workspace_path).filter(|path| !path.is_empty()),
        worktree_path,
        agent_org_id,
        agent_org_run_id,
    })
}

async fn handle_background_launch_failure(
    session_id: &str,
    agent_org_run_id: Option<&str>,
    project_slug: Option<&str>,
    work_item_id: Option<&str>,
    app_handle: Option<&tauri::AppHandle>,
    message: &str,
    run_mark_warning: &str,
    session_mark_warning: &str,
) {
    tracing::warn!("{}", message);
    if let Some(run_id) = agent_org_run_id {
        if let Err(mark_err) = AgentOrgRunStore::mark_failed(run_id, message) {
            tracing::warn!(
                run_id = %run_id,
                error = %mark_err,
                "{}",
                run_mark_warning
            );
        }
    }
    release_work_item_execution_lock_if_present(project_slug, work_item_id, session_id, app_handle)
        .await;
    broadcast_launch_send_error(session_id, message);
    crate::lifecycle::persist_session_error_event(app_handle, session_id, message);
    if let Err(mark_err) = mark_session_failed(session_id.to_string()).await {
        tracing::warn!(
            session_id = %session_id,
            error = %mark_err,
            "{}",
            session_mark_warning
        );
    }
}

fn apply_member_launch_overrides_to_snapshot(
    members: &mut [OrgMember],
    overrides: &HashMap<String, OrgMemberLaunchOverride>,
) -> Result<(), String> {
    let mut applied_member_ids = HashSet::new();
    apply_member_launch_overrides_recursive(members, overrides, &mut applied_member_ids)?;
    let mut unknown_member_ids = overrides
        .keys()
        .filter(|member_id| !applied_member_ids.contains(*member_id))
        .cloned()
        .collect::<Vec<_>>();
    unknown_member_ids.sort();
    if !unknown_member_ids.is_empty() {
        return Err(format!(
            "Agent Org launch override references unknown member id(s): {}",
            unknown_member_ids.join(", ")
        ));
    }
    Ok(())
}

fn apply_member_launch_overrides_recursive(
    members: &mut [OrgMember],
    overrides: &HashMap<String, OrgMemberLaunchOverride>,
    applied_member_ids: &mut HashSet<String>,
) -> Result<(), String> {
    for member in members {
        if let Some(member_override) = overrides.get(&member.id) {
            applied_member_ids.insert(member.id.clone());
            if let Some(agent_id) = member_override
                .agent_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                member.agent_id = agent_id.to_string();
            }
            if let Some(runtime_config) = member_override.runtime_config.clone() {
                member.runtime_config = Some(runtime_config);
            }
        }
        apply_member_launch_overrides_recursive(
            &mut member.children,
            overrides,
            applied_member_ids,
        )?;
    }
    Ok(())
}

fn validate_launch_agent_definitions(
    agent_definition_id: Option<&str>,
    org_definition: Option<&OrgDefinition>,
) -> Result<(), String> {
    let store = AgentDefinitionsStore::new();

    if let Some(definition_id) = agent_definition_id.filter(|id| !id.trim().is_empty()) {
        if store.get(definition_id).is_none() {
            return Err(format!(
                "Agent definition '{}' does not exist; remove the stale session or choose an existing Agent definition before launching",
                definition_id
            ));
        }
    }

    if let Some(org) = org_definition {
        let mut missing: Vec<String> = Vec::new();
        let mut member_ids = HashSet::new();
        let mut invalid_member_ids: Vec<String> = Vec::new();
        let mut duplicate_member_ids: Vec<String> = Vec::new();
        if !org.agent_id.trim().is_empty()
            && !is_cli_agent_org_reference(&org.agent_id)
            && store.get(&org.agent_id).is_none()
        {
            missing.push(format!("coordinator '{}'", org.agent_id));
        }
        for member in flatten_org_members(&org.children) {
            let member_id = member.id.trim();
            if member_id.is_empty() {
                invalid_member_ids.push(format!("member '{}' has empty id", member.name));
            } else if member_id == COORDINATOR_MEMBER_ID {
                invalid_member_ids.push(format!(
                    "member '{}' uses reserved id '{}'",
                    member.name, COORDINATOR_MEMBER_ID
                ));
            } else if !member_ids.insert(member_id.to_string()) {
                duplicate_member_ids.push(member_id.to_string());
            }

            if !is_cli_agent_org_reference(&member.agent_id)
                && store.get(&member.agent_id).is_none()
            {
                missing.push(format!("member '{}' ({})", member.name, member.agent_id));
            }
        }
        duplicate_member_ids.sort();
        duplicate_member_ids.dedup();
        if !invalid_member_ids.is_empty() || !duplicate_member_ids.is_empty() {
            let mut reasons = Vec::new();
            reasons.extend(invalid_member_ids);
            if !duplicate_member_ids.is_empty() {
                reasons.push(format!(
                    "duplicate member_id value(s): {}",
                    duplicate_member_ids.join(", ")
                ));
            }
            return Err(format!(
                "Agent Org '{}' has invalid member_id configuration: {}",
                org.name,
                reasons.join(", ")
            ));
        }
        if !missing.is_empty() {
            return Err(format!(
                "Agent Org '{}' references missing Agent definition(s): {}",
                org.name,
                missing.join(", ")
            ));
        }
    }

    Ok(())
}

fn clean_runtime_value(value: Option<&String>) -> Option<String> {
    value
        .map(|raw| raw.trim())
        .filter(|trimmed| !trimmed.is_empty())
        .map(str::to_string)
}

fn member_runtime_model(
    config: Option<&OrgMemberRuntimeConfig>,
    fallback: &Option<String>,
) -> Option<String> {
    config
        .and_then(|cfg| {
            clean_runtime_value(cfg.model.as_ref())
                .or_else(|| clean_runtime_value(cfg.listing_model.as_ref()))
        })
        .or_else(|| fallback.clone())
}

fn member_runtime_account_id(
    config: Option<&OrgMemberRuntimeConfig>,
    fallback: &Option<String>,
) -> Option<String> {
    config
        .and_then(|cfg| clean_runtime_value(cfg.account_id.as_ref()))
        .or_else(|| fallback.clone())
}

fn member_runtime_tier(config: Option<&OrgMemberRuntimeConfig>) -> Option<String> {
    config.and_then(|cfg| clean_runtime_value(cfg.tier.as_ref()))
}

fn member_runtime_key_source(
    config: Option<&OrgMemberRuntimeConfig>,
    fallback: &KeySource,
) -> Result<KeySource, String> {
    match config.and_then(|cfg| clean_runtime_value(cfg.key_source.as_ref())) {
        Some(raw) => KeySource::parse(&raw).ok_or_else(|| format!("Unknown key_source: {raw:?}")),
        None => Ok(fallback.clone()),
    }
}

fn member_runtime_native_harness_type(
    config: Option<&OrgMemberRuntimeConfig>,
    fallback: &Option<String>,
) -> Result<Option<String>, String> {
    match config.and_then(|cfg| clean_runtime_value(cfg.native_harness_type.as_ref())) {
        Some(raw) => core_types::providers::NativeHarnessType::parse(&raw)
            .ok_or_else(|| format!("Unknown native_harness_type: {raw:?}"))
            .map(|parsed| Some(parsed.as_str().to_string())),
        None => Ok(fallback.clone()),
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_agent_org_member_materialization(
    org_run_id: String,
    org: OrgDefinition,
    root_session_id: String,
    root_session_name: String,
    workspace_path: String,
    model: Option<String>,
    account_id: Option<String>,
    key_source: Option<String>,
    agent_exec_mode: Option<String>,
    native_harness_type: Option<String>,
    work_item_id: Option<String>,
    project_slug: Option<String>,
) {
    tokio::spawn(async move {
        if let Err(err) = materialize_org_member_sessions(
            &org_run_id,
            &org,
            &root_session_id,
            &root_session_name,
            &workspace_path,
            model,
            account_id,
            key_source,
            agent_exec_mode,
            native_harness_type,
            work_item_id,
            project_slug,
        )
        .await
        {
            tracing::warn!(
                run_id = %org_run_id,
                root_session_id = %root_session_id,
                error = %err,
                "[session_launch] failed to materialize Agent Org member sessions in background"
            );
            if let Err(mark_err) = AgentOrgRunStore::mark_failed(&org_run_id, &err) {
                tracing::warn!(
                    run_id = %org_run_id,
                    error = %mark_err,
                    "[session_launch] failed to mark Agent Org run failed after member materialization error"
                );
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
async fn materialize_org_member_sessions(
    org_run_id: &str,
    org: &OrgDefinition,
    root_session_id: &str,
    _root_session_name: &str,
    workspace_path: &str,
    model: Option<String>,
    account_id: Option<String>,
    key_source: Option<String>,
    agent_exec_mode: Option<String>,
    native_harness_type: Option<String>,
    work_item_id: Option<String>,
    project_slug: Option<String>,
) -> Result<Vec<String>, String> {
    let flattened_members = flatten_org_members(&org.children);
    if flattened_members.is_empty() {
        return Ok(Vec::new());
    }

    let mut rust_members = Vec::new();
    let mut cli_members = Vec::new();
    for member in flattened_members {
        if parse_cli_agent_org_reference(&member.agent_id).is_some() {
            cli_members.push(member);
        } else {
            rust_members.push(member);
        }
    }

    let workspace_path = workspace_path.to_string();
    let root_session_id = root_session_id.to_string();
    let org_name = org.name.clone();
    let model = model.filter(|value| !value.trim().is_empty());
    let key_source = match key_source
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(raw) => KeySource::parse(raw).ok_or_else(|| format!("Unknown key_source: {raw:?}"))?,
        None => KeySource::default(),
    };
    let native_harness_type = native_harness_type
        .filter(|value| !value.trim().is_empty())
        .map(|raw| {
            core_types::providers::NativeHarnessType::parse(&raw)
                .ok_or_else(|| format!("Unknown native_harness_type: {raw:?}"))
                .map(|parsed| parsed.as_str().to_string())
        })
        .transpose()?;
    let agent_exec_mode = agent_exec_mode.filter(|mode| !mode.trim().is_empty());
    let org_run_id = org_run_id.to_string();
    let mut created_session_ids = Vec::with_capacity(rust_members.len() + cli_members.len());
    let mut created_rust_session_ids = Vec::new();
    let mut created_cli_session_ids = Vec::new();

    if !rust_members.is_empty() {
        let rust_workspace_path = workspace_path.clone();
        let rust_root_session_id = root_session_id.clone();
        let rust_org_name = org_name.clone();
        let rust_model = model.clone();
        let rust_account_id = account_id.clone();
        let rust_key_source = key_source.clone();
        let rust_agent_exec_mode = agent_exec_mode.clone();
        let rust_native_harness_type = native_harness_type.clone();
        let rust_work_item_id = work_item_id.clone();
        let rust_project_slug = project_slug.clone();
        let rust_org_run_id = org_run_id.clone();
        created_rust_session_ids = tokio::task::spawn_blocking(move || {
            let now = chrono::Utc::now().to_rfc3339();
            let mut created_session_ids: Vec<String> = Vec::with_capacity(rust_members.len());
            let has_workspace_path = !rust_workspace_path.is_empty();

            for member in rust_members {
                let prefix = crate::definitions::prefix_lookup::session_prefix_for_launch(
                    Some(&member.agent_id),
                    has_workspace_path,
                );
                let session_id = format!("{}{}", prefix, uuid::Uuid::new_v4());
                let member_config = member.runtime_config.as_ref();
                let member_model = member_runtime_model(member_config, &rust_model);
                let member_account_id = member_runtime_account_id(member_config, &rust_account_id);
                let member_key_source = member_runtime_key_source(member_config, &rust_key_source)
                    .map_err(|err| format!("invalid runtime config for member '{}': {}", member.name, err))?;
                let member_native_harness_type =
                    member_runtime_native_harness_type(member_config, &rust_native_harness_type)
                        .map_err(|err| format!("invalid runtime config for member '{}': {}", member.name, err))?;
                let session = UnifiedSessionRecord {
                    session_id: session_id.clone(),
                    name: format!("{} · {}", member.name, member.role),
                    status: crate::session::SessionStatus::Idle.as_str().to_string(),
                    model: member_model,
                    account_id: member_account_id,
                    workspace_path: Some(rust_workspace_path.clone()),
                    user_input: None,
                    total_tokens: 0,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    session_type: session_type::ORG_MEMBER.to_string(),
                    work_item_id: rust_work_item_id.clone(),
                    agent_role: Some(member.role.clone()),
                    project_slug: rust_project_slug.clone(),
                    agent_definition_id: Some(member.agent_id.clone()),
                    org_member_id: Some(member.id.clone()),
                    parent_session_id: Some(rust_root_session_id.clone()),
                    key_source: member_key_source,
                    agent_exec_mode: rust_agent_exec_mode.clone(),
                    native_harness_type: member_native_harness_type,
                    ..Default::default()
                };
                if let Err(err) = session_persistence::upsert_session(&session) {
                    for created_session_id in &created_session_ids {
                        if let Err(cleanup_err) = session_persistence::delete_session(created_session_id)
                        {
                            tracing::warn!(
                                session_id = %created_session_id,
                                error = %cleanup_err,
                                "[session_launch] failed to clean up materialized Agent Org member session"
                            );
                        }
                    }
                    return Err(format!(
                        "failed to materialize Agent Org member '{}' for run '{}': {}",
                        member.name, rust_org_run_id, err
                    ));
                }
                created_session_ids.push(session_id);
            }

            tracing::info!(
                run_id = %rust_org_run_id,
                org_name = %rust_org_name,
                member_sessions = created_session_ids.len(),
                "[session_launch] materialized Rust Agent Org member sessions"
            );
            Ok(created_session_ids)
        })
        .await
        .map_err(|err| err.to_string())??;
        created_session_ids.extend(created_rust_session_ids.iter().cloned());
    }

    for member in cli_members {
        let cli_agent_type = parse_cli_agent_org_reference(&member.agent_id)
            .ok_or_else(|| format!("invalid CLI Agent Org reference: {}", member.agent_id))?
            .as_str()
            .to_string();
        let member_config = member.runtime_config.as_ref();
        let member_key_source = member_runtime_key_source(member_config, &key_source)?;
        let outcome = crate::foundation::session_bridge::launch_cli_agent(
            crate::foundation::session_bridge::CliLaunchParams {
                name: Some(format!("{} · {}", member.name, member.role)),
                cli_agent_type,
                model: member_runtime_model(member_config, &model),
                tier: member_runtime_tier(member_config),
                account_id: member_runtime_account_id(member_config, &account_id),
                repo_path: Some(workspace_path.clone()).filter(|path| !path.is_empty()),
                branch: None,
                hosted_token: None,
                isolate: false,
                background: true,
                key_source: Some(member_key_source.as_ref().to_string()),
                additional_directories: None,
                parent_session_id: Some(root_session_id.clone()),
                org_member_id: Some(member.id.clone()),
                user_input: String::new(),
                ide_context: None,
                mode: agent_exec_mode.clone(),
                images: None,
            },
        )
        .await;
        match outcome {
            Ok(outcome) => {
                created_session_ids.push(outcome.session_id.clone());
                created_cli_session_ids.push(outcome.session_id);
            }
            Err(err) => {
                for session_id in &created_rust_session_ids {
                    if let Err(cleanup_err) = session_persistence::delete_session(session_id) {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %cleanup_err,
                            "[session_launch] failed to clean up Rust Agent Org member session after CLI materialization failure"
                        );
                    }
                }
                for session_id in &created_cli_session_ids {
                    if let Err(cleanup_err) =
                        crate::foundation::session_bridge::delete_cli_session(session_id)
                    {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %cleanup_err,
                            "[session_launch] failed to clean up CLI Agent Org member session"
                        );
                    }
                }
                return Err(format!(
                    "failed to materialize CLI Agent Org member '{}' for run '{}': {}",
                    member.name, org_run_id, err
                ));
            }
        }
    }

    tracing::info!(
        run_id = %org_run_id,
        org_name = %org_name,
        member_sessions = created_session_ids.len(),
        "[session_launch] materialized Agent Org member sessions"
    );
    Ok(created_session_ids)
}

fn flatten_org_members(members: &[OrgMember]) -> Vec<OrgMember> {
    let mut flattened = Vec::new();
    for member in members {
        flattened.push(member.clone());
        flattened.extend(flatten_org_members(&member.children));
    }
    flattened
}

#[allow(clippy::too_many_arguments)]
async fn send_initial_turn(
    state: &AgentAppState,
    session_id: &str,
    content: String,
    model: Option<String>,
    account_id: Option<String>,
    workspace_root: String,
    native_harness_type: Option<core_types::providers::NativeHarnessType>,
    mode: Option<String>,
    images: Option<Vec<String>>,
    ide_context: Option<IdeContext>,
    agent_definition_id: Option<String>,
    sub_agent_ids: Vec<String>,
) -> Result<(), String> {
    if sub_agent_ids.is_empty() {
        crate::state::commands::session::message::send_message_impl(
            state,
            session_id.to_string(),
            content,
            None,
            crate::state::commands::session::identity::IdentityOverrides {
                model,
                account_id,
                workspace_root: Some(workspace_root),
                native_harness_type,
            },
            mode,
            images,
            ide_context,
            false,
            false,
            None,
        )
        .await?;
        return Ok(());
    }

    let model = model.ok_or_else(|| "model is required for sub-agent launch".to_string())?;
    let launch_spec = crate::init::launch_spec::AgentLaunchSpec::work_item_session(
        state,
        session_id,
        &model,
        account_id.as_deref().unwrap_or_default(),
        std::path::PathBuf::from(&workspace_root),
        agent_definition_id.as_deref(),
        &sub_agent_ids,
    )
    .await?;
    crate::init::init_session(state, launch_spec).await?;

    crate::state::commands::session::message::send_message_impl(
        state,
        session_id.to_string(),
        content,
        None,
        crate::state::commands::session::identity::IdentityOverrides {
            model: Some(model),
            account_id,
            workspace_root: Some(workspace_root),
            native_harness_type,
        },
        mode,
        images,
        ide_context,
        false,
        false,
        None,
    )
    .await?;
    Ok(())
}

fn provenance_fields(
    provenance: &LaunchProvenance,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    match provenance {
        LaunchProvenance::UserSession => (None, None, None, None),
        LaunchProvenance::WorkItem {
            project_slug,
            work_item_id,
            agent_role,
        } => (
            Some(project_slug.clone()),
            Some(work_item_id.clone()),
            agent_role.clone(),
            None,
        ),
        LaunchProvenance::RoutineFire {
            routine_fire_id, ..
        } => (None, None, None, Some(routine_fire_id.clone())),
    }
}

async fn prepare_rust_agent_workspace_for_launch(
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

fn broadcast_launch_send_error(session_id: &str, message: &str) {
    let error = StreamingError::new(
        message.to_string(),
        classify_streaming_error_message(message),
    );
    broadcast_agent_error_structured(session_id, &error);
}

async fn mark_session_failed(session_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let Some(mut record) =
            crate::session::persistence::get_session(&session_id).map_err(|err| err.to_string())?
        else {
            return Ok(());
        };
        record.status = crate::session::SessionStatus::Failed.as_str().to_string();
        record.updated_at = chrono::Utc::now().to_rfc3339();
        crate::session::persistence::upsert_session(&record).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

async fn acquire_work_item_execution_lock(
    project_slug: &str,
    work_item_id: &str,
    session_id: &str,
    agent_role: Option<&str>,
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
            project_types::WorkItemExecutionLockReason::ManualStart,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

async fn release_work_item_execution_lock_if_present(
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

async fn cleanup_session_after_org_run_create_failure(session_id: String) {
    let cleanup = tokio::task::spawn_blocking(move || {
        crate::session::persistence::delete_session(&session_id)
    })
    .await;

    match cleanup {
        Ok(Ok(())) => {}
        Ok(Err(err)) => tracing::warn!(
            error = %err,
            "[session_launch] failed to clean up session after Agent Org run creation failure"
        ),
        Err(err) => tracing::warn!(
            error = %err,
            "[session_launch] failed to join cleanup after Agent Org run creation failure"
        ),
    }
}

fn derive_name(explicit: Option<&str>, content: &str) -> String {
    if let Some(name) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        return name.to_string();
    }
    let first_line = content.lines().find(|line| !line.trim().is_empty());
    let seed = first_line.unwrap_or("New session").trim();
    let truncated: String = seed.chars().take(MAX_AUTO_NAME_LEN).collect();
    if truncated.is_empty() {
        "New session".to_string()
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_member_launch_overrides_to_snapshot, member_runtime_account_id,
        member_runtime_key_source, member_runtime_model, member_runtime_native_harness_type,
        member_runtime_tier, validate_launch_agent_definitions,
    };
    use crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID;
    use crate::definitions::builtin::SDE_AGENT_ID;
    use crate::definitions::orgs::{
        HierarchyMode, OrgDefinition, OrgMember, OrgMemberLaunchOverride, OrgMemberRuntimeConfig,
    };
    use core_types::key_source::KeySource;
    use std::collections::HashMap;

    #[test]
    fn launch_validation_rejects_missing_agent_definition_before_session_create() {
        let _sandbox = test_helpers::test_env::sandbox();

        let error = validate_launch_agent_definitions(Some("custom:missing-launch-agent"), None)
            .expect_err("missing explicit definition must fail before session creation");

        assert!(error.contains("custom:missing-launch-agent"), "{error}");
        assert!(error.contains("does not exist"), "{error}");
    }

    fn valid_org_with_children(children: Vec<OrgMember>) -> OrgDefinition {
        OrgDefinition {
            id: "test:member-id-org".to_string(),
            name: "Member Id Org".to_string(),
            role: "Coordinator".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            description: None,
            hierarchy_mode: HierarchyMode::Soft,
            children,
        }
    }

    #[test]
    fn launch_overrides_apply_recursively_to_effective_org_snapshot() {
        let mut org = valid_org_with_children(vec![OrgMember {
            id: "lead".to_string(),
            name: "Lead".to_string(),
            role: "Lead".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: vec![OrgMember {
                id: "child".to_string(),
                name: "Child".to_string(),
                role: "Worker".to_string(),
                agent_id: SDE_AGENT_ID.to_string(),
                runtime_config: None,
                children: Vec::new(),
            }],
        }]);
        let mut overrides = HashMap::new();
        overrides.insert(
            "child".to_string(),
            OrgMemberLaunchOverride {
                agent_id: Some("cli:claude_code".to_string()),
                runtime_config: Some(OrgMemberRuntimeConfig {
                    key_source: Some("own_key".to_string()),
                    account_id: Some("account-child".to_string()),
                    model: Some("child-model".to_string()),
                    ..Default::default()
                }),
            },
        );

        apply_member_launch_overrides_to_snapshot(&mut org.children, &overrides)
            .expect("override should apply");

        let child = &org.children[0].children[0];
        assert_eq!(child.agent_id, "cli:claude_code");
        let runtime_config = child.runtime_config.as_ref().expect("runtime config");
        assert_eq!(runtime_config.account_id.as_deref(), Some("account-child"));
        assert_eq!(runtime_config.model.as_deref(), Some("child-model"));
    }

    #[test]
    fn launch_overrides_reject_unknown_member_ids() {
        let mut org = valid_org_with_children(vec![OrgMember {
            id: "lead".to_string(),
            name: "Lead".to_string(),
            role: "Lead".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        }]);
        let mut overrides = HashMap::new();
        overrides.insert(
            "missing".to_string(),
            OrgMemberLaunchOverride {
                agent_id: Some("cli:claude_code".to_string()),
                runtime_config: None,
            },
        );

        let error = apply_member_launch_overrides_to_snapshot(&mut org.children, &overrides)
            .expect_err("unknown member override must fail");

        assert!(error.contains("missing"), "{error}");
    }

    #[test]
    fn member_runtime_resolution_prefers_member_config_then_falls_back() {
        let fallback_model = Some("fallback-model".to_string());
        let fallback_account = Some("fallback-account".to_string());
        let fallback_harness = Some("cursor_native".to_string());
        let config = OrgMemberRuntimeConfig {
            key_source: Some("hosted_key".to_string()),
            account_id: Some(" member-account ".to_string()),
            model: None,
            listing_model: Some(" listing-model ".to_string()),
            native_harness_type: Some("cursor_native".to_string()),
            tier: Some("premium".to_string()),
            ..Default::default()
        };

        assert_eq!(
            member_runtime_model(Some(&config), &fallback_model).as_deref(),
            Some("listing-model")
        );
        assert_eq!(
            member_runtime_account_id(Some(&config), &fallback_account).as_deref(),
            Some("member-account")
        );
        assert_eq!(
            member_runtime_tier(Some(&config)).as_deref(),
            Some("premium")
        );
        assert_eq!(
            member_runtime_key_source(Some(&config), &KeySource::OwnKey).expect("key source"),
            KeySource::HostedKey
        );
        assert_eq!(
            member_runtime_native_harness_type(Some(&config), &fallback_harness)
                .expect("native harness")
                .as_deref(),
            Some("cursor_native")
        );
    }

    #[test]
    fn launch_validation_rejects_agent_org_with_missing_member_definition() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = OrgDefinition {
            id: "test:missing-member-org".to_string(),
            name: "Missing Member Org".to_string(),
            role: "Coordinator".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            description: None,
            hierarchy_mode: HierarchyMode::Soft,
            children: vec![OrgMember {
                id: "worker".to_string(),
                name: "Worker".to_string(),
                role: "Builder".to_string(),
                agent_id: "custom:deleted-worker".to_string(),
                runtime_config: None,
                children: Vec::new(),
            }],
        };

        let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
            .expect_err("missing org member definition must fail before materialization");

        assert!(error.contains("Missing Member Org"), "{error}");
        assert!(error.contains("custom:deleted-worker"), "{error}");
    }

    #[test]
    fn launch_validation_accepts_cli_member_reference_without_agent_definition() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = valid_org_with_children(vec![OrgMember {
            id: "cli-worker".to_string(),
            name: "CLI Worker".to_string(),
            role: "Builder".to_string(),
            agent_id: "cli:claude_code".to_string(),
            runtime_config: None,
            children: Vec::new(),
        }]);

        validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
            .expect("CLI member reference must not require an AgentDefinition row");
    }

    #[test]
    fn launch_validation_rejects_duplicate_member_ids() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = valid_org_with_children(vec![
            OrgMember {
                id: "worker".to_string(),
                name: "Worker A".to_string(),
                role: "Builder".to_string(),
                agent_id: SDE_AGENT_ID.to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
            OrgMember {
                id: "worker".to_string(),
                name: "Worker B".to_string(),
                role: "Reviewer".to_string(),
                agent_id: SDE_AGENT_ID.to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
        ]);

        let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
            .expect_err("duplicate member_id must fail before session creation");

        assert!(error.contains("duplicate member_id"), "{error}");
        assert!(error.contains("worker"), "{error}");
    }

    #[test]
    fn launch_validation_rejects_reserved_and_empty_member_ids() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = valid_org_with_children(vec![
            OrgMember {
                id: COORDINATOR_MEMBER_ID.to_string(),
                name: "Reserved".to_string(),
                role: "Builder".to_string(),
                agent_id: SDE_AGENT_ID.to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
            OrgMember {
                id: " ".to_string(),
                name: "Blank".to_string(),
                role: "Reviewer".to_string(),
                agent_id: SDE_AGENT_ID.to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
        ]);

        let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
            .expect_err("invalid member_id values must fail before session creation");

        assert!(error.contains("reserved id"), "{error}");
        assert!(error.contains("empty id"), "{error}");
    }
}
