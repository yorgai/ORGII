//! MCP server registry integrations (bar, glama, hub, smithery).

pub mod bar;
pub mod glama;
pub mod hub;
pub mod smithery;

use reqwest::Client;

/// Shared HTTP client for public (no-auth) MCP registry APIs.
///
/// All public registries (bar, glama, hub) use the same `orgii-mcp-hub/1.0`
/// user-agent and default timeouts. Smithery has its own builder because it
/// needs a bearer-token auth header.
pub(super) fn build_public_client(timeout: Option<std::time::Duration>) -> Result<Client, String> {
    let mut builder = Client::builder().user_agent("orgii-mcp-hub/1.0");
    if let Some(t) = timeout {
        builder = builder.timeout(t).use_rustls_tls();
    }
    builder
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))
}
