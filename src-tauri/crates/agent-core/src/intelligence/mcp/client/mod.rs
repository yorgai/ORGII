//! MCP client — thin wrapper around `rmcp::service::RunningService<RoleClient>`.
//!
//! Built on top of the official `rmcp` crate to eliminate framing bugs
//! and pick up upstream fixes automatically.
//!
//! Public API is intentionally stable: `McpManager` only sees `McpClient`,
//! `McpToolDef`, `McpServerStatus`, `McpConnectionStatus`, `ServerCapabilities`,
//! and the resource types.
//!
//! ## Module layout
//!
//! The `McpClient` impl is split across files by concern. Types, free
//! functions, the struct definition, and tests live here; everything
//! else co-locates with its concern:
//!
//! - [`connect`] — `connect`, `refresh_tools` (handshake + tool discovery).
//! - [`call`] — `call_tool_typed`, `call_tool_typed_with_progress`,
//!   `record_error`.
//! - [`state`] — accessors (`tools`, `name`, `config`, `is_alive`, `status`,
//!   `shutdown`) and notification-channel helpers (`take_notification_rx`,
//!   `debug_push_notification`).
//! - [`resources`] — `has_resources`, `list_resources`, `read_resource`,
//!   `list_resource_templates`.
//! - [`prompts`] — `has_prompts`, `list_prompts`, `get_prompt`.

mod call;
mod connect;
mod prompts;
mod resources;
mod state;

use rmcp::model::{ClientCapabilities, ClientInfo, Implementation};
use rmcp::service::{RoleClient, RunningService};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize};
use tokio::sync::{mpsc, Mutex};

use super::config::{McpConfigScope, McpServerConfig};
use super::handler::AgentClientHandler;
use super::notification::ServerNotification;

/// Max consecutive **terminal** connection errors before we flip the
/// `alive` flag off and force the manager to reconnect.
pub const MAX_ERRORS_BEFORE_RECONNECT: usize = 3;

// ============================================
// MCP Protocol Types (kept stable for callers)
// ============================================

/// Tool definition returned by `tools/list`.
///
/// Kept as a plain-JSON shape so bridge/UI code does not depend on rmcp's
/// internal `Tool` struct. We convert at the boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum McpConnectionStatus {
    Connected,
    Connecting,
    Disconnected,
    Error,
    /// Server is installed but needs an OAuth / API-key handshake before
    /// its real tools can be used. While in this state the `McpManager`
    /// surfaces a `mcp__<server>__authenticate` pseudo-tool instead of
    /// the server's advertised tools.
    NeedsAuth,
    /// User has flipped the per-server toggle off. The config entry is
    /// still on disk but no child process is running and agents do not
    /// see the server's tools. Distinct from `Disconnected` (which means
    /// "should be running but isn't") so the UI can render a grey pill
    /// instead of a red error state.
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    pub status: McpConnectionStatus,
    pub tool_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub transport_type: String,
    /// Mirror of the on-disk `disabled` flag so the UI can render a
    /// toggle independent of the connection status (e.g. a `Connecting`
    /// row that was just re-enabled still shows the toggle as on).
    #[serde(default)]
    pub disabled: bool,
    /// Unix milliseconds when the current `rmcp` service session was
    /// established. `None` for non-connected states. Used to compute
    /// uptime in the detail drawer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<i64>,
    /// Which config file this server comes from.
    /// `"global"` → `~/.orgii/mcp-servers.json`;
    /// `"workspace"` → `<workspace>/.orgii/mcp-servers.json`.
    /// When a name exists in both files, the workspace entry wins and
    /// `scope` is `"workspace"`.
    pub scope: McpConfigScope,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ServerCapabilities {
    pub(crate) has_tools: bool,
    pub(crate) tools_list_changed: bool,
    pub(crate) has_resources: bool,
    pub(crate) resources_subscribe: bool,
    pub(crate) resources_list_changed: bool,
    pub(crate) has_prompts: bool,
    pub(crate) prompts_list_changed: bool,
}

// ============================================
// McpClient
// ============================================

/// A single MCP server connection backed by `rmcp`.
pub struct McpClient {
    pub(super) name: String,
    pub(super) config: McpServerConfig,
    pub(super) service: Mutex<Option<RunningService<RoleClient, AgentClientHandler>>>,
    pub(super) tools: Mutex<Vec<McpToolDef>>,
    pub(super) last_error: Mutex<Option<String>>,
    pub(super) capabilities: Mutex<ServerCapabilities>,
    pub(super) notification_rx: Mutex<Option<mpsc::Receiver<ServerNotification>>>,
    /// Retained sender for the same channel `notification_rx` consumes from.
    /// Production code never uses it — only the fan-out task spawned in
    /// [`connect::McpClient::connect`] pushes real notifications here. It
    /// exists so debug builds can inject synthetic notifications through
    /// [`state::McpClient::debug_push_notification`] for E2E tests that
    /// verify the manager listener fires on each MCP notification kind
    /// without needing a live MCP server that emits `list_changed` on
    /// demand.
    #[cfg(debug_assertions)]
    pub(super) notification_tx: mpsc::Sender<ServerNotification>,
    #[cfg(not(debug_assertions))]
    pub(super) _notification_tx: mpsc::Sender<ServerNotification>,
    pub(super) alive: AtomicBool,
    /// Count of consecutive terminal errors (auth/session-expired/
    /// transport/timeout). Cleared on every successful tool call.
    /// When it crosses [`MAX_ERRORS_BEFORE_RECONNECT`] we flip `alive`
    /// to `false` so the manager's next call reconnects the transport.
    pub(super) consecutive_terminal_errors: AtomicUsize,
    /// Unix milliseconds when the current `rmcp` service finished its
    /// MCP handshake. Set in `connect()`, cleared in `shutdown()`.
    /// Surfaced via `status().connected_at` so the UI can compute
    /// uptime without holding its own start-time map.
    pub(super) connected_at_ms: AtomicI64,
}

/// Build the default `ClientInfo` we advertise to every MCP server.
///
/// Kept as a free function so tests can inspect it without spinning up a
/// full client.
pub(crate) fn default_client_info() -> ClientInfo {
    ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("orgii-agent", env!("CARGO_PKG_VERSION")),
    )
}

/// Resolve the connect-phase timeout for a given server.
///
/// Priority:
/// 1. `MCP_TIMEOUT` env var (milliseconds) — global override, wins over config.
/// 2. `config.timeout` (seconds) — per-server override in `mcp-servers.json`.
/// 3. 30_000 ms default.
pub(super) fn resolve_connect_timeout(config: &McpServerConfig) -> std::time::Duration {
    if let Ok(raw) = std::env::var("MCP_TIMEOUT") {
        if let Ok(ms) = raw.parse::<u64>() {
            if ms > 0 {
                return std::time::Duration::from_millis(ms);
            }
        }
    }
    if config.timeout > 0 {
        return std::time::Duration::from_secs(config.timeout);
    }
    std::time::Duration::from_secs(30)
}

/// Resolve the per-tool-call timeout.
///
/// Priority:
/// 1. `MCP_TOOL_TIMEOUT` env var (milliseconds).
/// 2. 100_000_000 ms default (~27.8 hours — tools with their own
///    internal timeouts handle the real bound; this is a safety net
///    against genuinely stuck servers).
pub(super) fn resolve_tool_timeout() -> std::time::Duration {
    if let Ok(raw) = std::env::var("MCP_TOOL_TIMEOUT") {
        if let Ok(ms) = raw.parse::<u64>() {
            if ms > 0 {
                return std::time::Duration::from_millis(ms);
            }
        }
    }
    std::time::Duration::from_millis(100_000_000)
}

/// Flatten rmcp's `PromptMessageContent` into a plain string. Text
/// passes through; images/resources/links become bracketed placeholders
/// so the chat input always ends up with a printable body.
pub(super) fn render_prompt_content(content: &rmcp::model::PromptMessageContent) -> String {
    use rmcp::model::{PromptMessageContent, ResourceContents};

    match content {
        PromptMessageContent::Text { text } => text.clone(),
        PromptMessageContent::Image { image } => format!(
            "[Image: {} ({} bytes base64)]",
            image.mime_type,
            image.data.len()
        ),
        PromptMessageContent::Resource { resource } => match &resource.resource {
            ResourceContents::TextResourceContents { uri, text, .. } => {
                format!("[Resource: {}]\n{}", uri, text)
            }
            ResourceContents::BlobResourceContents { uri, blob, .. } => {
                format!("[Resource: {} ({} bytes base64)]", uri, blob.len())
            }
        },
        PromptMessageContent::ResourceLink { link } => {
            format!("[ResourceLink: {}]", link.raw.uri)
        }
    }
}

/// Flatten rmcp's `Vec<Content>` into a string.
///
/// - `text`            → push verbatim
/// - `image` / `audio` → `[Image|Audio mime (N bytes base64)]` placeholder
/// - `resource`        → inline text or `[Resource uri (N bytes base64)]`
/// - `resource_link`   → `[ResourceLink uri]`
///
/// When *all* blocks are unrenderable we fall back to pretty-printing
/// `structured_content` so the agent never sees an empty result.
pub(super) fn render_content(
    content: &[rmcp::model::Content],
    structured: &Option<Value>,
) -> String {
    use rmcp::model::{RawContent, ResourceContents};

    let mut parts: Vec<String> = Vec::new();
    for block in content {
        match &block.raw {
            RawContent::Text(text) => parts.push(text.text.clone()),
            RawContent::Image(image) => {
                parts.push(format!(
                    "[Image: {} ({} bytes base64)]",
                    image.mime_type,
                    image.data.len()
                ));
            }
            RawContent::Audio(audio) => {
                parts.push(format!(
                    "[Audio: {} ({} bytes base64)]",
                    audio.mime_type,
                    audio.data.len()
                ));
            }
            RawContent::Resource(embedded) => match &embedded.resource {
                ResourceContents::TextResourceContents { uri, text, .. } => {
                    parts.push(format!("[Resource: {}]\n{}", uri, text));
                }
                ResourceContents::BlobResourceContents { uri, blob, .. } => {
                    parts.push(format!("[Resource: {} ({} bytes base64)]", uri, blob.len()));
                }
            },
            RawContent::ResourceLink(link) => {
                parts.push(format!("[ResourceLink: {}]", link.uri));
            }
        }
    }

    if parts.is_empty() {
        if let Some(sc) = structured {
            // `sc` is a `serde_json::Value`, which is structurally
            // always serializable — Rule 41: crash on the impossible
            // failure mode rather than mask it with a literal "null"
            // that would look like a successful empty result to the
            // tool caller.
            return serde_json::to_string_pretty(sc)
                .expect("structured is serde_json::Value, must serialize");
        }
        return String::new();
    }
    parts.join("\n")
}

/// Lossless projection of rmcp `Content` blocks into the
/// provider-agnostic `ToolContentBlock` enum used by `ToolExecuteResult`.
///
/// The resulting vector preserves every block (text, image, audio,
/// resource, resource_link) so downstream consumers — diagnostics UI
/// today, the Anthropic-native wire format — can access the raw
/// bytes/URIs without re-parsing the flattened `render_content` string.
///
/// Unknown `rmcp` content variants are skipped (they would also be
/// skipped by `render_content`); the `non_exhaustive` nature of `rmcp`'s
/// `RawContent` enum is the reason we do *not* panic on unrecognized
/// variants.
pub(super) fn extract_content_blocks(
    content: &[rmcp::model::Content],
) -> Vec<crate::tools::traits::ToolContentBlock> {
    use crate::tools::traits::ToolContentBlock;
    use rmcp::model::{RawContent, ResourceContents};

    let mut out = Vec::with_capacity(content.len());
    for block in content {
        match &block.raw {
            RawContent::Text(text) => out.push(ToolContentBlock::Text {
                text: text.text.clone(),
            }),
            RawContent::Image(image) => out.push(ToolContentBlock::Image {
                mime_type: image.mime_type.clone(),
                data: image.data.clone(),
            }),
            RawContent::Audio(audio) => out.push(ToolContentBlock::Audio {
                mime_type: audio.mime_type.clone(),
                data: audio.data.clone(),
            }),
            RawContent::Resource(embedded) => match &embedded.resource {
                ResourceContents::TextResourceContents {
                    uri,
                    mime_type,
                    text,
                    ..
                } => out.push(ToolContentBlock::Resource {
                    uri: uri.clone(),
                    mime_type: mime_type.clone(),
                    text: Some(text.clone()),
                }),
                ResourceContents::BlobResourceContents { uri, mime_type, .. } => {
                    out.push(ToolContentBlock::Resource {
                        uri: uri.clone(),
                        mime_type: mime_type.clone(),
                        text: None,
                    });
                }
            },
            RawContent::ResourceLink(link) => out.push(ToolContentBlock::ResourceLink {
                uri: link.uri.clone(),
                name: Some(link.name.clone()),
                description: link.description.clone(),
            }),
        }
    }
    out
}

#[cfg(test)]
mod extract_content_blocks_tests {
    //! Safety net: ensure MCP image / audio / resource payloads survive
    //! the rmcp → `ToolContentBlock` projection without loss of bytes
    //! or URIs. The flattened `render_content` string is a lossy
    //! placeholder for these; the structured blocks are what the
    //! Anthropic-native wire consumes.
    use super::extract_content_blocks;
    use crate::tools::traits::ToolContentBlock;
    use rmcp::model::{Content, RawResource, ResourceContents};

    #[test]
    fn text_block_round_trips() {
        let blocks = extract_content_blocks(&[Content::text("hello")]);
        assert_eq!(blocks.len(), 1);
        match &blocks[0] {
            ToolContentBlock::Text { text } => assert_eq!(text, "hello"),
            other => panic!("expected Text, got {:?}", other),
        }
    }

    #[test]
    fn image_preserves_base64_and_mime() {
        let blocks = extract_content_blocks(&[Content::image("ZmFrZQ==", "image/png")]);
        match &blocks[0] {
            ToolContentBlock::Image { mime_type, data } => {
                assert_eq!(mime_type, "image/png");
                assert_eq!(data, "ZmFrZQ==");
            }
            other => panic!("expected Image, got {:?}", other),
        }
    }

    #[test]
    fn text_resource_preserves_uri_mime_and_text() {
        let resource = Content::resource(ResourceContents::TextResourceContents {
            uri: "file:///etc/hosts".into(),
            mime_type: Some("text/plain".into()),
            text: "127.0.0.1 localhost".into(),
            meta: None,
        });
        let blocks = extract_content_blocks(&[resource]);
        match &blocks[0] {
            ToolContentBlock::Resource {
                uri,
                mime_type,
                text,
            } => {
                assert_eq!(uri, "file:///etc/hosts");
                assert_eq!(mime_type.as_deref(), Some("text/plain"));
                assert_eq!(text.as_deref(), Some("127.0.0.1 localhost"));
            }
            other => panic!("expected Resource, got {:?}", other),
        }
    }

    #[test]
    fn blob_resource_becomes_uri_without_blob() {
        let resource = Content::resource(ResourceContents::BlobResourceContents {
            uri: "mcp://data/pic.png".into(),
            mime_type: Some("image/png".into()),
            blob: "EQUALSEQUALSEQUALSEQUALS".into(),
            meta: None,
        });
        let blocks = extract_content_blocks(&[resource]);
        match &blocks[0] {
            ToolContentBlock::Resource {
                uri,
                mime_type,
                text,
            } => {
                assert_eq!(uri, "mcp://data/pic.png");
                assert_eq!(mime_type.as_deref(), Some("image/png"));
                assert!(text.is_none(), "blob payload must NOT be inlined");
            }
            other => panic!("expected Resource, got {:?}", other),
        }
    }

    #[test]
    fn resource_link_preserves_uri_and_name() {
        let link = Content::resource_link(RawResource {
            uri: "mcp://link/item".into(),
            name: "item".into(),
            title: None,
            description: Some("a test item".into()),
            mime_type: None,
            size: None,
            icons: None,
            meta: None,
        });
        let blocks = extract_content_blocks(&[link]);
        match &blocks[0] {
            ToolContentBlock::ResourceLink {
                uri,
                name,
                description,
            } => {
                assert_eq!(uri, "mcp://link/item");
                assert_eq!(name.as_deref(), Some("item"));
                assert_eq!(description.as_deref(), Some("a test item"));
            }
            other => panic!("expected ResourceLink, got {:?}", other),
        }
    }

    #[test]
    fn mixed_blocks_keep_order() {
        let blocks = extract_content_blocks(&[
            Content::text("first"),
            Content::image("b64", "image/png"),
            Content::text("last"),
        ]);
        assert_eq!(blocks.len(), 3);
        matches!(blocks[0], ToolContentBlock::Text { .. });
        matches!(blocks[1], ToolContentBlock::Image { .. });
        matches!(blocks[2], ToolContentBlock::Text { .. });
    }
}
