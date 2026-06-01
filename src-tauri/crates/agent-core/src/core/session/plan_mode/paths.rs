//! Plan file path resolution for Plan mode.
//!
//! Layout (mirrors Cursor's `.cursor/plans/` but under `.orgii/plans/`):
//!
//! - **With workspace path**: `{workspace_path}/.orgii/plans/{slug}_{hash}.plan.md`
//! - **Without workspace path**: `~/.orgii/plans/{agent_id}/{slug}_{hash}.plan.md`
//! - **Subagent files**: append `-agent-{sub_agent_id}` before `.plan.md`, so the
//!   parent agent's plan file is never clobbered when a subagent drafts one.
//!
//! Slug is derived from the plan title the LLM supplies to `create_plan`. Hash
//! is a short random token that makes filenames stable-per-plan but unique
//! across plans within the same workspace.

use std::path::{Path, PathBuf};

/// Source-of-truth home-directory lookup. Keeps fallbacks explicit so a missing
/// `$HOME` never silently writes to `/`.
fn resolve_home_dir() -> Option<PathBuf> {
    #[allow(deprecated)]
    std::env::home_dir()
}

/// Context required to resolve a plan file path.
///
/// Fields mirror what `create_plan` has available at call time:
/// - `workspace_path` — from the session's `workspace_path` (None for OS / projectless agents)
/// - `agent_id` — canonical agent id used for projectless fallback
/// - `sub_agent_id` — `Some` when a subagent is writing its own plan
/// - `title` — LLM-supplied plan title (fed into the slug)
/// - `hash` — stable random token; caller owns caching it for the session
#[derive(Debug, Clone)]
pub struct PlanPathCtx<'a> {
    pub workspace_path: Option<&'a str>,
    pub agent_id: &'a str,
    pub sub_agent_id: Option<&'a str>,
    pub title: &'a str,
    pub hash: &'a str,
}

/// Returns the directory that holds plan files for the given context.
///
/// - With a workspace: `{workspace_path}/.orgii/plans`
/// - Without a workspace: `{home}/.orgii/plans/{agent_id}`
///
/// Returns `None` only when both workspace_path is absent and $HOME cannot be
/// resolved — callers must surface that as an error rather than silently
/// write to CWD.
pub fn plans_directory(workspace_path: Option<&Path>, agent_id: &str) -> Option<PathBuf> {
    if let Some(workspace) = workspace_path {
        return Some(workspace.join(".orgii").join("plans"));
    }
    let home = resolve_home_dir()?;
    Some(home.join(".orgii").join("plans").join(agent_id))
}

/// Builds the plan file name. Does NOT include the directory.
///
/// `slug` and `hash` are produced by the caller (see `slugify_plan_title` / `random_hash`).
/// When `sub_agent_id` is `Some`, a `-agent-{id}` marker is inserted before the
/// `.plan.md` suffix so parent/subagent plans coexist.
pub fn plan_file_name(slug: &str, hash: &str, sub_agent_id: Option<&str>) -> String {
    match sub_agent_id {
        Some(child) => format!("{slug}_{hash}-agent-{child}.plan.md"),
        None => format!("{slug}_{hash}.plan.md"),
    }
}

/// Convenience: combine `plans_directory` + `plan_file_name` + slugify_plan_title(title).
///
/// Returns `None` when the directory can't be resolved (see `plans_directory`).
pub fn plan_file_path(ctx: &PlanPathCtx<'_>) -> Option<PathBuf> {
    let dir = plans_directory(ctx.workspace_path.map(Path::new), ctx.agent_id)?;
    let slug = slugify_plan_title(ctx.title);
    let name = plan_file_name(&slug, ctx.hash, ctx.sub_agent_id);
    Some(dir.join(name))
}

/// Slugifies a plan title for use in filenames.
///
/// Rules:
/// - Lowercase ASCII letters and digits survive.
/// - Whitespace and punctuation become `-`.
/// - Multiple dashes collapse into one.
/// - Leading/trailing dashes are trimmed.
/// - Max length 48 chars (cut on a char boundary).
/// - Empty results fall back to `"plan"` so we never produce an empty segment.
pub fn slugify_plan_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut last_was_dash = false;
    for ch in title.chars() {
        let replaced = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else if ch.is_ascii_whitespace() || matches!(ch, '-' | '_' | '/' | '\\' | '.' | ':') {
            '-'
        } else {
            // Drop anything else — full Unicode slugging would need
            // a dependency, and we'd rather be boring than ambiguous.
            continue;
        };
        if replaced == '-' {
            if last_was_dash || out.is_empty() {
                continue;
            }
            last_was_dash = true;
            out.push('-');
        } else {
            last_was_dash = false;
            out.push(replaced);
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 48 {
        // char_indices keeps us on a UTF-8 boundary even though the filtered
        // output should only contain ASCII — belt and suspenders.
        if let Some((cut, _)) = out.char_indices().nth(48) {
            out.truncate(cut);
            while out.ends_with('-') {
                out.pop();
            }
        }
    }
    if out.is_empty() {
        "plan".to_string()
    } else {
        out
    }
}

/// Returns an 8-char lowercase hex token suitable for deduplicating plan
/// filenames within a workspace.
///
/// Deliberately avoids pulling in `rand` as a new dependency — the uniqueness
/// we need is "two plans created seconds apart get different filenames", not
/// cryptographic randomness. Mixing the monotonic clock, wall-clock nanos, and
/// an atomic counter gives a collision probability small enough for plan
/// filenames (and we also have a per-title slug in front of the hash).
pub fn random_hash() -> String {
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    counter.hash(&mut hasher);
    // Wall clock nanos: stable across process IDs, varies every call.
    let wall = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    wall.hash(&mut hasher);
    // Monotonic clock: survives wall-clock resets.
    let mono = Instant::now().elapsed().as_nanos() as u64;
    mono.hash(&mut hasher);

    let digest = hasher.finish();
    let bytes = digest.to_le_bytes();
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_plan_title_basic() {
        assert_eq!(
            slugify_plan_title("Refactor Auth Flow"),
            "refactor-auth-flow"
        );
    }

    #[test]
    fn slugify_plan_title_collapses_punctuation_and_spaces() {
        assert_eq!(
            slugify_plan_title("   Add  Dark::Mode  (Toggle)!  "),
            "add-dark-mode-toggle"
        );
    }

    #[test]
    fn slugify_plan_title_empty_falls_back_to_plan() {
        assert_eq!(slugify_plan_title(""), "plan");
        assert_eq!(slugify_plan_title("  ---  "), "plan");
        assert_eq!(slugify_plan_title("!!!"), "plan");
    }

    #[test]
    fn slugify_plan_title_truncates_at_boundary() {
        let long = "a".repeat(100);
        let slug = slugify_plan_title(&long);
        assert_eq!(slug.len(), 48);
    }

    #[test]
    fn slugify_plan_title_drops_non_ascii() {
        // Keeps plain ASCII rather than letting unicode leak into filenames.
        assert_eq!(slugify_plan_title("改 Refactor 认证 Flow"), "refactor-flow");
    }

    #[test]
    fn random_hash_is_eight_hex_chars() {
        let hash = random_hash();
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn plan_file_name_includes_subagent_marker() {
        let name = plan_file_name("refactor-auth", "deadbeef", Some("sub-123"));
        assert_eq!(name, "refactor-auth_deadbeef-agent-sub-123.plan.md");
    }

    #[test]
    fn plan_file_name_top_level_has_no_marker() {
        let name = plan_file_name("refactor-auth", "deadbeef", None);
        assert_eq!(name, "refactor-auth_deadbeef.plan.md");
    }

    #[test]
    fn plans_directory_prefers_workspace_path() {
        let workspace = Path::new("/tmp/myworkspace");
        let dir = plans_directory(Some(workspace), "agent-xyz").unwrap();
        assert_eq!(dir, Path::new("/tmp/myworkspace/.orgii/plans"));
    }

    #[test]
    fn plans_directory_falls_back_to_home_plus_agent_id() {
        let dir = plans_directory(None, "agent-xyz").expect("HOME should resolve in tests");
        // Must end with .orgii/plans/agent-xyz so projectless sessions don't
        // collide on a shared tree.
        let tail = dir
            .iter()
            .rev()
            .take(3)
            .map(|c| c.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            tail,
            vec![
                "agent-xyz".to_string(),
                "plans".to_string(),
                ".orgii".to_string()
            ]
        );
    }

    #[test]
    fn plan_file_path_combines_all_parts() {
        let ctx = PlanPathCtx {
            workspace_path: Some("/tmp/myworkspace"),
            agent_id: "ignored-when-workspace-present",
            sub_agent_id: None,
            title: "Refactor Auth Flow",
            hash: "deadbeef",
        };
        let path = plan_file_path(&ctx).unwrap();
        assert_eq!(
            path,
            Path::new("/tmp/myproj/.orgii/plans/refactor-auth-flow_deadbeef.plan.md")
        );
    }

    #[test]
    fn plan_file_path_uses_subagent_marker() {
        let ctx = PlanPathCtx {
            workspace_path: Some("/tmp/myworkspace"),
            agent_id: "parent",
            sub_agent_id: Some("child-1"),
            title: "Draft",
            hash: "abcd1234",
        };
        let path = plan_file_path(&ctx).unwrap();
        assert_eq!(
            path,
            Path::new("/tmp/myproj/.orgii/plans/draft_abcd1234-agent-child-1.plan.md")
        );
    }
}
