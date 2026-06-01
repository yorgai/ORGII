//! Internal helpers shared across project submodules.

use crate::tool_infra::FILE_IO_TIMEOUT;
use project_management::projects::io;

/// Wire-format status value for completed TODO items.
pub(crate) const TODO_STATUS_COMPLETED: &str = "completed";

// ============================================
// Internal Helpers
// ============================================

/// Truncate a string to at most `max_bytes`, snapping to the nearest char
/// boundary so we never panic on multi-byte UTF-8 (e.g. Chinese text).
/// Appends "..." when truncation occurs.
pub fn truncate_preview(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

/// Run a blocking closure on `spawn_blocking` with [`FILE_IO_TIMEOUT`].
pub(super) async fn run_blocking<F, T>(label: &str, func: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let label = label.to_string();
    tokio::time::timeout(FILE_IO_TIMEOUT, tokio::task::spawn_blocking(func))
        .await
        .map_err(|_| {
            format!(
                "Project operation timed out after {}s: {}",
                FILE_IO_TIMEOUT.as_secs(),
                label
            )
        })?
        .map_err(|err| format!("Project task failed: {}", err))?
}

/// Resolve a project identifier (slug, display name, or project ID) to its
/// canonical slug.
///
/// Resolution order (first match wins):
/// 1. Exact slug match (input is already a slug)
/// 2. Slugify the input and check (handles display names like "My Project")
/// 3. Scan all projects and match by `meta.id` or case-insensitive name
pub fn resolve_slug(input: &str) -> Result<String, String> {
    let projects = io::read_all_projects()?;

    if projects.iter().any(|project| project.slug == input) {
        return Ok(input.to_string());
    }

    let slugified = slugify(input);
    if slugified != input && projects.iter().any(|project| project.slug == slugified) {
        return Ok(slugified);
    }

    for project in &projects {
        if project.meta.id == input || project.meta.name.eq_ignore_ascii_case(input) {
            return Ok(project.slug.clone());
        }
    }

    Err(format!("Project '{}' not found", input))
}

/// Generate a URL-safe slug from a project name.
pub fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    // Collapse multiple hyphens and trim leading/trailing
    let mut result = String::new();
    let mut prev_hyphen = true; // start true to trim leading -
    for ch in slug.chars() {
        if ch == '-' {
            if !prev_hyphen {
                result.push('-');
            }
            prev_hyphen = true;
        } else {
            result.push(ch);
            prev_hyphen = false;
        }
    }
    if result.ends_with('-') {
        result.pop();
    }
    result
}

/// Current UTC timestamp in ISO 8601 format.
pub(super) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Optional orchestrator config overrides for agent assignment.
/// When provided, merged with defaults to form `orchestrator_config`.
#[derive(Debug, Default)]
pub struct OrchestratorConfigOverrides {
    pub selected_account_id: Option<String>,
    pub selected_model_id: Option<String>,
    pub sub_agent_ids: Vec<String>,
    pub org_id: Option<String>,
    pub agent_definition_id: Option<String>,
    pub worktree_path: Option<String>,
    pub review_config: Option<core_types::workflow::ReviewConfig>,
}
