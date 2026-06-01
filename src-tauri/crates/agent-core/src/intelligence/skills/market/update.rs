//! Detect and apply skill updates from ClawHub.

use std::fs;

use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::state::AgentAppState;
use crate::utils::http_retry::send_with_retry;
use app_paths::global_skills_dir;

use super::cache::CACHE_FILENAME;
use super::detail::skills_hub_detail;
use super::http::{build_http_client, CLAWHUB_BASE_URL, CLAWHUB_SKILLS_PATH};
use super::install::{extract_skill_name, fetch_skill_content};
use super::types::{HubInstallResult, HubSkillDetail, SkillUpdateInfo};

/// Check all installed skills for available updates from ClawHub.
///
/// Reads each skill's `.clawhub-detail.json` cache to get the slug,
/// then fetches the latest version from ClawHub and compares.
#[tauri::command]
pub async fn skills_check_updates() -> Result<Vec<SkillUpdateInfo>, String> {
    let skills_dir = global_skills_dir();
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&skills_dir).map_err(|err| format!("Failed to read skills dir: {err}"))?;

    let mut candidates: Vec<(String, String, String)> = Vec::new(); // (name, slug, installed_version)

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
        // A corrupt or unreadable cache file silently excluded the
        // skill from update checks — the user would never know why
        // their skill stopped getting updates. Warn so corruption
        // surfaces in logs while still skipping the entry (we
        // can't check updates without a valid cache).
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
        if !detail.slug.is_empty() {
            candidates.push((name, detail.slug, detail.version));
        }
    }

    let client = build_http_client()?;
    let mut updates = Vec::new();

    for (name, slug, installed_version) in candidates {
        let detail_url = format!("{CLAWHUB_BASE_URL}{CLAWHUB_SKILLS_PATH}/{slug}");
        let resp = match send_with_retry(
            &client,
            |c| c.get(&detail_url).header("Accept", "application/json"),
            &format!("ClawHub update check for '{name}'"),
        )
        .await
        {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                log::warn!(
                    "[Skills] Update check failed for '{name}': HTTP {}",
                    resp.status()
                );
                continue;
            }
            Err(err) => {
                log::warn!("[Skills] Update check failed for '{name}': {err}");
                continue;
            }
        };

        let body: serde_json::Value = match resp.json().await {
            Ok(body) => body,
            Err(err) => {
                log::warn!("[Skills] Failed to parse update response for '{name}': {err}");
                continue;
            }
        };

        let latest_version = body
            .get("latestVersion")
            .and_then(|v| v.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let changelog = body
            .get("latestVersion")
            .and_then(|v| v.get("changelog"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        if !latest_version.is_empty() && latest_version != installed_version {
            updates.push(SkillUpdateInfo {
                name,
                slug,
                installed_version,
                latest_version,
                changelog,
            });
        }

        // Rate-limit: small delay between requests
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    Ok(updates)
}

/// Update an installed skill by re-fetching SKILL.md from ClawHub.
///
/// Also updates the `.clawhub-detail.json` cache with the latest metadata.
#[tauri::command]
pub async fn skills_hub_update(
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

    if !skill_dir.exists() {
        return Err(format!("Skill '{skill_name}' is not installed"));
    }

    let skill_path = skill_dir.join("SKILL.md");
    fs::write(&skill_path, &content).map_err(|err| format!("Failed to write SKILL.md: {err}"))?;

    // Update the cache with fresh detail. Cache writes are best-effort
    // (the next `skills_check_updates` call will re-fetch from ClawHub
    // anyway), but a silent `let _ = fs::write` previously erased even
    // the diagnostic — a permission-denied or full-disk skill_dir would
    // make this skill silently disappear from update checks until the
    // user reinstalled. Log instead so the cause is recoverable.
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
                "[Skills] update '{skill_name}': failed to refresh ClawHub detail (cache will be \
                 stale until next successful update): {err}"
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
