//! Agent-facing internal browser tool.
//!
//! The tool only resolves the currently visible ORGII internal browser
//! WebView. Agents do not provide arbitrary labels; all actions go through the
//! active target tracked by the frontend-owned BrowserSessionWebview lifecycle.

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::tools::categories as tool_categories;
use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params_described, Tool, ToolError, ToolPriority};

const INTERNAL_BROWSER_NOT_READY_MESSAGE: &str =
    "Internal browser automation requires a running Tauri app handle.";

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum InternalBrowserAction {
    /// List known internal browser targets and the currently active target.
    List,
    /// Check whether the active internal browser Page Agent is ready.
    IsReady,
    /// Read the active internal browser DOM state.
    GetState,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InternalBrowserParams {
    /// Read-only internal browser action to perform.
    action: InternalBrowserAction,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InternalBrowserToolTarget {
    browser_session_id: String,
    label: String,
    url: String,
    active_webview_exists: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InternalBrowserTargetSummary {
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_session_id: Option<String>,
    is_active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InternalBrowserListResponse {
    success: bool,
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<InternalBrowserToolTarget>,
    active_webview_exists: bool,
    webviews: Vec<InternalBrowserTargetSummary>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InternalBrowserReadyResponse {
    success: bool,
    action: &'static str,
    ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<InternalBrowserToolTarget>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InternalBrowserStateResponse {
    success: bool,
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<InternalBrowserToolTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<browser::InternalBrowserState>,
    message: String,
}

pub struct InternalBrowserTool {
    app_handle: Option<AppHandle>,
}

impl InternalBrowserTool {
    pub fn new(app_handle: Option<AppHandle>) -> Self {
        Self { app_handle }
    }

    fn app_handle(&self) -> Result<AppHandle, ToolError> {
        self.app_handle
            .clone()
            .ok_or_else(|| ToolError::ExecutionFailed(INTERNAL_BROWSER_NOT_READY_MESSAGE.into()))
    }

    fn response_text<T: Serialize>(response: &T) -> Result<String, ToolError> {
        serde_json::to_string_pretty(response).map_err(|err| {
            ToolError::ExecutionFailed(format!(
                "Failed to serialize internal browser response: {err}"
            ))
        })
    }

    async fn execute_list(&self) -> Result<String, ToolError> {
        let app = self.app_handle()?;
        let targets = browser::list_internal_browser_targets(app).map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to list internal browser targets: {err}"))
        })?;
        let active = active_target(&targets);
        let response = InternalBrowserListResponse {
            success: true,
            action: "list",
            active,
            active_webview_exists: targets.active_webview_exists,
            webviews: targets
                .webviews
                .into_iter()
                .map(|target| InternalBrowserTargetSummary {
                    label: target.label,
                    browser_session_id: target.browser_session_id,
                    is_active: target.is_active,
                })
                .collect(),
            message: "Listed internal browser targets.".to_string(),
        };
        Self::response_text(&response)
    }

    async fn execute_is_ready(&self) -> Result<String, ToolError> {
        let app = self.app_handle()?;
        let targets = browser::list_internal_browser_targets(app.clone()).map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to list internal browser targets: {err}"))
        })?;
        let Some(target) = resolvable_active_target(&targets) else {
            let response = InternalBrowserReadyResponse {
                success: false,
                action: "is_ready",
                ready: false,
                target: active_target(&targets),
                message: inactive_target_message(&targets),
            };
            return Self::response_text(&response);
        };

        let ready = browser::internal_browser_is_ready(app, target.label.clone())
            .await
            .map_err(|err| {
                ToolError::ExecutionFailed(format!("Failed to check Page Agent readiness: {err}"))
            })?;
        let response = InternalBrowserReadyResponse {
            success: true,
            action: "is_ready",
            ready,
            target: Some(target),
            message: if ready {
                "Page Agent is ready in the active internal browser.".to_string()
            } else {
                "Page Agent is not ready in the active internal browser.".to_string()
            },
        };
        Self::response_text(&response)
    }

    async fn execute_get_state(&self) -> Result<String, ToolError> {
        let app = self.app_handle()?;
        let targets = browser::list_internal_browser_targets(app.clone()).map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to list internal browser targets: {err}"))
        })?;
        let Some(target) = resolvable_active_target(&targets) else {
            let response = InternalBrowserStateResponse {
                success: false,
                action: "get_state",
                target: active_target(&targets),
                state: None,
                message: inactive_target_message(&targets),
            };
            return Self::response_text(&response);
        };

        let ready = browser::internal_browser_is_ready(app.clone(), target.label.clone())
            .await
            .map_err(|err| {
                ToolError::ExecutionFailed(format!("Failed to check Page Agent readiness: {err}"))
            })?;
        if !ready {
            let response = InternalBrowserStateResponse {
                success: false,
                action: "get_state",
                target: Some(target),
                state: None,
                message: "Page Agent is not ready in the active internal browser.".to_string(),
            };
            return Self::response_text(&response);
        }

        let state = browser::internal_browser_get_state(app, target.label.clone())
            .await
            .map_err(|err| {
                ToolError::ExecutionFailed(format!("Failed to read internal browser state: {err}"))
            })?;
        let response = InternalBrowserStateResponse {
            success: true,
            action: "get_state",
            target: Some(target),
            state: Some(state),
            message: "Read active internal browser state.".to_string(),
        };
        Self::response_text(&response)
    }
}

fn active_target(
    targets: &browser::InternalBrowserTargetList,
) -> Option<InternalBrowserToolTarget> {
    targets
        .active
        .as_ref()
        .map(|active| InternalBrowserToolTarget {
            browser_session_id: active.browser_session_id.clone(),
            label: active.label.clone(),
            url: active.url.clone(),
            active_webview_exists: targets.active_webview_exists,
        })
}

fn resolvable_active_target(
    targets: &browser::InternalBrowserTargetList,
) -> Option<InternalBrowserToolTarget> {
    if !targets.active_webview_exists {
        return None;
    }
    active_target(targets)
}

fn inactive_target_message(targets: &browser::InternalBrowserTargetList) -> String {
    if targets.active.is_none() {
        "No active internal browser WebView is available. Open an internal Browser tab first."
            .to_string()
    } else if !targets.active_webview_exists {
        "The tracked active internal browser WebView no longer exists. Activate a Browser tab again."
            .to_string()
    } else {
        "No resolvable active internal browser WebView is available.".to_string()
    }
}

#[async_trait]
impl Tool for InternalBrowserTool {
    fn name(&self) -> &str {
        tool_names::CONTROL_INTERNAL_BROWSER
    }

    fn category(&self) -> &str {
        tool_categories::WEB
    }

    fn description(&self) -> &str {
        "Inspect the currently visible ORGII internal Browser WebView. This read-only step supports list, is_ready, and get_state; DOM actions are added separately."
    }

    fn is_ready(&self) -> bool {
        self.app_handle.is_some()
    }

    fn not_ready_reason(&self) -> Option<&str> {
        if self.app_handle.is_some() {
            None
        } else {
            Some(INTERNAL_BROWSER_NOT_READY_MESSAGE)
        }
    }

    fn search_hint(&self) -> &str {
        "internal browser webview tauri webview2 dom page agent get_state is_ready"
    }

    fn parameters(&self) -> Value {
        params_schema::<InternalBrowserParams>()
    }

    async fn execute_text(
        &self,
        params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        let params: InternalBrowserParams = parse_params_described(params)?;
        match params.action {
            InternalBrowserAction::List => self.execute_list().await,
            InternalBrowserAction::IsReady => self.execute_is_ready().await,
            InternalBrowserAction::GetState => self.execute_get_state().await,
        }
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn priority(&self) -> ToolPriority {
        ToolPriority::Always
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_state(session_id: &str) -> browser::ActiveInternalBrowserState {
        browser::ActiveInternalBrowserState {
            browser_session_id: session_id.to_string(),
            label: format!("browser-session-{session_id}"),
            url: "https://example.com".to_string(),
            visible: true,
            updated_at: 10,
        }
    }

    fn target_list(
        active: Option<browser::ActiveInternalBrowserState>,
        active_webview_exists: bool,
    ) -> browser::InternalBrowserTargetList {
        browser::InternalBrowserTargetList {
            active,
            active_webview_exists,
            webviews: Vec::new(),
        }
    }

    #[test]
    fn resolves_active_target_only_when_webview_exists() {
        let targets = target_list(Some(active_state("abc")), true);
        let target = resolvable_active_target(&targets).expect("target should resolve");

        assert_eq!(target.browser_session_id, "abc");
        assert_eq!(target.label, "browser-session-abc");
        assert!(target.active_webview_exists);
    }

    #[test]
    fn refuses_stale_active_target_without_webview() {
        let targets = target_list(Some(active_state("abc")), false);

        assert!(resolvable_active_target(&targets).is_none());
        assert!(inactive_target_message(&targets).contains("no longer exists"));
    }

    #[test]
    fn reports_missing_active_target() {
        let targets = target_list(None, false);

        assert!(resolvable_active_target(&targets).is_none());
        assert!(inactive_target_message(&targets).contains("No active"));
    }
}
