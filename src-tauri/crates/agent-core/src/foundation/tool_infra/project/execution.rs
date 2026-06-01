//! Work Item Execution - launching agent sessions for work items.

use project_management::projects::{io, types::*};

use super::helpers::run_blocking;

/// Build a project-specific task prompt from work item content.
pub(crate) fn build_project_prompt(
    short_id: &str,
    frontmatter: &WorkItemFrontmatter,
    body: &str,
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Implement the following work item: {}", short_id));
    parts.push(format!("\n## Title\n{}", frontmatter.title));
    if !body.is_empty() {
        parts.push(format!("\n## Description\n{}", body));
    }
    if !frontmatter.todos.is_empty() {
        parts.push("\n## Acceptance Criteria".to_string());
        for todo in &frontmatter.todos {
            let check = if todo.status == super::helpers::TODO_STATUS_COMPLETED {
                "x"
            } else {
                " "
            };
            parts.push(format!("- [{}] {}", check, todo.content));
        }
    }
    parts.push(format!(
        "\n## Instructions\n\
         - Create a feature branch for this work item if one does not already exist\n\
         - Implement all changes needed to satisfy the description and acceptance criteria above\n\
         - Write or update tests where appropriate\n\
         - Run tests and lint to verify your changes\n\
         - Commit your changes with clear messages referencing {}",
        short_id
    ));
    parts.join("\n")
}

/// Build a generic agent task prompt (no project-specific instructions).
///
/// The agent's `soul_content` defines its behavior; this prompt only provides
/// the work item context (title, description, acceptance criteria).
pub(crate) fn build_agent_prompt(
    short_id: &str,
    frontmatter: &WorkItemFrontmatter,
    body: &str,
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Execute the following work item: {}", short_id));
    parts.push(format!("\n## Title\n{}", frontmatter.title));
    if !body.is_empty() {
        parts.push(format!("\n## Description\n{}", body));
    }
    if !frontmatter.todos.is_empty() {
        parts.push("\n## Acceptance Criteria".to_string());
        for todo in &frontmatter.todos {
            let check = if todo.status == super::helpers::TODO_STATUS_COMPLETED {
                "x"
            } else {
                " "
            };
            parts.push(format!("- [{}] {}", check, todo.content));
        }
    }
    parts.join("\n")
}

fn parse_agent_defs_for_execution(
    content: &str,
    path: &std::path::Path,
) -> Result<Vec<crate::definitions::AgentDefinition>, String> {
    serde_json::from_str(content).map_err(|err| {
        format!(
            "parse agent definitions for work-item launch from {}: {}",
            path.display(),
            err
        )
    })
}

fn parse_agent_orgs_for_execution(
    content: &str,
    path: &std::path::Path,
) -> Result<Vec<crate::definitions::orgs::OrgDefinition>, String> {
    serde_json::from_str(content).map_err(|err| {
        format!(
            "parse agent organizations for work-item launch from {}: {}",
            path.display(),
            err
        )
    })
}

/// `#[doc(hidden)]` — only the `app::api::agent::test::core` debug
/// route calls this, via the `agent_core::tool_infra::*` re-export.
#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn debug_parse_work_item_launch_sources(kind: &str, content: &str) -> Result<usize, String> {
    match kind {
        "agent_definitions" => parse_agent_defs_for_execution(
            content,
            std::path::Path::new("work-item-agent-definitions-test.json"),
        )
        .map(|items| items.len()),
        "agent_orgs" => parse_agent_orgs_for_execution(
            content,
            std::path::Path::new("work-item-agent-orgs-test.json"),
        )
        .map(|items| items.len()),
        _ => Err(format!("unknown work-item launch source kind: {kind}")),
    }
}

/// Load a full AgentDefinition by its ID (for account/model resolution).
fn load_agent_def(def_id: &str) -> Result<crate::definitions::AgentDefinition, String> {
    let store = crate::definitions::AgentDefinitionsStore::new();
    if crate::definitions::builtin::is_builtin_agent(def_id) {
        return crate::definitions::resolve_definition_by_id(def_id, Some(&store));
    }

    let defs_path = app_paths::agent_definitions();
    if !defs_path.exists() {
        return Err(format!(
            "agent definition '{}' is referenced by the work item but {} does not exist",
            def_id,
            defs_path.display()
        ));
    }
    let content = std::fs::read_to_string(&defs_path).map_err(|err| {
        format!(
            "read agent definitions for work-item launch from {}: {}",
            defs_path.display(),
            err
        )
    })?;
    let defs = parse_agent_defs_for_execution(&content, &defs_path)?;
    defs.into_iter()
        .find(|definition| definition.id == def_id)
        .ok_or_else(|| {
            format!(
                "agent definition '{}' is referenced by the work item but was not found in {}",
                def_id,
                defs_path.display()
            )
        })
}

/// Resolve agent_definition_id from assignee when not explicitly set in config.
fn resolve_agent_def_id_from_assignee(
    frontmatter: &WorkItemFrontmatter,
) -> Result<Option<String>, String> {
    match frontmatter.assignee_type.as_deref() {
        Some("agent") => Ok(frontmatter.assignee.clone().filter(|s| !s.is_empty())),
        Some("org") => {
            let Some(org_id) = frontmatter.assignee.as_deref().filter(|s| !s.is_empty()) else {
                return Ok(None);
            };
            let orgs_path = app_paths::agent_orgs();
            if !orgs_path.exists() {
                return Err(format!(
                    "agent organization '{}' is referenced by the work item but {} does not exist",
                    org_id,
                    orgs_path.display()
                ));
            }
            let content = std::fs::read_to_string(&orgs_path).map_err(|err| {
                format!(
                    "read agent organizations for work-item launch from {}: {}",
                    orgs_path.display(),
                    err
                )
            })?;
            let orgs = parse_agent_orgs_for_execution(&content, &orgs_path)?;
            let org = orgs
                .iter()
                .find(|org| org.id == org_id)
                .ok_or_else(|| {
                    format!(
                        "agent organization '{}' is referenced by the work item but was not found in {}",
                        org_id,
                        orgs_path.display()
                    )
                })?;
            if org.agent_id.is_empty() {
                return Err(format!(
                    "agent organization '{}' has an empty agent_id and cannot launch a work item",
                    org_id
                ));
            }
            Ok(Some(org.agent_id.clone()))
        }
        _ => Ok(None),
    }
}

/// Start a work item's orchestrator workflow and launch an agent session.
///
/// Does everything the frontend does in one call:
///   1. Validates orchestrator config (must have account_id)
///   2. Runs orchestrator_start (snapshot config, set phase)
///   3. Builds the agent prompt from work item content
///   4. Creates and starts an agent session in background
///
/// The host repo for the agent session is resolved from
/// `frontmatter.orchestrator_config.worktree_path` first, then from the
/// project's `linked_repos[0]`. Returns a human-readable summary with the
/// session ID.
///
/// When `session_account_id` is set (non-empty), that account is used for the
/// agent session launch even if the work item omits `selected_account_id`.
/// Model resolution: session override (`session_model_id`) if non-empty,
/// otherwise `selected_model_id` from the work item.
pub async fn start_work_item(
    project_slug: &str,
    short_id: &str,
    app: &tauri::AppHandle,
    session_account_id: Option<&str>,
    session_model_id: Option<&str>,
) -> Result<String, String> {
    use project_management::orchestrator::state_machine;

    let slug = project_slug.to_string();
    let sid = short_id.to_string();

    let data = run_blocking("start_read_work_item", {
        let slug = slug.clone();
        let sid = sid.clone();
        move || io::read_work_item(&slug, &sid)
    })
    .await?;

    let config = data
        .frontmatter
        .orchestrator_config
        .clone()
        .unwrap_or_default();

    let agent_def_id = match config.agent_definition_id.clone().filter(|s| !s.is_empty()) {
        Some(definition_id) => Some(definition_id),
        None => resolve_agent_def_id_from_assignee(&data.frontmatter)?,
    };

    let agent_def = match agent_def_id.as_ref() {
        Some(definition_id) => Some(tokio::task::block_in_place(|| {
            load_agent_def(definition_id)
        })?),
        None => None,
    };

    let config_account = config.selected_account_id.clone();
    let config_model = config.selected_model_id.clone();

    let (account_id, model_id) = if let Some(session_acct) =
        session_account_id.filter(|s| !s.is_empty())
    {
        let from_session = session_model_id.filter(|s| !s.is_empty());
        let from_agent_def = agent_def
            .as_ref()
            .and_then(|d| d.selected_model_id.as_ref())
            .filter(|s| !s.is_empty());
        let from_item = config_model.as_ref().filter(|s| !s.is_empty());
        let model_id = if let Some(m) = from_session {
            m.to_string()
        } else if let Some(m) = from_agent_def {
            m.clone()
        } else if let Some(m) = from_item {
            m.clone()
        } else {
            return Err(
                "Cannot start: session has a code account but no model. \
                 Set the agent model in settings or configure selected_model_id on the work item."
                    .to_string(),
            );
        };
        (session_acct.to_string(), model_id)
    } else {
        let def_account = agent_def
            .as_ref()
            .and_then(|d| d.selected_account_id.clone())
            .filter(|s| !s.is_empty());
        let def_model = agent_def
            .as_ref()
            .and_then(|d| d.selected_model_id.clone())
            .filter(|s| !s.is_empty());

        let account_id = def_account.or(config_account).ok_or(
            "Cannot start: no selected_account_id. Configure a code account on the agent definition or in Agent Settings.",
        )?;
        let model_id = def_model
            .or(config_model.filter(|s| !s.is_empty()))
            .ok_or(
                "Cannot start: selected_model_id is missing. \
                 Set a model on the agent definition or use update_item to set one on the work item.",
            )?;
        (account_id, model_id)
    };

    // Resolve host repo: config.worktree_path → linked_repos first valid dir.
    // The work-item-level `worktree_path` overrides; otherwise we fall back to
    // the project's `linked_repos`.
    let project_data = {
        let slug_for_read = slug.clone();
        run_blocking("read_project_meta", move || {
            io::read_project(&slug_for_read)
        })
        .await?
    };

    let linked_repos: Vec<String> = project_data
        .meta
        .linked_repos
        .iter()
        .filter(|repo| !repo.is_empty())
        .cloned()
        .collect();

    let worktree_path = config
        .worktree_path
        .as_ref()
        .filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir())
        .cloned()
        .or_else(|| {
            linked_repos
                .iter()
                .find(|r| std::path::Path::new(r).is_dir())
                .cloned()
        })
        .ok_or(
            "Cannot start: no host repo. Set the project's linked_repos or the work item's worktree_path."
                .to_string(),
        )?;

    let (agent_role, mut prompt) = if let Some(ref definition) = agent_def {
        let prompt = build_agent_prompt(&sid, &data.frontmatter, &data.body);
        (definition.name.clone(), prompt)
    } else {
        (
            "sde".to_string(),
            build_project_prompt(&sid, &data.frontmatter, &data.body),
        )
    };

    if !linked_repos.is_empty() {
        prompt.push_str("\n\n## Project Workspace\n");
        prompt.push_str(&format!("Primary repo: `{}`\n", worktree_path));
        if linked_repos.len() > 1
            || linked_repos.first().map(|r| r.as_str()) != Some(&worktree_path)
        {
            prompt.push_str("All linked repos:\n");
            for linked_repo in &linked_repos {
                prompt.push_str(&format!("- `{}`\n", linked_repo));
            }
            prompt.push_str(
                "You can navigate to any of these repos if the task requires cross-repo work.\n",
            );
        }
    }

    let linked_role = if agent_def_id.is_some() {
        AgentRole::Custom
    } else {
        AgentRole::Coding
    };

    run_blocking("orchestrator_start", {
        let slug = slug.clone();
        let sid = sid.clone();
        move || {
            io::update_work_item_atomic(&slug, &sid, |frontmatter, _body| {
                let current_phase = frontmatter
                    .orchestrator_state
                    .as_ref()
                    .map(|s| &s.current_phase)
                    .unwrap_or(&OrchestratorPhase::Idle);

                if !matches!(current_phase, OrchestratorPhase::Idle) {
                    return Err(format!(
                        "Cannot start: orchestrator is in phase '{:?}', expected idle",
                        current_phase
                    ));
                }

                state_machine::snapshot_config(frontmatter);
                state_machine::add_linked_session(
                    frontmatter,
                    "pending",
                    linked_role,
                    LinkedSessionType::Native,
                );
                frontmatter.updated_at = chrono::Utc::now().to_rfc3339();
                Ok(())
            })
        }
    })
    .await?;

    {
        use tauri::Emitter;
        let ts = chrono::Utc::now().to_rfc3339();
        let _ = app.emit(
            project_management::projects::events::DATA_CHANGED_EVENT,
            &ts,
        );
    }

    let session_id = crate::session::launch::launch_agent_session(
        app,
        crate::session::launch::WorkItemLaunchRequest {
            workspace_path: &worktree_path,
            prompt: &prompt,
            model: &model_id,
            account_id: &account_id,
            work_item_id: &sid,
            project_slug: &slug,
            worktree_path: Some(&worktree_path),
            agent_definition_id: agent_def_id.as_deref(),
            agent_role: &agent_role,
            sub_agent_ids: config.sub_agent_ids.as_slice(),
        },
    )
    .await?;

    Ok(format!(
        "Started work item {} execution.\n\
         Session: {}\n\
         Agent: {}\n\
         Model: {}\n\
         Account: {}\n\n\
         The agent is now running in the background. \
         Use session(action=\"list\") or session(action=\"get_status\") to check progress.",
        sid, session_id, agent_role, model_id, account_id
    ))
}

#[cfg(test)]
mod tests {
    use super::{parse_agent_defs_for_execution, parse_agent_orgs_for_execution};

    #[test]
    fn parse_agent_defs_for_execution_reports_invalid_json() {
        let err = parse_agent_defs_for_execution("{ invalid", std::path::Path::new("agents.json"))
            .unwrap_err();

        assert!(
            err.contains("parse agent definitions for work-item launch"),
            "got: {err}"
        );
    }

    #[test]
    fn parse_agent_orgs_for_execution_reports_invalid_json() {
        let err = parse_agent_orgs_for_execution("{ invalid", std::path::Path::new("orgs.json"))
            .unwrap_err();

        assert!(
            err.contains("parse agent organizations for work-item launch"),
            "got: {err}"
        );
    }
}
