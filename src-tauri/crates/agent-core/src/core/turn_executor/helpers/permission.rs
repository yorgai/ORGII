//! Permission check wrapper around [`PermissionProvider`].
//!
//! `check_permission` is invoked between tool steps in the turn executor.
//! It races the permission wait against a cancel flag so user cancellation
//! is respected even while waiting for a permission response.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tracing::info;

use crate::core::turn_executor::types::{PermissionProvider, PermissionVerdict};
use crate::tools::policy::ResolvedToolPolicy;

/// Check tool permission via the provider. Returns `Some(error_msg)` if
/// denied/cancelled, `None` if allowed (or no permission check needed).
///
/// When `cancel_flag` is set, the permission wait is interrupted so the
/// agent loop can break out promptly instead of blocking until the user
/// responds.
pub(crate) async fn check_permission(
    policy: &ResolvedToolPolicy,
    provider: Option<&dyn PermissionProvider>,
    session_id: &str,
    tool_name: &str,
    tool_call_id: &str,
    args: &Value,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Option<String> {
    if !policy.requires_ask(tool_name) {
        return None;
    }
    let perm = provider?;
    if perm.is_always_allowed(tool_name).await {
        return None;
    }

    let permission_fut = perm.request_permission(session_id, tool_name, tool_call_id, args);

    if let Some(flag) = cancel_flag {
        let cancel_poll = async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                if flag.load(Ordering::Relaxed) {
                    return;
                }
            }
        };
        tokio::select! {
            result = permission_fut => {
                match result {
                    Ok(PermissionVerdict::Allow) => None,
                    Ok(PermissionVerdict::AlwaysAllow) => {
                        info!("[agent-core] Always-allow granted for {}", tool_name);
                        None
                    }
                    Ok(PermissionVerdict::Deny) => {
                        Some(format!("Error: Tool '{}' was denied by the user", tool_name))
                    }
                    Err(()) => Some("Error: Permission request cancelled".to_string()),
                }
            }
            _ = cancel_poll => {
                Some("Error: Task was cancelled while waiting for permission".to_string())
            }
        }
    } else {
        match permission_fut.await {
            Ok(PermissionVerdict::Allow) => None,
            Ok(PermissionVerdict::AlwaysAllow) => {
                info!("[agent-core] Always-allow granted for {}", tool_name);
                None
            }
            Ok(PermissionVerdict::Deny) => Some(format!(
                "Error: Tool '{}' was denied by the user",
                tool_name
            )),
            Err(()) => Some("Error: Permission request cancelled".to_string()),
        }
    }
}
