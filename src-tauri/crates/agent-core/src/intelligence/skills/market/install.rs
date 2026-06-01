//! Install / uninstall a skill into `~/.orgii/skills/`.
//!
//! Also exposes `fetch_skill_content` and `extract_skill_name` to the
//! `update` submodule, which re-uses them when overwriting an existing
//! installation.

use std::fs;

use reqwest::Client;

use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::state::AgentAppState;
use crate::utils::http_retry::send_with_retry;
use app_paths::global_skills_dir;

use super::http::{build_http_client, CLAWHUB_BASE_URL, CLAWHUB_SKILLS_PATH};
use super::types::HubInstallResult;

/// Fetch a skill's SKILL.md content from ClawHub by slug.
pub(super) async fn fetch_skill_content(client: &Client, slug: &str) -> Result<String, String> {
    let file_url = format!("{CLAWHUB_BASE_URL}{CLAWHUB_SKILLS_PATH}/{slug}/file");
    let resp = send_with_retry(
        client,
        |c| {
            c.get(&file_url)
                .query(&[("path", "SKILL.md")])
                .header("Accept", "text/plain, text/markdown, */*")
        },
        &format!("ClawHub file fetch for '{slug}'"),
    )
    .await?;

    if !resp.status().is_success() {
        return Err(format!(
            "ClawHub file endpoint returned status {} for skill '{slug}'",
            resp.status()
        ));
    }

    let text = resp
        .text()
        .await
        .map_err(|err| format!("Failed to read SKILL.md body: {err}"))?;

    if text.trim().is_empty() {
        return Err(format!("SKILL.md is empty for skill '{slug}'"));
    }

    Ok(text)
}

/// Install a skill from ClawHub into `~/.orgii/skills/`.
#[tauri::command]
pub async fn skills_hub_install(
    app_state: tauri::State<'_, AgentAppState>,
    slug: String,
) -> Result<HubInstallResult, String> {
    if slug.trim().is_empty() {
        return Err("Skill slug is required".to_string());
    }

    let client = build_http_client()?;
    let content = fetch_skill_content(&client, &slug).await?;

    let skill_name = extract_skill_name(&content).unwrap_or_else(|| slug.clone());

    let skills_dir = global_skills_dir();
    let skill_dir = skills_dir.join(&skill_name);

    fs::create_dir_all(&skill_dir)
        .map_err(|err| format!("Failed to create skill directory: {err}"))?;

    let skill_path = skill_dir.join("SKILL.md");
    fs::write(&skill_path, &content).map_err(|err| format!("Failed to write SKILL.md: {err}"))?;
    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;

    Ok(HubInstallResult {
        name: skill_name,
        path: skill_path.to_string_lossy().to_string(),
    })
}

/// Uninstall a skill by removing its directory from `~/.orgii/skills/`.
#[tauri::command]
pub async fn skills_hub_uninstall(
    app_state: tauri::State<'_, AgentAppState>,
    name: String,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Skill name is required".to_string());
    }

    let skill_dir = global_skills_dir().join(&name);

    if !skill_dir.exists() {
        return Err(format!("Skill directory not found: {name}"));
    }

    fs::remove_dir_all(&skill_dir)
        .map_err(|err| format!("Failed to remove skill directory: {err}"))?;
    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;

    Ok(())
}

/// Extract the `name` field from YAML frontmatter.
pub(super) fn extract_skill_name(content: &str) -> Option<String> {
    let after_start = content.strip_prefix("---")?;
    let end_idx = after_start.find("---")?;
    let frontmatter = &after_start[..end_idx];

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(after) = trimmed.strip_prefix("name:") {
            let value = after.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}
