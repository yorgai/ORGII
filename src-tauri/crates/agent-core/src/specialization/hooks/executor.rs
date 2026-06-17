//! Hook executor — runs hook entries (command, prompt, http) with event context.

use std::path::PathBuf;
use std::time::Duration;

use tracing::{info, warn};

use super::config::{HookEntry, HooksConfig, HttpMethod};
use super::events::{HookContext, HookEvent};

/// Result of executing a single hook.
#[derive(Debug, Clone)]
pub struct HookResult {
    pub event: HookEvent,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

/// Executes hooks for lifecycle events.
///
/// Holds the parsed config and the workspace root (for command working dir).
/// Thread-safe and cheaply cloneable — share across the session.
#[derive(Debug, Clone)]
pub struct HookExecutor {
    config: HooksConfig,
    workspace_root: PathBuf,
}

impl HookExecutor {
    /// Create an executor from a workspace root. Loads `.orgii/hooks.json` eagerly.
    pub fn load(workspace_root: &std::path::Path) -> Self {
        Self::load_with_workspace_scope(workspace_root, true)
    }

    pub fn load_with_workspace_scope(
        workspace_root: &std::path::Path,
        load_workspace_resources: bool,
    ) -> Self {
        let config =
            HooksConfig::load_with_workspace_scope(workspace_root, load_workspace_resources);
        if !config.is_empty() {
            info!(
                "[hooks] Loaded {} hook(s) from {}",
                config.total_hooks(),
                workspace_root.join(".orgii/hooks.json").display()
            );
        }
        Self {
            config,
            workspace_root: workspace_root.to_path_buf(),
        }
    }

    /// Create an executor with an explicit config (for testing).
    pub fn with_config(config: HooksConfig, workspace_root: PathBuf) -> Self {
        Self {
            config,
            workspace_root,
        }
    }

    pub fn has_hooks_for(&self, event: HookEvent) -> bool {
        !self.config.hooks_for(event).is_empty()
    }

    pub fn is_empty(&self) -> bool {
        self.config.is_empty()
    }

    /// Execute all hooks for an event. Returns results in order.
    /// Hooks run sequentially — a failing hook does NOT prevent subsequent hooks.
    pub async fn run(&self, event: HookEvent, context: &HookContext) -> Vec<HookResult> {
        let hooks = self.config.hooks_for(event);
        if hooks.is_empty() {
            return Vec::new();
        }

        let mut results = Vec::with_capacity(hooks.len());
        for entry in hooks {
            let result = self.execute_entry(event, entry, context).await;
            results.push(result);
        }
        results
    }

    /// Collect prompt hook outputs for an event.
    /// Returns the concatenated prompt text from all `Prompt` hooks.
    pub fn collect_prompt_hooks(&self, event: HookEvent) -> Option<String> {
        let hooks = self.config.hooks_for(event);
        let mut prompt_parts: Vec<&str> = Vec::new();
        for entry in hooks {
            if let HookEntry::Prompt { content } = entry {
                if !content.is_empty() {
                    prompt_parts.push(content);
                }
            }
        }
        if prompt_parts.is_empty() {
            None
        } else {
            Some(prompt_parts.join("\n\n"))
        }
    }

    async fn execute_entry(
        &self,
        event: HookEvent,
        entry: &HookEntry,
        context: &HookContext,
    ) -> HookResult {
        match entry {
            HookEntry::Command { command, .. } => {
                self.execute_command(event, command, entry.effective_timeout_ms(), context)
                    .await
            }
            HookEntry::Prompt { .. } => HookResult {
                event,
                success: true,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 0,
            },
            HookEntry::Http {
                url,
                method,
                headers,
                ..
            } => {
                self.execute_http(
                    event,
                    url,
                    method,
                    headers,
                    entry.effective_timeout_ms(),
                    context,
                )
                .await
            }
        }
    }

    async fn execute_http(
        &self,
        event: HookEvent,
        url: &str,
        method: &HttpMethod,
        headers: &std::collections::HashMap<String, String>,
        timeout_ms: u64,
        context: &HookContext,
    ) -> HookResult {
        let start = std::time::Instant::now();

        info!(
            "[hooks] Sending {} webhook for {}: {}",
            match method {
                HttpMethod::POST => "POST",
                HttpMethod::PUT => "PUT",
                HttpMethod::PATCH => "PATCH",
            },
            event,
            &url[..url.len().min(100)]
        );

        let body = serde_json::json!({
            "event": event.as_str(),
            "context": context.env_vars,
        });

        let client = reqwest::Client::new();
        let mut request = match method {
            HttpMethod::POST => client.post(url),
            HttpMethod::PUT => client.put(url),
            HttpMethod::PATCH => client.patch(url),
        };
        request = request
            .timeout(Duration::from_millis(timeout_ms))
            .header("Content-Type", "application/json")
            .json(&body);

        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }

        match request.send().await {
            Ok(resp) => {
                let status = resp.status();
                let success = status.is_success();
                let body_text = match resp.text().await {
                    Ok(t) => crate::utils::safe_truncate_chars_to_string(&t, 10_000),
                    Err(err) => {
                        // A body-read failure here means the connection
                        // dropped mid-read or the body was non-UTF-8.
                        // Fall back to an empty body so the hook
                        // bookkeeping still completes (the HTTP status
                        // is preserved separately above), but warn so
                        // the failure mode is visible — otherwise a
                        // user looking at hook history would see
                        // success=false with an empty body and no
                        // explanation.
                        warn!(
                            "[hooks] {} HTTP body read failed (status={}): {}",
                            event, status, err
                        );
                        String::new()
                    }
                };

                if !success {
                    warn!(
                        "[hooks] {} HTTP hook returned {}: {}",
                        event,
                        status,
                        &body_text[..body_text.len().min(200)]
                    );
                }

                HookResult {
                    event,
                    success,
                    stdout: body_text,
                    stderr: String::new(),
                    duration_ms: start.elapsed().as_millis() as u64,
                }
            }
            Err(err) => {
                let is_timeout = err.is_timeout();
                warn!(
                    "[hooks] {} HTTP hook error{}: {}",
                    event,
                    if is_timeout { " (timeout)" } else { "" },
                    err
                );
                HookResult {
                    event,
                    success: false,
                    stdout: String::new(),
                    stderr: if is_timeout {
                        format!("Hook timed out after {}ms", timeout_ms)
                    } else {
                        format!("HTTP error: {}", err)
                    },
                    duration_ms: start.elapsed().as_millis() as u64,
                }
            }
        }
    }

    async fn execute_command(
        &self,
        event: HookEvent,
        command: &str,
        timeout_ms: u64,
        context: &HookContext,
    ) -> HookResult {
        let start = std::time::Instant::now();

        info!(
            "[hooks] Running {} hook: {}",
            event,
            &command[..command.len().min(100)]
        );

        let shell = if cfg!(target_os = "windows") {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };

        let mut cmd = tokio::process::Command::new(shell.0);
        cmd.arg(shell.1)
            .arg(command)
            .current_dir(&self.workspace_root)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        for (key, value) in &context.env_vars {
            cmd.env(key, value);
        }
        cmd.env("ORGII_HOOK_EVENT", event.as_str());

        // Windows: suppress the console window the hook shell would otherwise flash.
        #[cfg(windows)]
        cmd.creation_flags(app_platform::CREATE_NO_WINDOW);

        let result =
            match tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await {
                Ok(Ok(output)) => {
                    let success = output.status.success();
                    let stdout = String::from_utf8_lossy(&output.stdout)
                        .chars()
                        .take(10_000)
                        .collect::<String>();
                    let stderr = String::from_utf8_lossy(&output.stderr)
                        .chars()
                        .take(10_000)
                        .collect::<String>();

                    if !success {
                        warn!(
                            "[hooks] {} hook failed (exit={}): {}",
                            event,
                            output.status.code().unwrap_or(-1),
                            &stderr[..stderr.len().min(200)]
                        );
                    }

                    HookResult {
                        event,
                        success,
                        stdout,
                        stderr,
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Ok(Err(err)) => {
                    warn!("[hooks] {} hook spawn error: {}", event, err);
                    HookResult {
                        event,
                        success: false,
                        stdout: String::new(),
                        stderr: format!("Failed to spawn: {}", err),
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Err(_) => {
                    warn!(
                        "[hooks] {} hook timed out after {}ms: {}",
                        event,
                        timeout_ms,
                        &command[..command.len().min(80)]
                    );
                    HookResult {
                        event,
                        success: false,
                        stdout: String::new(),
                        stderr: format!("Hook timed out after {}ms", timeout_ms),
                        duration_ms: timeout_ms,
                    }
                }
            };

        result
    }
}
