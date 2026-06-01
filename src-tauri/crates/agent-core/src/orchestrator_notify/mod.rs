//! Orchestrator notification, review feedback extraction, and proof-of-work collection.

use crate::persistence::db_helpers::AgentSessionStatus;
use crate::session::persistence as session_persistence;

/// Notify the orchestrator that a session reached a terminal state.
pub async fn notify_orchestrator_session_terminal(
    session_id: &str,
    status: AgentSessionStatus,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<(), String> {
    tracing::debug!(
        "[orchestrator] notify_orchestrator_session_terminal called: session={}, status={:?}",
        session_id,
        status
    );

    let sid = session_id.to_string();
    let session = tokio::task::spawn_blocking(move || session_persistence::get_session(&sid))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;

    let session = match session {
        Some(session) => session,
        None => {
            tracing::warn!("[orchestrator] Session not found in DB: {}", session_id);
            return Ok(());
        }
    };

    let work_item_id = match session.work_item_id {
        Some(ref wid) if !wid.is_empty() => wid.clone(),
        _ => {
            tracing::debug!(
                "[orchestrator] Session {} has no work_item_id, skipping",
                session_id
            );
            return Ok(());
        }
    };

    let workspace_path = match session.workspace_path {
        Some(ref path) if !path.is_empty() => path.clone(),
        _ => {
            tracing::debug!(
                "[orchestrator] Session {} has no workspace_path, skipping",
                session_id
            );
            return Ok(());
        }
    };

    let worktree_path = session
        .worktree_path
        .as_ref()
        .filter(|p| !p.is_empty())
        .cloned();

    let session_id_owned = session.session_id.clone();
    let total_tokens = session.total_tokens as u64;
    let db_project_slug = session.project_slug.clone();

    tracing::debug!(
        "[orchestrator] Transitioning work_item={}, workspace_path={}, slug={:?}",
        work_item_id,
        workspace_path,
        db_project_slug
    );

    let transition_result = tokio::task::spawn_blocking(move || {
        use project_management::orchestrator::state_machine;
        use core_types::workflow::LinkedSessionStatus;

        let apply_transition = |slug: &str| -> Result<state_machine::TransitionResult, String> {
            state_machine::mutate_work_item(
                slug,
                &work_item_id,
                |frontmatter| {
                    let linked_status = match status {
                        AgentSessionStatus::Completed => {
                            LinkedSessionStatus::Completed
                        }
                        AgentSessionStatus::Failed => {
                            LinkedSessionStatus::Failed
                        }
                        AgentSessionStatus::Cancelled => {
                            LinkedSessionStatus::Cancelled
                        }
                        _ => LinkedSessionStatus::Completed,
                    };

                    let agent_role = frontmatter
                        .linked_sessions
                        .iter()
                        .find(|ls| ls.session_id == session_id_owned)
                        .map(|ls| ls.agent_role.clone());

                    state_machine::complete_linked_session(
                        frontmatter,
                        &session_id_owned,
                        linked_status,
                        0.0,
                        total_tokens,
                    );

                    use core_types::workflow::{AgentRole, OrchestratorPhase};
                    let effective_role = agent_role.or_else(|| {
                        let phase = frontmatter
                            .orchestrator_state
                            .as_ref()
                            .map(|s| &s.current_phase);
                        match phase {
                            Some(OrchestratorPhase::Review) => {
                                tracing::debug!(
                                    "[orchestrator] Session {} not in linked_sessions, inferring Review from phase",
                                    session_id_owned
                                );
                                Some(AgentRole::Review)
                            }
                            _ => None,
                        }
                    });

                    match effective_role {
                        Some(AgentRole::Review) => match status {
                            AgentSessionStatus::Completed => {
                                let review_result = extract_review_feedback(
                                    &session_id_owned,
                                );
                                let outcome = review_result
                                    .as_ref()
                                    .map(|rf| rf.outcome.clone())
                                    .unwrap_or(project_management::projects::types::ReviewOutcome::Approved);

                                if let Some(feedback) = review_result {
                                    project_management::orchestrator::proof_of_work::set_review_feedback(
                                        frontmatter,
                                        feedback,
                                    );
                                }

                                state_machine::on_review_complete(frontmatter, &outcome)
                            }
                            AgentSessionStatus::Failed => {
                                state_machine::on_review_failed(
                                    frontmatter,
                                    &session_id_owned,
                                    "Review session failed",
                                )
                            }
                            _ => {
                                state_machine::cancel(frontmatter);
                                state_machine::TransitionResult::Completed
                            }
                        },
                        _ => match status {
                            AgentSessionStatus::Completed => {
                                let diff_repo = worktree_path.as_deref().unwrap_or(&workspace_path);
                                collect_proof_of_work(frontmatter, diff_repo);
                                state_machine::on_session_complete(frontmatter)
                            }
                            AgentSessionStatus::Failed => {
                                state_machine::on_session_failed(
                                    frontmatter,
                                    &session_id_owned,
                                    "Session failed",
                                )
                            }
                            _ => {
                                state_machine::cancel(frontmatter);
                                state_machine::TransitionResult::Completed
                            }
                        },
                    }
                },
            )
        };

        if let Some(ref slug) = db_project_slug {
            tracing::debug!(
                "[orchestrator] Applying transition with slug='{}' for work_item={}",
                slug,
                work_item_id
            );
            match apply_transition(slug) {
                Ok(tr) => {
                    tracing::debug!(
                        "[orchestrator] Transition succeeded for work_item={}: {:?}",
                        work_item_id,
                        tr
                    );
                    return Some(tr);
                }
                Err(err) => {
                    tracing::warn!(
                        "[orchestrator] Failed to transition work item {}: {}",
                        work_item_id,
                        err
                    );
                    return None;
                }
            }
        }

        // Fall-back path: no slug from DB, so we scan every project for
        // a matching short_id. DB read errors here previously vanished
        // into `unwrap_or_default()` and made it look like "no project
        // owns this work item" — surface them as warnings so the real
        // failure (locked DB, schema mismatch) is visible instead of
        // silently skipping the transition.
        let projects = match project_management::projects::io::read_all_projects() {
            Ok(list) => list,
            Err(err) => {
                tracing::warn!(
                    "[orchestrator] read_all_projects failed: {}; cannot resolve work_item={}",
                    err,
                    work_item_id
                );
                return None;
            }
        };

        for project in &projects {
            let work_items =
                match project_management::projects::io::read_all_work_items(&project.slug) {
                    Ok(list) => list,
                    Err(err) => {
                        tracing::warn!(
                            "[orchestrator] read_all_work_items({}) failed: {}; \
                             skipping this project for work_item={}",
                            project.slug,
                            err,
                            work_item_id
                        );
                        continue;
                    }
                };

            let has_item = work_items
                .iter()
                .any(|wi| wi.frontmatter.short_id == work_item_id);

            if !has_item {
                continue;
            }

            match apply_transition(&project.slug) {
                Ok(tr) => return Some(tr),
                Err(err) => {
                    tracing::warn!(
                        "[orchestrator] Failed to transition work item {}: {}",
                        work_item_id,
                        err
                    );
                    return None;
                }
            }
        }

        None
    })
    .await
    .map_err(|err| {
        tracing::error!("[orchestrator] spawn_blocking join error: {}", err);
        err.to_string()
    })?;

    tracing::debug!(
        "[orchestrator] transition_result={:?} for session {}",
        transition_result,
        session_id
    );

    if let Some(ref tr) = transition_result {
        if let Some(handle) = app_handle {
            use project_management::orchestrator::state_machine::TransitionResult;
            use tauri::Emitter;
            let ts = chrono::Utc::now().to_rfc3339();
            let _ = handle.emit(
                project_management::projects::events::DATA_CHANGED_EVENT,
                &ts,
            );

            match tr {
                TransitionResult::Completed | TransitionResult::Failed => {
                    // Work-item learning pipeline removed. Learnings are now
                    // extracted exclusively through the
                    // agent session's post-session reflection path
                    // (see agent_core/core/session/reflection.rs), gated by
                    // the per-agent `learnings.enabled` switch.
                }
                TransitionResult::LaunchReview => {
                    tracing::info!(
                        "[orchestrator] Review launch requested for session {}",
                        session_id
                    );
                }
                TransitionResult::LaunchFix => {
                    tracing::info!(
                        "[orchestrator] Fix launch requested after review feedback for session {}",
                        session_id
                    );
                }
                TransitionResult::RetryAgent => {
                    tracing::warn!(
                        "[orchestrator] Agent retry requested for session {} but automated retry is not yet implemented",
                        session_id
                    );
                }
                TransitionResult::CreateFollowUp => {
                    tracing::warn!(
                        "[orchestrator] Follow-up creation requested for session {} but not yet implemented",
                        session_id
                    );
                }
                TransitionResult::AwaitingUser => {
                    tracing::debug!("[orchestrator] Session {} awaiting user action", session_id);
                }
            }
        }
    }

    Ok(())
}

mod handlers;
use handlers::{collect_proof_of_work, extract_review_feedback};

#[cfg(test)]
pub(crate) use handlers::{
    extract_first_sentence, parse_file_location, parse_issue_line, parse_structured_review_block,
};

#[cfg(test)]
#[path = "../tests/orchestrator_notify_tests.rs"]
mod tests;
