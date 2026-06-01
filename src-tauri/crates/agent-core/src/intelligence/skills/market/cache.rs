//! Per-skill on-disk cache for `HubSkillDetail`.
//!
//! Stored as `.clawhub-detail.json` inside each installed skill directory so
//! that `skills_check_updates` can read the slug + installed version offline.

use std::fs;

use app_paths::global_skills_dir;

use super::types::HubSkillDetail;

pub(super) const CACHE_FILENAME: &str = ".clawhub-detail.json";

/// Read cached hub detail for an installed skill.
///
/// Looks for `.clawhub-detail.json` next to the skill's `SKILL.md`.
#[tauri::command]
pub async fn skills_hub_detail_cache_read(name: String) -> Result<Option<HubSkillDetail>, String> {
    let skills_dir = global_skills_dir();
    let cache_path = skills_dir.join(&name).join(CACHE_FILENAME);

    if !cache_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&cache_path).map_err(|err| format!("Failed to read cache: {err}"))?;

    let detail: HubSkillDetail =
        serde_json::from_str(&content).map_err(|err| format!("Failed to parse cache: {err}"))?;

    Ok(Some(detail))
}

/// Write hub detail cache for an installed skill.
///
/// Stores `.clawhub-detail.json` next to the skill's `SKILL.md`.
#[tauri::command]
pub async fn skills_hub_detail_cache_write(
    name: String,
    detail: HubSkillDetail,
) -> Result<(), String> {
    let skills_dir = global_skills_dir();
    let skill_dir = skills_dir.join(&name);

    if !skill_dir.exists() {
        return Err(format!("Skill directory not found: {name}"));
    }

    let cache_path = skill_dir.join(CACHE_FILENAME);
    let json = serde_json::to_string_pretty(&detail)
        .map_err(|err| format!("Failed to serialize cache: {err}"))?;

    fs::write(&cache_path, json).map_err(|err| format!("Failed to write cache: {err}"))?;

    Ok(())
}
