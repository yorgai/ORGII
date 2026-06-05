//! skills.sh skill search endpoint.

use crate::utils::http_retry::send_with_retry;

use super::http::{build_http_client, SKILLS_SH_BASE_URL, SKILLS_SH_SEARCH_PATH};
use super::types::HubSkillResult;

/// Search skills.sh for skills matching a query.
#[tauri::command]
pub async fn skills_hub_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<HubSkillResult>, String> {
    let query = query.trim().to_string();
    if query.len() < 2 {
        return Ok(Vec::new());
    }

    let limit = limit.unwrap_or(20).min(50);
    let client = build_http_client()?;

    let url = format!("{SKILLS_SH_BASE_URL}{SKILLS_SH_SEARCH_PATH}");
    let limit_str = limit.to_string();

    let response = send_with_retry(
        &client,
        |c| {
            c.get(&url)
                .query(&[("q", query.as_str()), ("limit", limit_str.as_str())])
                .header("Accept", "application/json")
        },
        "skills.sh search",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "skills.sh search returned status {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse skills.sh response: {err}"))?;

    let items = body
        .get("skills")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let results: Vec<HubSkillResult> = items
        .into_iter()
        .filter_map(|item| {
            let slug = item.get("id")?.as_str()?.to_string();
            if slug.is_empty() {
                return None;
            }

            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| slug.clone());
            let source = item
                .get("source")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let skill_id = item
                .get("skillId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let installs = item.get("installs").and_then(|v| v.as_u64());
            let description = match (&source, installs) {
                (Some(source), Some(installs)) => format!("{source} • {installs} installs"),
                (Some(source), None) => source.clone(),
                (None, Some(installs)) => format!("{installs} installs"),
                (None, None) => String::new(),
            };

            Some(HubSkillResult {
                slug,
                name,
                description,
                updated_at: None,
                source,
                skill_id,
                installs,
            })
        })
        .collect();

    Ok(results)
}
