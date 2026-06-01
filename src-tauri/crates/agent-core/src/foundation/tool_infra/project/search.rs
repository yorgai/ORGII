//! Cross-project search for work items and projects.
//!
//! Backed by `projects::io` (global SQLite store). Projects are no longer
//! scoped to repositories — there is just one global namespace, so search
//! does not need to walk repos. We do an in-memory case-insensitive
//! substring match against project names, work item titles, and bodies.

use project_management::projects::io;

use super::helpers::run_blocking;

const FIND_MAX_RESULTS: usize = 20;

/// Search work items and projects across the global project store.
///
/// Results capped at [`FIND_MAX_RESULTS`].
pub async fn find_across_workspaces(query: &str) -> Result<String, String> {
    let query = query.to_string();

    run_blocking("find_across_workspaces", move || {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok("No results found for empty query.".to_string());
        }
        let needle = trimmed.to_lowercase();

        let projects = io::read_all_projects()?;

        let mut work_item_hits: Vec<(String, String, String, String)> = Vec::new(); // (slug, short_id, title, status)
        let mut project_hits: Vec<(String, String)> = Vec::new(); // (slug, name)

        for project in &projects {
            if project_hits.len() + work_item_hits.len() >= FIND_MAX_RESULTS {
                break;
            }

            if project.meta.name.to_lowercase().contains(&needle)
                || project.slug.to_lowercase().contains(&needle)
            {
                project_hits.push((project.slug.clone(), project.meta.name.clone()));
            }

            // Silently dropping the items of a project with corrupt
            // or unreadable frontmatter would make `find` truthfully
            // report "no matches" for that project — matching the
            // empty-project case and giving the LLM no signal that
            // results are incomplete. Warn so the failure is visible
            // in logs while preserving the structural contract that
            // search keeps working across the rest of the projects.
            let items = match io::read_all_work_items(&project.slug) {
                Ok(items) => items,
                Err(err) => {
                    tracing::warn!(
                        project = %project.slug,
                        error = %err,
                        "[project::search] read_all_work_items failed; skipping project from results"
                    );
                    Vec::new()
                }
            };
            for item in items {
                if work_item_hits.len() + project_hits.len() >= FIND_MAX_RESULTS {
                    break;
                }
                let fm = &item.frontmatter;
                let title_match = fm.title.to_lowercase().contains(&needle);
                let id_match = fm.short_id.to_lowercase().contains(&needle);
                let body_match = item.body.to_lowercase().contains(&needle);
                if title_match || id_match || body_match {
                    work_item_hits.push((
                        project.slug.clone(),
                        fm.short_id.clone(),
                        fm.title.clone(),
                        fm.status.clone(),
                    ));
                }
            }
        }

        if work_item_hits.is_empty() && project_hits.is_empty() {
            return Ok(format!("No results found for \"{}\".", trimmed));
        }

        let total = work_item_hits.len() + project_hits.len();
        let mut output = format!("Found {} match(es) for \"{}\":\n", total, trimmed);

        if !work_item_hits.is_empty() {
            output.push_str("\nWork Items:\n");
            for (slug, short_id, title, status) in &work_item_hits {
                let title_part = if title.is_empty() {
                    String::new()
                } else {
                    format!(" \"{}\"", title)
                };
                let status_part = if status.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", status)
                };
                output.push_str(&format!(
                    "- [{}]{}{}\n  → project: {}\n",
                    short_id, title_part, status_part, slug
                ));
            }
        }

        if !project_hits.is_empty() {
            output.push_str("\nProjects:\n");
            for (slug, name) in &project_hits {
                output.push_str(&format!("- {} (slug: {})\n", name, slug));
            }
        }

        Ok(output)
    })
    .await
}
