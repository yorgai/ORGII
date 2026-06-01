//! MCP.Bar — browse and install MCP servers from the MCP.Bar open registry.
//!
//! The registry is a directory of JSON manifest files hosted on GitHub:
//! <https://github.com/in-fun/mcpbar/tree/main/registry>
//!
//! We fetch the full directory tree via the GitHub API, then fetch individual
//! manifests on demand. The tree is cached in memory for 1 hour.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::mcp::config::{
    global_config_path, insert_server_config, McpServerConfig, McpTransportType,
};
use crate::utils::http_retry::send_with_retry;

const GITHUB_TREE_URL: &str =
    "https://api.github.com/repos/in-fun/mcpbar/git/trees/main?recursive=1";
const RAW_BASE: &str = "https://raw.githubusercontent.com/in-fun/mcpbar/main";
const CACHE_TTL: Duration = Duration::from_secs(3600);

// ── In-memory index cache ──

struct CachedIndex {
    entries: Vec<McpBarIndexEntry>,
    fetched_at: Instant,
}

static INDEX_CACHE: Mutex<Option<CachedIndex>> = Mutex::new(None);

#[derive(Debug, Clone)]
struct McpBarIndexEntry {
    qualified_name: String,
}

// ── GitHub tree API response ──

#[derive(Debug, Deserialize)]
struct GitHubTreeResponse {
    tree: Vec<GitHubTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GitHubTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
}

// ── Manifest format ──

#[derive(Debug, Deserialize)]
struct McpBarManifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<McpBarRepo>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    server: Option<McpBarServerBlock>,
    #[serde(default)]
    inputs: Vec<McpBarInput>,
}

#[derive(Debug, Deserialize)]
struct McpBarRepo {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct McpBarServerBlock {
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
}

/// User input schema from MCP.Bar manifest.
/// Used to determine if a server requires configuration (see `McpBarDetail::requires_input`).
///
/// The manifest also carries `id` and `password` fields that we currently
/// ignore — `serde(deny_unknown_fields)` is intentionally NOT set so that
/// future manifest additions don't fail to deserialize.
#[derive(Debug, Deserialize)]
struct McpBarInput {
    #[serde(default)]
    description: Option<String>,
}

// ── Types returned to the frontend ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBarResult {
    pub qualified_name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBarDetail {
    pub qualified_name: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository_url: Option<String>,
    pub keywords: Vec<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    pub requires_input: bool,
    pub input_descriptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpBarInstallResult {
    pub server_name: String,
    pub transport_type: String,
}

// ── Helpers ──

fn build_client() -> Result<Client, String> {
    super::build_public_client(None)
}

async fn fetch_index(client: &Client) -> Result<Vec<McpBarIndexEntry>, String> {
    {
        let cache = INDEX_CACHE
            .lock()
            .map_err(|err| format!("Cache lock error: {err}"))?;
        if let Some(cached) = cache.as_ref() {
            if cached.fetched_at.elapsed() < CACHE_TTL {
                return Ok(cached.entries.clone());
            }
        }
    }

    let response = send_with_retry(
        client,
        |c| c.get(GITHUB_TREE_URL).header("Accept", "application/json"),
        "GitHub tree API",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub tree API returned status {}",
            response.status()
        ));
    }

    let tree: GitHubTreeResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse GitHub tree: {err}"))?;

    let entries: Vec<McpBarIndexEntry> = tree
        .tree
        .into_iter()
        .filter(|entry| {
            entry.entry_type == "blob"
                && entry.path.starts_with("registry/")
                && entry.path.ends_with(".json")
        })
        .filter_map(|entry| {
            let rel = entry.path.strip_prefix("registry/")?.to_string();
            let qualified = rel.strip_suffix(".json")?.to_string();
            Some(McpBarIndexEntry {
                qualified_name: qualified,
            })
        })
        .collect();

    {
        let mut cache = INDEX_CACHE
            .lock()
            .map_err(|err| format!("Cache lock error: {err}"))?;
        *cache = Some(CachedIndex {
            entries: entries.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(entries)
}

// ── Search ──

#[tauri::command]
pub async fn mcpbar_search(query: String, limit: Option<u32>) -> Result<Vec<McpBarResult>, String> {
    let client = build_client()?;
    let index = fetch_index(&client).await?;
    let result_limit = limit.unwrap_or(50).min(200) as usize;

    let query_lower = query.to_lowercase();
    let has_query = !query_lower.trim().is_empty();

    let results: Vec<McpBarResult> = index
        .into_iter()
        .filter(|entry| {
            if !has_query {
                return true;
            }
            entry.qualified_name.to_lowercase().contains(&query_lower)
        })
        .take(result_limit)
        .map(|entry| {
            let display = entry
                .qualified_name
                .rsplit('/')
                .next()
                .unwrap_or(&entry.qualified_name)
                .to_string();
            McpBarResult {
                qualified_name: entry.qualified_name,
                display_name: display,
            }
        })
        .collect();

    Ok(results)
}

// ── Detail ──

#[tauri::command]
pub async fn mcpbar_detail(qualified_name: String) -> Result<McpBarDetail, String> {
    if qualified_name.trim().is_empty() {
        return Err("Server name is required".to_string());
    }

    let client = build_client()?;
    let url = format!("{RAW_BASE}/registry/{qualified_name}.json");

    let response = send_with_retry(&client, |c| c.get(&url), "MCP.Bar manifest").await?;

    if !response.status().is_success() {
        return Err(format!(
            "MCP.Bar manifest returned status {}",
            response.status()
        ));
    }

    let manifest: McpBarManifest = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse MCP.Bar manifest: {err}"))?;

    let display_name = manifest.name.unwrap_or_else(|| {
        qualified_name
            .rsplit('/')
            .next()
            .unwrap_or(&qualified_name)
            .to_string()
    });

    let requires_input = !manifest.inputs.is_empty();
    let input_descriptions = manifest
        .inputs
        .iter()
        .filter_map(|input| input.description.clone())
        .collect();

    Ok(McpBarDetail {
        qualified_name: qualified_name.clone(),
        display_name,
        description: manifest.description.unwrap_or_default(),
        version: manifest.version,
        homepage: manifest.homepage,
        repository_url: manifest.repository.and_then(|r| r.url),
        keywords: manifest.keywords,
        command: manifest.server.as_ref().and_then(|s| s.command.clone()),
        args: manifest.server.as_ref().and_then(|s| s.args.clone()),
        requires_input,
        input_descriptions,
    })
}

// ── Install ──

#[tauri::command]
pub async fn mcpbar_install(qualified_name: String) -> Result<McpBarInstallResult, String> {
    let detail = mcpbar_detail(qualified_name).await?;

    if detail.requires_input {
        return Err(
            "This server requires configuration inputs — use the Add Server wizard instead"
                .to_string(),
        );
    }

    let command = detail
        .command
        .ok_or("Manifest has no server command — cannot auto-install")?;

    let short_name = detail
        .qualified_name
        .rsplit('/')
        .next()
        .unwrap_or(&detail.qualified_name)
        .to_string();

    let config = McpServerConfig {
        transport_type: McpTransportType::Stdio,
        command: Some(command),
        args: detail.args,
        cwd: None,
        env: None,
        url: None,
        headers: None,
        auto_approve: None,
        disabled: false,
        timeout: 30,
    };

    let config_path = global_config_path();
    insert_server_config(&config_path, short_name.clone(), config)?;

    Ok(McpBarInstallResult {
        server_name: short_name,
        transport_type: "stdio".to_string(),
    })
}
