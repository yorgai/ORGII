//! MCP handshake (`connect`) and tool discovery (`refresh_tools`).

use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use rmcp::ServiceExt;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize};
use tokio::process::Command as TokioCommand;
use tokio::sync::{mpsc, Mutex};
use tracing::info;

use super::{resolve_connect_timeout, McpClient, McpToolDef, ServerCapabilities};
use crate::specialization::mcp::config::{McpServerConfig, McpTransportType};
use crate::specialization::mcp::handler::{AgentClientHandler, HandlerEvent};
use crate::specialization::mcp::notification::ServerNotification;

fn serialize_tool_input_schema<T: Serialize>(
    server_name: &str,
    tool_name: &str,
    schema: &T,
) -> Result<Value, String> {
    serde_json::to_value(schema).map_err(|err| {
        format!(
            "serialize input schema for MCP tool '{}::{}': {}",
            server_name, tool_name, err
        )
    })
}

impl McpClient {
    pub async fn connect(name: &str, config: &McpServerConfig) -> Result<Self, String> {
        // Expand `${VAR}` / `${VAR:-default}` on a clone so the stored config
        // still reflects what the user wrote on disk (we never overwrite
        // their secrets). If expansion fails (e.g. a referenced env var is
        // missing), surface it as a connection error rather than connecting
        // with a half-substituted command line.
        let mut expanded = config.clone();
        crate::specialization::mcp::env_expansion::expand_server_config(&mut expanded)
            .map_err(|err| err.to_string())?;

        let (notif_tx, notif_rx) = mpsc::channel::<ServerNotification>(64);
        let (event_tx, mut event_rx) = mpsc::channel::<HandlerEvent>(64);
        let handler = AgentClientHandler::new(event_tx);

        let connect_timeout = resolve_connect_timeout(&expanded);

        let serve_future =
            async {
                match expanded.transport_type {
                    McpTransportType::Stdio => {
                        let command = expanded.command.as_deref().ok_or_else(|| {
                            "stdio transport requires a 'command' field".to_string()
                        })?;
                        let args = expanded.args.as_deref().unwrap_or(&[]);

                        let mut cmd = TokioCommand::new(command);
                        cmd.args(args);
                        if let Some(cwd) = expanded.cwd.as_deref() {
                            cmd.current_dir(cwd);
                        }
                        if let Some(env) = expanded.env.as_ref() {
                            for (k, v) in env {
                                cmd.env(k, v);
                            }
                        }

                        // Windows: stdio MCP servers are console programs; without
                        // this each one would flash a console window on spawn.
                        #[cfg(windows)]
                        cmd.creation_flags(app_platform::CREATE_NO_WINDOW);

                        let child = TokioChildProcess::new(cmd)
                            .map_err(|err| format!("Failed to spawn '{}': {}", command, err))?;
                        handler
                            .serve(child)
                            .await
                            .map_err(|err| format!("MCP initialize failed for '{}': {}", name, err))
                    }
                    McpTransportType::StreamableHttp | McpTransportType::Sse => {
                        let url = expanded.url.as_deref().ok_or_else(|| {
                            "HTTP/SSE transport requires a 'url' field".to_string()
                        })?;
                        let transport = StreamableHttpClientTransport::from_uri(url);
                        handler
                            .serve(transport)
                            .await
                            .map_err(|err| format!("MCP initialize failed for '{}': {}", name, err))
                    }
                }
            };

        let service = tokio::time::timeout(connect_timeout, serve_future)
            .await
            .map_err(|_| {
                format!(
                    "MCP connect to '{}' timed out after {:?} (set MCP_TIMEOUT to override)",
                    name, connect_timeout
                )
            })??;

        let server_info = service.peer_info().cloned();
        let mut caps = ServerCapabilities::default();
        if let Some(info) = &server_info {
            if let Some(tools) = info.capabilities.tools.as_ref() {
                caps.has_tools = true;
                caps.tools_list_changed = tools.list_changed.unwrap_or(false);
            }
            if let Some(resources) = info.capabilities.resources.as_ref() {
                caps.has_resources = true;
                caps.resources_subscribe = resources.subscribe.unwrap_or(false);
                caps.resources_list_changed = resources.list_changed.unwrap_or(false);
            }
            if let Some(prompts) = info.capabilities.prompts.as_ref() {
                caps.has_prompts = true;
                caps.prompts_list_changed = prompts.list_changed.unwrap_or(false);
            }
        }

        // Fan out HandlerEvents → ServerNotification channel so `McpManager`'s
        // existing notification listener keeps working unchanged.
        let fanout_tx = notif_tx.clone();
        tokio::spawn(async move {
            while let Some(ev) = event_rx.recv().await {
                let (method, params): (&str, Option<Value>) = match ev {
                    HandlerEvent::ToolListChanged => ("notifications/tools/list_changed", None),
                    HandlerEvent::PromptListChanged => ("notifications/prompts/list_changed", None),
                    HandlerEvent::ResourceListChanged => {
                        ("notifications/resources/list_changed", None)
                    }
                    HandlerEvent::ResourceUpdated(uri) => (
                        "notifications/resources/updated",
                        Some(serde_json::json!({ "uri": uri })),
                    ),
                };
                let _ = fanout_tx
                    .send(ServerNotification {
                        method: method.to_string(),
                        params,
                    })
                    .await;
            }
        });

        let connected_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let client = Self {
            name: name.to_string(),
            config: config.clone(),
            service: Mutex::new(Some(service)),
            tools: Mutex::new(Vec::new()),
            last_error: Mutex::new(None),
            capabilities: Mutex::new(caps),
            notification_rx: Mutex::new(Some(notif_rx)),
            #[cfg(debug_assertions)]
            notification_tx: notif_tx,
            #[cfg(not(debug_assertions))]
            _notification_tx: notif_tx,
            alive: AtomicBool::new(true),
            consecutive_terminal_errors: AtomicUsize::new(0),
            connected_at_ms: AtomicI64::new(connected_at_ms),
        };

        client.refresh_tools().await?;

        info!(
            "[mcp:client] Connected to '{}' — {} tools discovered",
            name,
            client.tools.lock().await.len()
        );
        Ok(client)
    }

    pub async fn refresh_tools(&self) -> Result<(), String> {
        let service_guard = self.service.lock().await;
        let service = service_guard
            .as_ref()
            .ok_or_else(|| format!("MCP '{}' has no live service", self.name))?;

        let tools = service
            .list_all_tools()
            .await
            .map_err(|err| format!("tools/list failed for '{}': {}", self.name, err))?;

        let converted: Vec<McpToolDef> = tools
            .into_iter()
            .map(|tool| {
                let name = tool.name.into_owned();
                let input_schema =
                    serialize_tool_input_schema(&self.name, &name, &*tool.input_schema)?;
                Ok(McpToolDef {
                    name,
                    description: tool
                        .description
                        .map(|description| description.into_owned())
                        .unwrap_or_default(),
                    input_schema,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        *self.tools.lock().await = converted;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::serialize_tool_input_schema;
    use serde::ser::{Error as SerError, Serializer};
    use serde::Serialize;

    struct FailingSchema;

    impl Serialize for FailingSchema {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            Err(S::Error::custom("schema boom"))
        }
    }

    #[test]
    fn serialize_tool_input_schema_propagates_errors() {
        let err = serialize_tool_input_schema("server-a", "tool-b", &FailingSchema).unwrap_err();

        assert!(err.contains("server-a::tool-b"), "got: {err}");
        assert!(err.contains("schema boom"), "got: {err}");
    }

    #[test]
    fn serialize_tool_input_schema_returns_schema_value() {
        let value = serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            }
        });

        let serialized =
            serialize_tool_input_schema("server-a", "tool-b", &value).expect("schema serializes");

        assert_eq!(serialized, value);
    }
}
