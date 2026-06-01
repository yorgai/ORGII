//! Glama — browse MCP servers from the Glama.ai directory.
//!
//! API reference: <https://glama.ai/mcp/reference>
//! Base URL: `https://glama.ai/api/mcp/v1`
//!
//! Glama is a read-only directory (18 000+ servers). It does not provide
//! install commands, so the frontend opens the Glama page in the browser.

use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::utils::http_retry::send_with_retry;

const GLAMA_BASE: &str = "https://glama.ai/api/mcp/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

// ── API response types (internal) ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlamaSearchResponse {
    servers: Vec<GlamaServerEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlamaServerEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    repository: Option<GlamaRepo>,
    #[serde(default)]
    spdx_license: Option<GlamaLicense>,
    #[serde(default)]
    attributes: Vec<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    environment_variables_json_schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlamaRepo {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlamaLicense {
    #[serde(default)]
    name: Option<String>,
}

// ── Types returned to the frontend ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlamaResult {
    pub id: String,
    pub name: String,
    pub namespace: String,
    pub slug: String,
    pub description: String,
    #[serde(default)]
    pub repository_url: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub attributes: Vec<String>,
    pub glama_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlamaDetail {
    pub id: String,
    pub name: String,
    pub namespace: String,
    pub slug: String,
    pub description: String,
    #[serde(default)]
    pub repository_url: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub attributes: Vec<String>,
    pub glama_url: String,
    #[serde(default)]
    pub environment_variables_schema: Option<serde_json::Value>,
}

// ── Helpers ──

fn build_client() -> Result<Client, String> {
    super::build_public_client(Some(REQUEST_TIMEOUT))
}

fn entry_to_result(entry: GlamaServerEntry) -> Option<GlamaResult> {
    let namespace = entry.namespace.unwrap_or_default();
    let slug = entry.slug.unwrap_or_default();
    if namespace.is_empty() || slug.is_empty() {
        return None;
    }

    let glama_url = entry
        .url
        .unwrap_or_else(|| format!("https://glama.ai/mcp/servers/@{namespace}/{slug}"));

    Some(GlamaResult {
        id: entry.id.unwrap_or_default(),
        name: entry.name.unwrap_or_else(|| slug.clone()),
        namespace: namespace.clone(),
        slug: slug.clone(),
        description: entry.description.unwrap_or_default(),
        repository_url: entry.repository.and_then(|r| r.url),
        license: entry.spdx_license.and_then(|l| l.name),
        attributes: entry.attributes,
        glama_url,
    })
}

// ── Search ──

/// Search the Glama directory for MCP servers matching a query.
///
/// Empty queries are slower because Glama paginates 18 000+ servers.
/// We use a smaller page size for empty queries to keep response times
/// reasonable.
#[tauri::command]
pub async fn glama_search(query: String, limit: Option<u32>) -> Result<Vec<GlamaResult>, String> {
    let trimmed = query.trim();
    // Empty queries are much slower on Glama — use a smaller page size
    let default_limit = if trimmed.is_empty() { 20 } else { 50 };
    let first = limit.unwrap_or(default_limit).min(100);
    let client = build_client()?;

    let first_str = first.to_string();
    let has_query = !trimmed.is_empty();

    let response = send_with_retry(
        &client,
        |c| {
            let req = c
                .get(format!("{GLAMA_BASE}/servers"))
                .query(&[("first", first_str.as_str())]);
            if has_query {
                req.query(&[("query", query.as_str())])
            } else {
                req
            }
        },
        "Glama search",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!("Glama returned status {}", response.status()));
    }

    let data: GlamaSearchResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse Glama response: {err}"))?;

    let results = data
        .servers
        .into_iter()
        .filter_map(entry_to_result)
        .collect();

    Ok(results)
}

// ── Detail ──

/// Fetch full detail for a specific MCP server from Glama.
#[tauri::command]
pub async fn glama_detail(namespace: String, slug: String) -> Result<GlamaDetail, String> {
    if namespace.trim().is_empty() || slug.trim().is_empty() {
        return Err("Namespace and slug are required".to_string());
    }

    let client = build_client()?;
    let url = format!("{GLAMA_BASE}/servers/{namespace}/{slug}");

    let response = send_with_retry(&client, |c| c.get(&url), "Glama detail").await?;

    if !response.status().is_success() {
        return Err(format!(
            "Glama detail returned status {}",
            response.status()
        ));
    }

    let entry: GlamaServerEntry = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse Glama detail: {err}"))?;

    let ns = entry.namespace.clone().unwrap_or_else(|| namespace.clone());
    let sl = entry.slug.clone().unwrap_or_else(|| slug.clone());
    let glama_url = entry
        .url
        .clone()
        .unwrap_or_else(|| format!("https://glama.ai/mcp/servers/@{ns}/{sl}"));

    Ok(GlamaDetail {
        id: entry.id.unwrap_or_default(),
        name: entry.name.unwrap_or_else(|| sl.clone()),
        namespace: ns,
        slug: sl,
        description: entry.description.unwrap_or_default(),
        repository_url: entry.repository.and_then(|r| r.url),
        license: entry.spdx_license.and_then(|l| l.name),
        attributes: entry.attributes,
        glama_url,
        environment_variables_schema: entry.environment_variables_json_schema,
    })
}
