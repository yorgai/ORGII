//! Tauri commands for skill CRUD operations.
//!
//! Disabled-skills storage is keyed by agent definition ID. Callers
//! that already know which agent they edit pass `agent_id` explicitly;
//! when absent we fall back to picking a builtin from the workspace
//! presence (`builtin:sde` for workspace contexts, `builtin:os` for
//! global / desktop) so existing call sites stay backward-compatible.

use std::fs;
use std::path::PathBuf;

use super::scanner::SkillsLoader;
use super::types::SkillInfo;
use crate::intelligence::skills::builtin;

use crate::core::definitions::builtin::{OS_AGENT_ID, SDE_AGENT_ID};
use crate::core::definitions::store::AgentDefinitionsStore;
use crate::core::definitions::AgentSkillsConfig;
use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::state::AgentAppState;

/// Resolve the agent definition that owns the disabled-skills list.
///
/// `agent_id` wins when supplied; otherwise we infer the builtin from
/// the workspace presence (mirrors the original behaviour so existing
/// callers keep working).
fn skills_owner_agent_id(agent_id: Option<&str>, workspace_path: Option<&str>) -> String {
    if let Some(id) = agent_id {
        if !id.is_empty() {
            return id.to_string();
        }
    }
    if workspace_path.map(|p| !p.is_empty()).unwrap_or(false) {
        SDE_AGENT_ID.to_string()
    } else {
        OS_AGENT_ID.to_string()
    }
}

/// Read the disabled-skills list from `AgentDefinition.skills_config.exclude`.
///
/// Reads through the registered `AgentDefinitionsStore` (the same
/// singleton `agent_def_get` and `agent_def_update_patch` use) so
/// `skills_toggle` writes are visible immediately, with no
/// new-instance / split-brain hop.
fn load_disabled_skills_for(store: &AgentDefinitionsStore, agent_id: &str) -> Vec<String> {
    store
        .get(agent_id)
        .and_then(|def| def.skills_config.map(|s| s.exclude))
        .unwrap_or_default()
}

/// Toggle a skill enabled/disabled in `AgentDefinition.skills_config.exclude`.
fn toggle_disabled_skill_for(
    store: &AgentDefinitionsStore,
    agent_id: &str,
    name: &str,
    enabled: bool,
) -> Result<(), String> {
    let apply = |def: &mut crate::core::definitions::AgentDefinition| {
        let cfg = def
            .skills_config
            .get_or_insert_with(AgentSkillsConfig::default);
        if enabled {
            cfg.exclude.retain(|skill| skill != name);
        } else if !cfg.exclude.iter().any(|s| s == name) {
            cfg.exclude.push(name.to_string());
        }
    };
    if agent_id.starts_with(crate::definitions::builtin::BUILTIN_PREFIX) {
        store.update_with_overlay(agent_id, apply).map(|_| ())
    } else {
        store.update(agent_id, apply).map(|_| ())
    }
}

/// Global skills directory: `~/.orgii/skills/`.
pub fn global_skills_dir() -> PathBuf {
    app_paths::global_skills_dir()
}

/// Build a SkillsLoader for a workspace (workspace `.orgii/` + global builtin).
pub(super) fn loader_for_workspace(workspace_path: Option<&str>) -> SkillsLoader {
    let base = match workspace_path {
        Some(path) => PathBuf::from(path).join(".orgii"),
        None => global_skills_dir()
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(std::env::temp_dir),
    };
    SkillsLoader::new(&base).with_builtin_dir(global_skills_dir())
}

const EMBEDDED_BUILTIN_SKILL_SOURCE: &str = "embedded_builtin";

fn append_embedded_builtin_skills(skills: &mut Vec<SkillInfo>) {
    let existing_names: std::collections::HashSet<String> =
        skills.iter().map(|skill| skill.name.clone()).collect();
    for mut skill in builtin::list_builtin_skills() {
        if existing_names.contains(&skill.name) {
            continue;
        }
        skill.source = EMBEDDED_BUILTIN_SKILL_SOURCE.to_string();
        skills.push(skill);
    }
}

/// List skills and mark enabled/disabled based on the given disabled list.
pub fn list_skills_with_config(
    workspace_path: Option<&str>,
    disabled_skills: &[String],
) -> Vec<SkillInfo> {
    let loader = loader_for_workspace(workspace_path);
    let mut skills = loader.list_skills();
    append_embedded_builtin_skills(&mut skills);
    for skill in &mut skills {
        skill.enabled = !disabled_skills.contains(&skill.name);
    }
    skills
}

// ============================================
// Tauri commands
// ============================================

/// List all discovered skills (workspace + global) with availability and enabled status.
///
/// `agent_id` lets callers (custom-agent detail view, AgentWizard) edit
/// the right agent's exclusion list; when omitted we fall back to the
/// workspace-presence heuristic for backward compatibility.
#[tauri::command]
pub async fn skills_list(
    store: tauri::State<'_, AgentDefinitionsStore>,
    workspace_path: Option<String>,
    agent_id: Option<String>,
) -> Result<Vec<SkillInfo>, String> {
    let owner = skills_owner_agent_id(agent_id.as_deref(), workspace_path.as_deref());
    let disabled = load_disabled_skills_for(&store, &owner);
    Ok(list_skills_with_config(
        workspace_path.as_deref(),
        &disabled,
    ))
}

/// Read a skill's full SKILL.md content by name.
#[tauri::command]
pub async fn skills_read(workspace_path: Option<String>, name: String) -> Result<String, String> {
    let loader = loader_for_workspace(workspace_path.as_deref());
    loader
        .load_skill(&name)
        .ok_or_else(|| format!("Skill '{}' not found", name))
}

/// Toggle a skill on/off on the agent definition.
///
/// `agent_id` wins when supplied; otherwise we infer the builtin from
/// the workspace presence. Writes through the registered
/// `AgentDefinitionsStore`'s `update_with_overlay` for builtins (so
/// the change persists to `~/.orgii/builtin-overrides.json` AND
/// updates the in-memory cache `agent_def_get` reads from) and
/// through `update` for custom agents.
#[tauri::command]
pub async fn skills_toggle(
    store: tauri::State<'_, AgentDefinitionsStore>,
    app_state: tauri::State<'_, AgentAppState>,
    workspace_path: Option<String>,
    agent_id: Option<String>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let owner = skills_owner_agent_id(agent_id.as_deref(), workspace_path.as_deref());
    toggle_disabled_skill_for(&store, &owner, &name, enabled)?;
    app_state
        .invalidate_prompt_caches_for_agent_definition(
            &owner,
            PromptCacheInvalidationReason::AgentDefinitionChanged,
        )
        .await;
    Ok(())
}

/// Validate a skill name per the Agent Skills spec:
/// non-empty, kebab-case, max 64 chars, no consecutive hyphens, not already taken.
#[tauri::command]
pub async fn skills_validate_name(
    name: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    validate_skill_name(&name)?;

    let loader = loader_for_workspace(workspace_path.as_deref());
    let mut existing = loader.list_skills();
    append_embedded_builtin_skills(&mut existing);
    if existing.iter().any(|s| s.name == name) {
        return Err(format!("A skill named '{}' already exists", name));
    }

    Ok(())
}

/// Pure name validation (no uniqueness check).
pub(super) fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if name.len() > 64 {
        return Err("Skill name must be at most 64 characters".to_string());
    }
    let valid_kebab = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid_kebab || name.starts_with('-') || name.ends_with('-') || name.contains("--") {
        return Err(
            "Skill name must be kebab-case (lowercase letters, digits, single hyphens)".to_string(),
        );
    }
    Ok(())
}

/// Validate frontmatter field lengths per the Agent Skills spec.
pub(super) fn validate_frontmatter_fields(frontmatter: &str) -> Result<(), String> {
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(after) = trimmed.strip_prefix("description:") {
            let val = after.trim().trim_matches('"').trim_matches('\'');
            if val.len() > 1024 {
                return Err("Description must be at most 1024 characters".to_string());
            }
        } else if let Some(after) = trimmed.strip_prefix("compatibility:") {
            let val = after.trim().trim_matches('"').trim_matches('\'');
            if val.len() > 500 {
                return Err("Compatibility must be at most 500 characters".to_string());
            }
        }
    }
    Ok(())
}

/// Create a new skill. Writes to workspace `.orgii/skills/` when `workspace_path`
/// is provided, otherwise to the global `~/.orgii/skills/`.
#[tauri::command]
pub async fn skills_create(
    app_state: tauri::State<'_, AgentAppState>,
    name: String,
    frontmatter: String,
    body: String,
    workspace_path: Option<String>,
) -> Result<SkillInfo, String> {
    validate_skill_name(&name)?;
    validate_frontmatter_fields(&frontmatter)?;

    let dir = match workspace_path {
        Some(ref pp) => PathBuf::from(pp).join(".orgii/skills").join(&name),
        None => global_skills_dir().join(&name),
    };
    fs::create_dir_all(&dir).map_err(|err| format!("Failed to create skill directory: {}", err))?;

    let skill_file = dir.join("SKILL.md");
    if skill_file.exists() {
        return Err(format!(
            "Skill '{}' already exists at {}",
            name,
            skill_file.display()
        ));
    }

    let content = if frontmatter.is_empty() {
        body
    } else {
        format!("---\n{}\n---\n\n{}", frontmatter.trim(), body)
    };

    fs::write(&skill_file, &content).map_err(|err| format!("Failed to write SKILL.md: {}", err))?;

    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;

    let loader = loader_for_workspace(workspace_path.as_deref());
    let skills = loader.list_skills();
    skills
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| "Skill created but not found in scan".to_string())
}

/// Update an existing skill's SKILL.md content at the given path.
#[tauri::command]
pub async fn skills_update(
    app_state: tauri::State<'_, AgentAppState>,
    skill_path: String,
    frontmatter: String,
    body: String,
) -> Result<(), String> {
    let path = PathBuf::from(&skill_path);
    if !path.exists() {
        return Err(format!("Skill file not found: {}", skill_path));
    }

    let content = if frontmatter.is_empty() {
        body
    } else {
        format!("---\n{}\n---\n\n{}", frontmatter.trim(), body)
    };

    validate_frontmatter_fields(&frontmatter)?;

    fs::write(&path, content).map_err(|err| format!("Failed to write SKILL.md: {}", err))?;
    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;
    Ok(())
}

/// Move a skill between scopes (global ↔ workspace).
///
/// Returns the new on-disk path of the moved `SKILL.md`. The source
/// directory is moved as a whole so bundled files / scripts / refs
/// follow the skill. Refuses to clobber an existing skill at the
/// destination.
///
/// `target_scope` is `"global"` or `"workspace"`. When moving *to* a
/// workspace scope, `workspace_path` must be supplied.
#[tauri::command]
pub async fn skills_move(
    app_state: tauri::State<'_, AgentAppState>,
    skill_path: String,
    target_scope: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let src_skill_md = PathBuf::from(&skill_path);
    if !src_skill_md.exists() {
        return Err(format!("Skill file not found: {}", skill_path));
    }
    let src_dir = src_skill_md
        .parent()
        .ok_or_else(|| format!("Skill path has no parent directory: {}", skill_path))?
        .to_path_buf();
    let skill_name = src_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Could not derive skill name from path: {}", skill_path))?
        .to_string();

    let dest_dir = match target_scope.as_str() {
        "global" => global_skills_dir().join(&skill_name),
        "workspace" => {
            let pp = workspace_path
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    "workspace_path is required when moving a skill to workspace scope".to_string()
                })?;
            PathBuf::from(pp).join(".orgii/skills").join(&skill_name)
        }
        other => return Err(format!("Unknown target_scope: {}", other)),
    };

    if src_dir == dest_dir {
        return Ok(src_skill_md.to_string_lossy().into_owned());
    }
    if dest_dir.exists() {
        return Err(format!(
            "A skill named '{}' already exists at {}",
            skill_name,
            dest_dir.display()
        ));
    }

    if let Some(parent) = dest_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create destination directory: {}", err))?;
    }

    // Try a simple rename first; fall back to copy + remove for cross-device
    // moves (e.g. workspace on a different filesystem than `~/.orgii`).
    if let Err(rename_err) = fs::rename(&src_dir, &dest_dir) {
        copy_dir_recursive(&src_dir, &dest_dir).map_err(|err| {
            format!(
                "Failed to copy skill (rename also failed: {}): {}",
                rename_err, err
            )
        })?;
        fs::remove_dir_all(&src_dir)
            .map_err(|err| format!("Failed to remove source after copy: {}", err))?;
    }

    let new_skill_md = dest_dir.join("SKILL.md");
    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;
    Ok(new_skill_md.to_string_lossy().into_owned())
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let next_dest = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &next_dest)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &next_dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tempdir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "orgii-skills-move-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn list_skills_with_config_keeps_embedded_builtin_uri() {
        let skills = list_skills_with_config(None, &[]);
        let skill = skills
            .iter()
            .find(|candidate| candidate.name == "create-orgii-agent")
            .expect("create-orgii-agent should be listed");

        assert_eq!(skill.source, EMBEDDED_BUILTIN_SKILL_SOURCE);
        assert_eq!(
            skill.path.to_string_lossy(),
            "builtin://create-orgii-agent/SKILL.md"
        );
    }

    #[test]
    fn skills_owner_agent_id_prefers_explicit_id() {
        assert_eq!(
            skills_owner_agent_id(Some("custom:abc"), Some("/tmp/proj")),
            "custom:abc"
        );
        assert_eq!(
            skills_owner_agent_id(Some("custom:abc"), None),
            "custom:abc"
        );
        assert_eq!(skills_owner_agent_id(None, Some("/tmp/proj")), SDE_AGENT_ID);
        assert_eq!(skills_owner_agent_id(None, None), OS_AGENT_ID);
        assert_eq!(skills_owner_agent_id(Some(""), None), OS_AGENT_ID);
    }

    #[test]
    fn copy_dir_recursive_handles_nested_files() {
        let src = unique_tempdir("copy-src");
        let dest = unique_tempdir("copy-dest");
        let nested = src.join("scripts");
        fs::create_dir_all(&nested).unwrap();
        fs::write(src.join("SKILL.md"), b"# skill").unwrap();
        fs::write(nested.join("run.sh"), b"echo hi").unwrap();

        copy_dir_recursive(&src, &dest).unwrap();

        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("scripts/run.sh").exists());

        fs::remove_dir_all(&src).ok();
        fs::remove_dir_all(&dest).ok();
    }
}
