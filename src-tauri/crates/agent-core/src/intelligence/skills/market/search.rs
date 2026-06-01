//! ClawHub skill search endpoint.

use crate::utils::http_retry::send_with_retry;

use super::http::{build_http_client, CLAWHUB_BASE_URL, CLAWHUB_SEARCH_PATH};
use super::types::HubSkillResult;

/// Search ClawHub for skills matching a query.
///
/// The real ClawHub response shape is:
/// ```json
/// { "results": [{ "slug", "displayName", "summary", "version", "updatedAt", "score" }] }
/// ```
#[tauri::command]
pub async fn skills_hub_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<HubSkillResult>, String> {
    let limit = limit.unwrap_or(20).min(50);
    let client = build_http_client()?;

    let url = format!("{CLAWHUB_BASE_URL}{CLAWHUB_SEARCH_PATH}");
    let limit_str = limit.to_string();

    let response = send_with_retry(
        &client,
        |c| {
            c.get(&url)
                .query(&[("q", query.as_str()), ("limit", limit_str.as_str())])
                .header("Accept", "application/json")
        },
        "ClawHub search",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "ClawHub search returned status {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse ClawHub response: {err}"))?;

    let items = body
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let results: Vec<HubSkillResult> = items
        .into_iter()
        .filter_map(|item| {
            let slug = item.get("slug")?.as_str()?.to_string();
            if slug.is_empty() {
                return None;
            }

            let name = item
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or(&slug)
                .to_string();

            let description = item
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let updated_at = item.get("updatedAt").and_then(|v| v.as_u64());

            Some(HubSkillResult {
                slug,
                name,
                description,
                updated_at,
            })
        })
        .collect();

    Ok(results)
}
