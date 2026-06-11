//! Resource listing/reading.

use super::McpManager;
use crate::specialization::mcp::resources::{McpResource, McpResourceContent, McpResourceTemplate};

impl McpManager {
    /// List resources from a specific server.
    pub async fn list_resources(&self, server_name: &str) -> Result<Vec<McpResource>, String> {
        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };

        if !client.has_resources().await {
            return Ok(Vec::new());
        }

        let (resources, _cursor) = client.list_resources(None).await?;
        Ok(resources)
    }

    /// Read a resource from a specific server.
    pub async fn read_resource(
        &self,
        server_name: &str,
        uri: &str,
    ) -> Result<Vec<McpResourceContent>, String> {
        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };

        client.read_resource(uri).await
    }

    /// List resource templates from a specific server.
    pub async fn list_resource_templates(
        &self,
        server_name: &str,
    ) -> Result<Vec<McpResourceTemplate>, String> {
        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };

        let (templates, _cursor) = client.list_resource_templates(None).await?;
        Ok(templates)
    }

    /// Get all resources from all connected servers.
    pub async fn all_resources(&self) -> Vec<(String, McpResource)> {
        let clients = self.clients.lock().await;
        let mut result = Vec::new();

        for (server_name, client) in clients.iter() {
            if !client.is_alive() || !client.has_resources().await {
                continue;
            }
            if let Ok((resources, _)) = client.list_resources(None).await {
                for resource in resources {
                    result.push((server_name.clone(), resource));
                }
            }
        }

        result
    }
}
