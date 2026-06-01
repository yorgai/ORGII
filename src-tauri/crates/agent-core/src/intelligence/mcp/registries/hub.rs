//! MCP Hub — browse and install MCP servers from the Official MCP Registry.
//!
//! Provides Tauri commands to search the registry at
//! `registry.modelcontextprotocol.io` and install servers into the user's
//! global `mcp-servers.json`.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::mcp::config::{
    global_config_path, insert_server_config, McpServerConfig, McpTransportType,
};
use crate::utils::http_retry::send_with_retry;

const MCP_REGISTRY_BASE: &str = "https://registry.modelcontextprotocol.io";
const MCP_REGISTRY_SERVERS: &str = "/v0.1/servers";

// ── Types returned to the frontend ──

/// Remote endpoint info from the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubRemote {
    #[serde(rename = "type")]
    pub remote_type: String,
    pub url: String,
}

/// Package info from the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubPackage {
    pub registry_type: String,
    pub identifier: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub transport: Option<McpHubPackageTransport>,
}

/// Transport block inside a package entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubPackageTransport {
    #[serde(rename = "type")]
    pub transport_type: String,
}

/// Lightweight search result returned by `mcp_hub_search`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubResult {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub has_remote: bool,
    #[serde(default)]
    pub has_package: bool,
    #[serde(default)]
    pub published_at: Option<String>,
}

/// Full detail returned by `mcp_hub_detail`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubDetail {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub website_url: Option<String>,
    #[serde(default)]
    pub repository: Option<McpHubRepository>,
    #[serde(default)]
    pub remotes: Vec<McpHubRemote>,
    #[serde(default)]
    pub packages: Vec<McpHubPackage>,
    #[serde(default)]
    pub icons: Vec<McpHubIcon>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// Repository info from the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubRepository {
    pub url: String,
    #[serde(default)]
    pub source: Option<String>,
}

/// Icon info from the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubIcon {
    pub src: String,
    #[serde(default)]
    pub mime_type: Option<String>,
}

/// Result of installing an MCP server from the hub.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHubInstallResult {
    pub server_name: String,
    pub transport_type: String,
}

// ── Helpers ──

fn build_client() -> Result<Client, String> {
    super::build_public_client(None)
}

/// Parse a single server entry from the registry JSON.
fn parse_server_entry(entry: &serde_json::Value) -> Option<McpHubResult> {
    let server = entry.get("server")?;
    let name = server.get("name")?.as_str()?.to_string();
    if name.is_empty() {
        return None;
    }

    let title = server
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let description = server
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let version = server
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let has_remote = server
        .get("remotes")
        .and_then(|v| v.as_array())
        .map(|arr| !arr.is_empty())
        .unwrap_or(false);

    let has_package = server
        .get("packages")
        .and_then(|v| v.as_array())
        .map(|arr| !arr.is_empty())
        .unwrap_or(false);

    let published_at = entry
        .pointer("//_meta/io.modelcontextprotocol.registry~1official/publishedAt")
        .or_else(|| {
            entry
                .get("_meta")
                .and_then(|m| m.get("io.modelcontextprotocol.registry/official"))
                .and_then(|m| m.get("publishedAt"))
        })
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(McpHubResult {
        name,
        title,
        description,
        version,
        has_remote,
        has_package,
        published_at,
    })
}

/// Parse full detail from a registry server entry.
fn parse_server_detail(entry: &serde_json::Value) -> Result<McpHubDetail, String> {
    let server = entry
        .get("server")
        .ok_or_else(|| "Missing 'server' field in registry response".to_string())?;

    let name = server
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let title = server
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let description = server
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let version = server
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let website_url = server
        .get("websiteUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // The `repository` / `remotes` / `packages` / `icons` fields below
    // are optional in the upstream MCP registry schema, so a missing
    // key is legal and stays `None` / `Vec::new()`. But a *present*
    // key whose value fails to deserialize is a real schema break:
    // silently dropping `packages` (for instance) would let the user
    // install a server that the registry advertised as having an npm
    // package, but with no actual install method recorded — a classic
    // "feature ready, unwired" footgun. Warn on the parse failure so
    // a future registry change surfaces in logs instead of as a
    // mysteriously broken install button.
    let repository = match server.get("repository") {
        Some(v) => match serde_json::from_value::<McpHubRepository>(v.clone()) {
            Ok(parsed) => Some(parsed),
            Err(err) => {
                tracing::warn!(
                    "[mcp_hub] failed to parse server.repository for {:?}: {} (raw: {})",
                    name,
                    err,
                    v
                );
                None
            }
        },
        None => None,
    };

    fn warn_on_parse<T: serde::de::DeserializeOwned>(
        field: &'static str,
        owner: &str,
        v: &serde_json::Value,
    ) -> Vec<T> {
        match serde_json::from_value::<Vec<T>>(v.clone()) {
            Ok(parsed) => parsed,
            Err(err) => {
                tracing::warn!(
                    "[mcp_hub] failed to parse server.{} for {:?}: {} (raw: {})",
                    field,
                    owner,
                    err,
                    v
                );
                Vec::new()
            }
        }
    }

    let remotes: Vec<McpHubRemote> = server
        .get("remotes")
        .map(|v| warn_on_parse("remotes", &name, v))
        .unwrap_or_default();

    let packages: Vec<McpHubPackage> = server
        .get("packages")
        .map(|v| warn_on_parse("packages", &name, v))
        .unwrap_or_default();

    let icons: Vec<McpHubIcon> = server
        .get("icons")
        .map(|v| warn_on_parse("icons", &name, v))
        .unwrap_or_default();

    let meta = entry
        .get("_meta")
        .and_then(|m| m.get("io.modelcontextprotocol.registry/official"));

    let published_at = meta
        .and_then(|m| m.get("publishedAt"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let updated_at = meta
        .and_then(|m| m.get("updatedAt"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let status = meta
        .and_then(|m| m.get("status"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(McpHubDetail {
        name,
        title,
        description,
        version,
        website_url,
        repository,
        remotes,
        packages,
        icons,
        published_at,
        updated_at,
        status,
    })
}

// ── Search ──

/// Search the Official MCP Registry for servers matching a query.
///
/// The registry API does not support text search, so we fetch a batch
/// and filter client-side by name/title/description.
#[tauri::command]
pub async fn mcp_hub_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<McpHubResult>, String> {
    let fetch_limit = 100u32;
    let result_limit = limit.unwrap_or(50).min(100) as usize;
    let client = build_client()?;

    let url = format!("{MCP_REGISTRY_BASE}{MCP_REGISTRY_SERVERS}");
    let limit_str = fetch_limit.to_string();

    let response = send_with_retry(
        &client,
        |c| {
            c.get(&url)
                .query(&[("limit", limit_str.as_str())])
                .header("Accept", "application/json")
        },
        "MCP Registry search",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "MCP Registry returned status {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse MCP Registry response: {err}"))?;

    let items = body
        .get("servers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let query_lower = query.to_lowercase();
    let has_query = !query_lower.trim().is_empty();

    let results: Vec<McpHubResult> = items
        .iter()
        .filter_map(parse_server_entry)
        .filter(|result| {
            if !has_query {
                return true;
            }
            result.name.to_lowercase().contains(&query_lower)
                || result
                    .title
                    .as_deref()
                    .map(|t| t.to_lowercase().contains(&query_lower))
                    .unwrap_or(false)
                || result.description.to_lowercase().contains(&query_lower)
        })
        .take(result_limit)
        .collect();

    Ok(results)
}

// ── Detail ──

/// Fetch full detail for a specific MCP server from the registry.
#[tauri::command]
pub async fn mcp_hub_detail(server_name: String) -> Result<McpHubDetail, String> {
    if server_name.trim().is_empty() {
        return Err("Server name is required".to_string());
    }

    let client = build_client()?;
    let encoded_name = urlencoding::encode(&server_name);
    let url = format!("{MCP_REGISTRY_BASE}{MCP_REGISTRY_SERVERS}/{encoded_name}/versions/latest");

    let response = send_with_retry(
        &client,
        |c| c.get(&url).header("Accept", "application/json"),
        "MCP Registry detail",
    )
    .await?;

    if !response.status().is_success() {
        return Err(format!(
            "MCP Registry detail returned status {}",
            response.status()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse server detail: {err}"))?;

    parse_server_detail(&body)
}

// ── Install ──

/// Install an MCP server from the registry into the user's global config.
///
/// Fetches the server detail, picks the best transport (preferring remotes
/// over packages), and writes an entry into `~/.orgii/mcp-servers.json`.
#[tauri::command]
pub async fn mcp_hub_install(server_name: String) -> Result<McpHubInstallResult, String> {
    if server_name.trim().is_empty() {
        return Err("Server name is required".to_string());
    }

    let detail = mcp_hub_detail(server_name.clone()).await?;

    let short_name = detail
        .name
        .rsplit('/')
        .next()
        .unwrap_or(&detail.name)
        .to_string();

    let (config, transport_label) = if let Some(remote) = detail.remotes.first() {
        let transport_type = match remote.remote_type.as_str() {
            "sse" => McpTransportType::Sse,
            _ => McpTransportType::StreamableHttp,
        };
        let config = McpServerConfig {
            transport_type,
            url: Some(remote.url.clone()),
            command: None,
            args: None,
            cwd: None,
            env: None,
            headers: None,
            auto_approve: None,
            disabled: false,
            timeout: 30,
        };
        (config, remote.remote_type.clone())
    } else if let Some(pkg) = detail.packages.first() {
        let transport_type_str = pkg
            .transport
            .as_ref()
            .map(|t| t.transport_type.as_str())
            .unwrap_or("stdio");

        if transport_type_str == "stdio" {
            let command = match pkg.registry_type.as_str() {
                "npm" => "npx".to_string(),
                "pip" | "pypi" => "uvx".to_string(),
                "docker" | "oci" => "docker".to_string(),
                _ => "npx".to_string(),
            };

            let args = match pkg.registry_type.as_str() {
                "npm" => vec!["-y".to_string(), pkg.identifier.clone()],
                "pip" | "pypi" => vec![pkg.identifier.clone()],
                "docker" | "oci" => vec![
                    "run".to_string(),
                    "-i".to_string(),
                    "--rm".to_string(),
                    pkg.identifier.clone(),
                ],
                _ => vec![pkg.identifier.clone()],
            };

            let config = McpServerConfig {
                transport_type: McpTransportType::Stdio,
                command: Some(command),
                args: Some(args),
                cwd: None,
                env: None,
                url: None,
                headers: None,
                auto_approve: None,
                disabled: false,
                timeout: 30,
            };
            (config, "stdio".to_string())
        } else {
            return Err(format!(
                "Package transport type '{transport_type_str}' is not supported for auto-install"
            ));
        }
    } else {
        return Err("Server has no remotes or packages — cannot auto-configure".to_string());
    };

    let config_path = global_config_path();
    insert_server_config(&config_path, short_name.clone(), config)?;

    Ok(McpHubInstallResult {
        server_name: short_name,
        transport_type: transport_label,
    })
}
