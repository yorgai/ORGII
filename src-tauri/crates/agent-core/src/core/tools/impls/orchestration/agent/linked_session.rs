//! Instance counting + LinkedSession tracking for subagents.
//!
//! When the parent session is tied to a work item (`work_item_id` set),
//! every subagent launch appends a
//! `LinkedSession` entry on the work item's frontmatter so the work-item
//! view can show which subagents ran, their status, tokens, and a result
//! preview. When no work item is associated, all methods short-circuit
//! and do nothing — this is the common case for ad-hoc sessions.

use tracing::warn;

use core_types::workflow::{AgentRole, LinkedSession, LinkedSessionStatus, LinkedSessionType};
use project_management::orchestrator::state_machine;
use project_management::projects::io as projects_io;

use super::AgentTool;
use crate::definitions::schema::DEFAULT_MAX_SUBAGENT_INSTANCES;
use crate::tools::traits::ToolError;

impl AgentTool {
    /// Increment and return the monotonic launch count for `agent_id`.
    /// Returns `Err` when the count would exceed the agent's `max_instances`
    /// cap, preventing unbounded delegation loops.
    pub(super) async fn next_instance_number(
        &self,
        agent_id: &str,
        max_instances: Option<u32>,
    ) -> Result<u32, ToolError> {
        let limit = max_instances.unwrap_or(DEFAULT_MAX_SUBAGENT_INSTANCES);
        let mut counts = self.instance_counts.lock().await;
        let count = counts.entry(agent_id.to_string()).or_insert(0);
        *count += 1;
        if *count > limit {
            return Err(ToolError::ExecutionFailed(format!(
                "Maximum subagent instances ({limit}) reached for agent '{agent_id}' in this session. \
                 Use background mode and await completion before spawning more."
            )));
        }
        Ok(*count)
    }

    pub(super) async fn write_linked_session(
        &self,
        subagent_session_id: &str,
        parent_session_id: &str,
        agent_name: &str,
        instance_number: u32,
    ) {
        let wid = match &self.config.work_item_id {
            Some(wid) => wid.clone(),
            None => return,
        };

        let sid = subagent_session_id.to_string();
        let parent_sid = parent_session_id.to_string();
        let name = agent_name.to_string();

        let join_result = tokio::task::spawn_blocking(move || {
            let projects = match projects_io::read_all_projects() {
                Ok(list) => list,
                Err(err) => {
                    warn!(
                        "[agent] read_all_projects while writing LinkedSession for {}: {}; skipping",
                        sid, err
                    );
                    return;
                }
            };
            for project in &projects {
                let items = match projects_io::read_all_work_items(&project.slug) {
                    Ok(list) => list,
                    Err(err) => {
                        warn!(
                            "[agent] read_all_work_items({}) while writing LinkedSession for {}: {}; project skipped",
                            project.slug, sid, err
                        );
                        continue;
                    }
                };
                if items.iter().any(|wi| wi.frontmatter.short_id == wid) {
                    if let Err(err) = state_machine::mutate_work_item(&project.slug, &wid, |fm| {
                        fm.linked_sessions.push(LinkedSession {
                            session_id: sid.clone(),
                            session_type: LinkedSessionType::Native,
                            agent_role: AgentRole::SubAgent,
                            started_at: chrono::Utc::now().to_rfc3339(),
                            completed_at: None,
                            status: LinkedSessionStatus::Running,
                            cost_usd: 0.0,
                            total_tokens: 0,
                            parent_session_id: Some(parent_sid.clone()),
                            sub_agent_name: Some(name.clone()),
                            sub_agent_instance: Some(instance_number),
                            result_preview: None,
                        });
                        state_machine::TransitionResult::Completed
                    }) {
                        warn!(
                            "[agent] mutate_work_item({}/{}) appending LinkedSession {}: {}; UI will not show this subagent",
                            project.slug, wid, sid, err
                        );
                    }
                    break;
                }
            }
        })
        .await;

        if let Err(err) = join_result {
            warn!(
                "[agent] Failed to write LinkedSession for {}: {}",
                subagent_session_id, err
            );
        }
    }

    pub(super) async fn update_linked_session(
        &self,
        subagent_session_id: &str,
        status: LinkedSessionStatus,
        tokens: i64,
        preview: &str,
    ) {
        let wid = match &self.config.work_item_id {
            Some(wid) => wid.clone(),
            None => return,
        };

        let sid = subagent_session_id.to_string();
        let preview = preview.to_string();

        let join_result = tokio::task::spawn_blocking(move || {
            apply_linked_session_update(&wid, &sid, status, tokens, &preview);
        })
        .await;

        if let Err(err) = join_result {
            warn!(
                "[agent] Failed to update LinkedSession for {}: {}",
                subagent_session_id, err
            );
        }
    }

    /// Synchronous version used from the background-task `tokio::spawn`
    /// closure, where we are already inside a spawned task and re-wrapping
    /// with `spawn_blocking` would be pointless.
    pub(super) fn update_linked_session_sync(
        wid: &str,
        subagent_session_id: &str,
        status: LinkedSessionStatus,
        tokens: i64,
        preview: &str,
    ) {
        apply_linked_session_update(wid, subagent_session_id, status, tokens, preview);
    }
}

/// Shared kernel for `update_linked_session` (async) and
/// `update_linked_session_sync` (sync). Both paths ultimately do the same
/// DB mutation; the async variant just hands off to a blocking
/// pool first.
fn apply_linked_session_update(
    wid: &str,
    subagent_session_id: &str,
    status: LinkedSessionStatus,
    tokens: i64,
    preview: &str,
) {
    let projects = match projects_io::read_all_projects() {
        Ok(list) => list,
        Err(err) => {
            warn!(
                "[agent] read_all_projects while updating LinkedSession for {}: {}; skipping",
                subagent_session_id, err
            );
            return;
        }
    };
    for project in &projects {
        let items = match projects_io::read_all_work_items(&project.slug) {
            Ok(list) => list,
            Err(err) => {
                warn!(
                    "[agent] read_all_work_items({}) while updating LinkedSession for {}: {}; project skipped",
                    project.slug, subagent_session_id, err
                );
                continue;
            }
        };
        if items.iter().any(|wi| wi.frontmatter.short_id == wid) {
            if let Err(err) = state_machine::mutate_work_item(&project.slug, wid, |fm| {
                if let Some(ls) = fm
                    .linked_sessions
                    .iter_mut()
                    .find(|ls| ls.session_id == subagent_session_id)
                {
                    ls.status = status.clone();
                    ls.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    ls.total_tokens = tokens as u64;
                    ls.result_preview = Some(preview.to_string());
                }
                state_machine::TransitionResult::Completed
            }) {
                warn!(
                    "[agent] mutate_work_item({}/{}) updating LinkedSession {}: {}; UI status will be stale",
                    project.slug, wid, subagent_session_id, err
                );
            }
            break;
        }
    }
}
