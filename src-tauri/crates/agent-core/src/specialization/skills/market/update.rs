//! Detect and apply skill updates from skills.sh.

use std::fs;

use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::state::AgentAppState;
use app_paths::global_skills_dir;

use super::cache::CACHE_FILENAME;
use super::detail::skills_hub_detail;
use super::http::build_http_client;
use super::install::{
    extract_skill_name, fetch_skill_snapshot, install_skill_snapshot, snapshot_skill_md,
};
use super::types::{HubInstallResult, HubSkillDetail, SkillUpdateInfo};

/// Check all installed skills for available updates from skills.sh.
///
/// Reads each skill's local detail cache to get the skills.sh slug and
/// installed snapshot hash, then compares it against the current download hash.
#[tauri::command]
pub async fn skills_check_updates() -> Result<Vec<SkillUpdateInfo>, String> {
    let skills_dir = global_skills_dir();
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&skills_dir).map_err(|err| format!("Failed to read skills dir: {err}"))?;

    let mut candidates: Vec<(String, String, String)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_str().unwrap_or_default().to_string();
        let cache_path = path.join(CACHE_FILENAME);
        if !cache_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&cache_path) {
            Ok(c) => c,
            Err(err) => {
                log::warn!(
                    "[Skills] Update check: failed to read cache for '{name}' at {}: {err}",
                    cache_path.display()
                );
                continue;
            }
        };
        let detail: HubSkillDetail = match serde_json::from_str(&content) {
            Ok(d) => d,
            Err(err) => {
                log::warn!(
                    "[Skills] Update check: cache JSON parse failed for '{name}' at {}: {err}",
                    cache_path.display()
                );
                continue;
            }
        };
        let installed_hash = detail
            .snapshot_hash
            .filter(|hash| !hash.is_empty())
            .unwrap_or(detail.version);
        if !detail.slug.is_empty() && !installed_hash.is_empty() {
            candidates.push((name, detail.slug, installed_hash));
        }
    }

    let client = build_http_client()?;
    let mut updates = Vec::new();

    for (name, slug, installed_version) in candidates {
        let snapshot = match fetch_skill_snapshot(&client, &slug).await {
            Ok(snapshot) => snapshot,
            Err(err) => {
                log::warn!("[Skills] Update check failed for '{name}': {err}");
                continue;
            }
        };

        if !snapshot.hash.is_empty() && snapshot.hash != installed_version {
            updates.push(SkillUpdateInfo {
                name,
                slug,
                installed_version,
                latest_version: snapshot.hash,
                changelog: None,
            });
        }

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    Ok(updates)
}

/// Update an installed skill by re-fetching its snapshot from skills.sh.
#[tauri::command]
pub async fn skills_hub_update(
    app_state: tauri::State<'_, AgentAppState>,
    slug: String,
) -> Result<HubInstallResult, String> {
    if slug.trim().is_empty() {
        return Err("Skill slug is required".to_string());
    }

    let client = build_http_client()?;
    let snapshot = fetch_skill_snapshot(&client, &slug).await?;
    let content = snapshot_skill_md(&snapshot).unwrap_or_default();
    let skill_name = extract_skill_name(content).unwrap_or_else(|| slug.clone());

    let skills_dir = global_skills_dir();
    let skill_dir = skills_dir.join(&skill_name);

    if !skill_dir.exists() {
        return Err(format!("Skill '{skill_name}' is not installed"));
    }

    let skill_path = install_skill_snapshot(&snapshot, &skill_dir)?;

    match skills_hub_detail(slug).await {
        Ok(detail) => {
            let cache_path = skill_dir.join(CACHE_FILENAME);
            match serde_json::to_string_pretty(&detail) {
                Ok(json) => {
                    if let Err(err) = fs::write(&cache_path, json) {
                        log::warn!(
                            "[Skills] update '{skill_name}': failed to write cache at {}: {err}",
                            cache_path.display()
                        );
                    }
                }
                Err(err) => {
                    log::warn!(
                        "[Skills] update '{skill_name}': failed to serialize cache JSON: {err}"
                    );
                }
            }
        }
        Err(err) => {
            log::warn!(
                "[Skills] update '{skill_name}': failed to refresh skills.sh detail cache: {err}"
            );
        }
    }

    app_state
        .invalidate_prompt_caches(PromptCacheInvalidationReason::SkillCatalogChanged)
        .await;

    Ok(HubInstallResult {
        name: skill_name,
        path: skill_path.to_string_lossy().to_string(),
    })
}
