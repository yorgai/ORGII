//! Detector for external MCP server configurations.
//!
//! Scans well-known `mcpServers` JSON files from Cursor, Claude Code,
//! and VS Code and surfaces each server entry as a `DetectedItem` of
//! kind `Mcp`.

use std::path::Path;

use super::super::types::{DetectedItem, ItemKind, ItemPreview, SourceAgent, SourceScope};
use super::helpers::{home_dir, orgii_mcp_exists, path_has_denied_ancestor, MAX_ITEMS_PER_BATCH};
use crate::specialization::mcp::config::{McpConfigFile, McpTransportType};

pub(super) fn detect_mcp_servers(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let scope = SourceScope::WorkspaceLocal {
            repo_path: repo.to_path_buf(),
        };
        let candidates = [
            (
                repo.join(".cursor").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
            (
                repo.join(".cursor").join("mcp-servers.json"),
                SourceAgent::CursorIde,
            ),
            (
                repo.join(".claude").join("mcp.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                repo.join(".claude").join("mcp-servers.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                repo.join(".vscode").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
        ];
        for (path, source_agent) in candidates {
            scan_mcp_config_file(&path, source_agent, scope.clone(), Some(repo), &mut out);
        }
    } else if let Some(home) = home_dir() {
        let candidates = [
            (
                home.join(".cursor").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
            (
                home.join(".cursor").join("mcp-servers.json"),
                SourceAgent::CursorIde,
            ),
            (
                home.join(".claude").join("mcp.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                home.join(".claude").join("mcp-servers.json"),
                SourceAgent::ClaudeCode,
            ),
        ];
        for (path, source_agent) in candidates {
            scan_mcp_config_file(&path, source_agent, SourceScope::UserGlobal, None, &mut out);
        }
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

fn load_external_mcp_config(path: &Path) -> Result<McpConfigFile, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read MCP config {}: {}", path.display(), err))?;
    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse MCP config {}: {}", path.display(), err))?;
    let Some(servers) = value
        .get_mut("mcpServers")
        .and_then(|entry| entry.as_object_mut())
    else {
        return Ok(McpConfigFile::default());
    };

    for server in servers.values_mut() {
        let Some(server_obj) = server.as_object_mut() else {
            continue;
        };
        if !server_obj.contains_key("type") {
            let inferred = if server_obj.contains_key("url") {
                "streamableHttp"
            } else {
                "stdio"
            };
            server_obj.insert(
                "type".to_string(),
                serde_json::Value::String(inferred.to_string()),
            );
        }
        if server_obj.get("type").and_then(|entry| entry.as_str()) == Some("http") {
            server_obj.insert(
                "type".to_string(),
                serde_json::Value::String("streamableHttp".to_string()),
            );
        }
    }

    serde_json::from_value(value).map_err(|err| {
        format!(
            "Failed to parse MCP server entries {}: {}",
            path.display(),
            err
        )
    })
}

fn scan_mcp_config_file(
    path: &Path,
    source_agent: SourceAgent,
    source_scope: SourceScope,
    target_repo_path: Option<&Path>,
    out: &mut Vec<DetectedItem>,
) {
    if !path.is_file() || path_has_denied_ancestor(path) {
        return;
    }

    let Ok(config) = load_external_mcp_config(path) else {
        return;
    };

    for (name, server_config) in config.mcp_servers {
        if out.iter().filter(|item| item.kind == ItemKind::Mcp).count() >= MAX_ITEMS_PER_BATCH {
            return;
        }
        if name.is_empty() {
            continue;
        }
        let summary = match server_config.transport_type {
            McpTransportType::Stdio => server_config
                .command
                .clone()
                .unwrap_or_else(|| "stdio MCP server".to_string()),
            McpTransportType::Sse => server_config
                .url
                .clone()
                .unwrap_or_else(|| "SSE MCP server".to_string()),
            McpTransportType::StreamableHttp => server_config
                .url
                .clone()
                .unwrap_or_else(|| "Streamable HTTP MCP server".to_string()),
        };
        let already_imported = orgii_mcp_exists(target_repo_path, &name);
        out.push(DetectedItem {
            source_agent,
            source_scope: source_scope.clone(),
            kind: ItemKind::Mcp,
            source_path: path.to_path_buf(),
            suggested_name: name,
            already_imported,
            fidelity_warnings: Vec::new(),
            preview: ItemPreview {
                summary,
                frontmatter: Vec::new(),
                size_bytes: std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0),
            },
        });
    }
}
