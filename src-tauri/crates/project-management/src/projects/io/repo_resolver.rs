//! Resolve the on-disk repository path bound to a single work item.
//!
//! Orchestrator commands no longer carry `repo_path` on their public Tauri
//! surface (the slug + work-item-id pair fully identifies the run). Some
//! operations still need a checkout to run pure git ops (branch health
//! checks, `git diff` stats). Those commands look up the bound repo via
//! this resolver.
//!
//! Resolution order:
//! 1. Work item's `frontmatter.orchestrator_config.worktree_path`, when set.
//! 2. The owning project's first entry in `linked_repos`.
//! 3. Otherwise, error — the caller has nowhere to run a git op.

use crate::projects::io::{read_project, read_work_item};

/// Resolve the repo path bound to `(project_slug, work_item_id)`.
pub fn resolve_repo_for_work_item(
    project_slug: &str,
    work_item_id: &str,
) -> Result<String, String> {
    let work_item = read_work_item(project_slug, work_item_id)?;
    if let Some(cfg) = work_item.frontmatter.orchestrator_config.as_ref() {
        if let Some(path) = cfg.worktree_path.as_ref() {
            if !path.is_empty() {
                return Ok(path.clone());
            }
        }
    }

    let project = read_project(project_slug)?;
    if let Some(first_repo) = project.meta.linked_repos.first() {
        if !first_repo.is_empty() {
            return Ok(first_repo.clone());
        }
    }

    Err(format!(
        "No repo bound to work item {} (project {}). Set the project's linked_repos or the work item's worktree_path.",
        work_item_id, project_slug
    ))
}
