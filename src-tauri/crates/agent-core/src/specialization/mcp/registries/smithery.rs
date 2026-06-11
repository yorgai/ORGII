//! Smithery — browse and install MCP servers from the Smithery registry.
//!
//! API docs: <https://smithery.ai/docs/registry>
//! Base URL: `https://registry.smithery.ai`

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::mcp::config::{
    global_config_path, insert_server_config, McpServerConfig, McpTransportType,
};
use crate::utils::http_retry::send_with_retry;

const SMITHERY_BASE: &str = "https://registry.smithery.ai";

// ── API response types (internal, not exposed to frontend) ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryListResponse {
    servers: Vec<SmitheryServerEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryServerEntry {
    qualified_name: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    use_count: Option<serde_json::Value>,
    #[serde(default)]
    is_deployed: Option<bool>,
    #[serde(default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryDetailResponse {
    qualified_name: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    deployment_url: Option<String>,
    #[serde(default)]
    connections: Vec<SmitheryConnection>,
    #[serde(default)]
    tools: Option<Vec<SmitheryTool>>,
    #[serde(default)]
    security: Option<SmitherySecurity>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryConnection {
    #[serde(rename = "type")]
    connection_type: String,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryTool {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitherySecurity {
    #[serde(default)]
    scan_passed: Option<bool>,
}

// ── Types returned to the frontend ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryResult {
    pub qualified_name: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub use_count: Option<u64>,
    #[serde(default)]
    pub is_deployed: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryDetail {
    pub qualified_name: String,
    pub display_name: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub deployment_url: Option<String>,
    pub connections: Vec<SmitheryConnectionInfo>,
    #[serde(default)]
    pub tools: Vec<SmitheryToolInfo>,
    #[serde(default)]
    pub security_scan_passed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryConnectionInfo {
    #[serde(rename = "type")]
    pub connection_type: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryInstallResult {
    pub server_name: String,
    pub transport_type: String,
}

// ── Helpers ──

fn build_client(api_key: &str) -> Result<Client, String> {
    use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

    let mut headers = HeaderMap::new();
    let auth_value = format!("Bearer {api_key}");
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value)
            .map_err(|err| format!("Invalid API key format: {err}"))?,
    );

    Client::builder()
        .user_agent("orgii-mcp-hub/1.0")
        .default_headers(headers)
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))
}

fn parse_use_count(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

// ── Search ──

#[tauri::command]
pub async fn smithery_search(
    api_key: String,
    query: String,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<Vec<SmitheryResult>, String> {
    if api_key.trim().is_empty() {
        return Err("Smithery API key is required".to_string());
    }

    let client = build_client(&api_key)?;
    let page_val = page.unwrap_or(1);
    let size_val = page_size.unwrap_or(50).min(100);

    let page_str = page_val.to_string();
    let size_str = size_val.to_string();
    let has_query = !query.trim().is_empty();

    let response = send_with_retry(
        &client,
        |c| {
            let req = c
                .get(format!("{SMITHERY_BASE}/servers"))
                .query(&[("page", page_str.as_str()), ("pageSize", size_str.as_str())]);
            if has_query {
                req.query(&[("q", query.as_str())])
            } else {
                req
            }
        },
        "Smithery search",
    )
    .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = crate::utils::response_text_or_read_error(response).await;
        return Err(format!("Smithery returned status {status}: {body}"));
    }

    let data: SmitheryListResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse Smithery response: {err}"))?;

    let results = data
        .servers
        .into_iter()
        .map(|entry| SmitheryResult {
            display_name: entry
                .display_name
                .unwrap_or_else(|| entry.qualified_name.clone()),
            description: entry.description.unwrap_or_default(),
            homepage: entry.homepage,
            use_count: entry.use_count.as_ref().and_then(parse_use_count),
            is_deployed: entry.is_deployed.unwrap_or(false),
            created_at: entry.created_at,
            qualified_name: entry.qualified_name,
        })
        .collect();

    Ok(results)
}

// ── Detail ──

#[tauri::command]
pub async fn smithery_detail(
    api_key: String,
    qualified_name: String,
) -> Result<SmitheryDetail, String> {
    if api_key.trim().is_empty() {
        return Err("Smithery API key is required".to_string());
    }
    if qualified_name.trim().is_empty() {
        return Err("Server name is required".to_string());
    }

    let client = build_client(&api_key)?;
    let encoded = urlencoding::encode(&qualified_name);
    let url = format!("{SMITHERY_BASE}/servers/{encoded}");

    let response = send_with_retry(&client, |c| c.get(&url), "Smithery detail").await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = crate::utils::response_text_or_read_error(response).await;
        return Err(format!("Smithery detail returned status {status}: {body}"));
    }

    let data: SmitheryDetailResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse Smithery detail: {err}"))?;

    Ok(SmitheryDetail {
        display_name: data
            .display_name
            .unwrap_or_else(|| data.qualified_name.clone()),
        icon_url: data.icon_url,
        deployment_url: data.deployment_url,
        connections: data
            .connections
            .into_iter()
            .map(|conn| SmitheryConnectionInfo {
                connection_type: conn.connection_type,
                url: conn.url,
            })
            .collect(),
        tools: data
            .tools
            .unwrap_or_default()
            .into_iter()
            .map(|tool| SmitheryToolInfo {
                name: tool.name,
                description: tool.description,
            })
            .collect(),
        security_scan_passed: data.security.and_then(|s| s.scan_passed),
        qualified_name: data.qualified_name,
    })
}

// ── Install ──

#[tauri::command]
pub async fn smithery_install(
    api_key: String,
    qualified_name: String,
) -> Result<SmitheryInstallResult, String> {
    let detail = smithery_detail(api_key, qualified_name).await?;

    let short_name = detail
        .qualified_name
        .rsplit('/')
        .next()
        .unwrap_or(&detail.qualified_name)
        .to_string();

    let conn = detail
        .connections
        .first()
        .ok_or("Server has no connections — cannot auto-configure")?;

    let (config, transport_label) = match conn.connection_type.as_str() {
        "sse" => {
            let url = conn
                .url
                .clone()
                .or(detail.deployment_url.clone())
                .ok_or("SSE connection has no URL")?;
            let config = McpServerConfig {
                transport_type: McpTransportType::Sse,
                url: Some(url),
                command: None,
                args: None,
                cwd: None,
                env: None,
                headers: None,
                auto_approve: None,
                disabled: false,
                timeout: 30,
            };
            (config, "sse".to_string())
        }
        "streamable-http" | "http" => {
            let url = conn
                .url
                .clone()
                .or(detail.deployment_url.clone())
                .ok_or("HTTP connection has no URL")?;
            let config = McpServerConfig {
                transport_type: McpTransportType::StreamableHttp,
                url: Some(url),
                command: None,
                args: None,
                cwd: None,
                env: None,
                headers: None,
                auto_approve: None,
                disabled: false,
                timeout: 30,
            };
            (config, "streamable-http".to_string())
        }
        "stdio" => {
            return Err(
                "Smithery stdio connections require manual configuration — use the Add Server wizard instead".to_string(),
            );
        }
        other => {
            return Err(format!(
                "Unsupported connection type '{other}' for auto-install"
            ));
        }
    };

    let config_path = global_config_path();
    insert_server_config(&config_path, short_name.clone(), config)?;

    Ok(SmitheryInstallResult {
        server_name: short_name,
        transport_type: transport_label,
    })
}
