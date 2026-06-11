//! skills.sh skill detail endpoint (download snapshot + derive metadata).

use super::http::build_http_client;
use super::install::{build_detail_from_snapshot, fetch_skill_snapshot};
use super::types::HubSkillDetail;

/// Fetch full skill detail from skills.sh by public id (`owner/repo/skill`).
#[tauri::command]
pub async fn skills_hub_detail(slug: String) -> Result<HubSkillDetail, String> {
    if slug.trim().is_empty() {
        return Err("Skill slug is required".to_string());
    }

    let client = build_http_client()?;
    let snapshot = fetch_skill_snapshot(&client, &slug).await?;
    Ok(build_detail_from_snapshot(&slug, &snapshot))
}
