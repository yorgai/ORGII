//! skills.sh default browse endpoint.
//!
//! skills.sh requires a query for `/api/search`, so this command uses a
//! broad default query to provide initial high-install results.

use super::search::skills_hub_search;
use super::types::HubSkillResult;

/// Browse the skills.sh directory without a user query.
#[tauri::command]
pub async fn skills_hub_browse(limit: Option<u32>) -> Result<Vec<HubSkillResult>, String> {
    skills_hub_search("agent".to_string(), limit).await
}
