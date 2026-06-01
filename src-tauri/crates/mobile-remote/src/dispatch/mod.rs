//! Inbound RPC dispatch.
//!
//! Validates each incoming [`RpcCall`] against the device's
//! [`PermissionTier`], decodes its `args` payload, and forwards the
//! call to a [`DispatchHost`] implementation. The trait abstracts over
//! the live Tauri `AppHandle` so the dispatch logic stays unit-testable
//! and so this crate stays a pure leaf — the production
//! `DispatchHost` impl (`TauriDispatchHost`) lives in `app` next to
//! the `agent_core` / `unified_stats` symbols it consumes; this crate
//! only owns the trait + the `dispatch_rpc` orchestrator + the
//! `NoopDispatchHost` test double.
//!
//! ## Command name source
//!
//! The string keys we match on (`sessions_list`, `session_get`,
//! `tool_call_approve`, …) are the canonical names defined by
//! [`orgii_protocol::tier`]'s allowlist — kept in lockstep with the
//! relay so a tier check passing here means the same string passes on
//! the relay too. We expose them as `pub const`s so callers don't
//! retype them.

use std::time::Instant;

use async_trait::async_trait;
use orgii_protocol::{PermissionTier, RpcCall, RpcResult};
use serde::Deserialize;

use crate::allowlist::check_or_reject;
use crate::audit::AuditLogger;
use crate::error::MobileRemoteError;

/// Canonical command names. Mirror [`orgii_protocol::tier`]'s allowlist.
pub const CMD_SESSIONS_LIST: &str = "sessions_list";
pub const CMD_SESSION_GET: &str = "session_get";
pub const CMD_TOOL_CALL_APPROVE: &str = "tool_call_approve";
pub const CMD_TOOL_CALL_DENY: &str = "tool_call_deny";
pub const CMD_AGENT_SEND_MESSAGE: &str = "agent_send_message";

/// Indirection so `dispatch_rpc` is testable without a real Tauri
/// `AppHandle`. Phase 5+ will add more methods as more commands become
/// routable.
#[async_trait]
pub trait DispatchHost: Send + Sync {
    async fn list_sessions(&self) -> Result<serde_json::Value, MobileRemoteError>;
    async fn get_session(&self, id: &str) -> Result<serde_json::Value, MobileRemoteError>;
    async fn approve_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
    ) -> Result<(), MobileRemoteError>;
    async fn deny_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
        reason: Option<String>,
    ) -> Result<(), MobileRemoteError>;
    async fn send_message(&self, session_id: &str, content: &str) -> Result<(), MobileRemoteError>;
}

/// Args-shape DTOs. Kept private so callers can only reach them via
/// `dispatch_rpc`. Each struct mirrors the wire schema documented in
/// `Documentation/MainApp/collaboration/mobile-remote-control--0504.md`.
#[derive(Debug, Deserialize)]
struct GetSessionArgs {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ToolCallApproveArgs {
    session_id: String,
    call_id: String,
}

#[derive(Debug, Deserialize)]
struct ToolCallDenyArgs {
    session_id: String,
    call_id: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentSendMessageArgs {
    session_id: String,
    content: String,
}

/// Validate `call` against `tier`, route to a method on `host`, and
/// translate the host result into an [`RpcResult`].
///
/// Logs the outcome to the supplied [`AuditLogger`] using the call's
/// `source_device_id` — the actor that originated the request — so
/// the audit trail records "who did this" rather than "where it
/// landed". The relay stamps `source_device_id` from the mobile
/// peer's authenticated WS handshake (see `RpcCall` in
/// `orgii-protocol`), so this is the authoritative identifier.
///
/// The bridge constructs the logger once on startup with the relay
/// URL + authenticated `UserId` and hands clones to every dispatch
/// site; the logger's HTTP fan-out is itself fire-and-forget so
/// `await`ing `log` is essentially a no-op on the hot path.
pub async fn dispatch_rpc<H: DispatchHost + ?Sized>(
    host: &H,
    call: RpcCall,
    tier: PermissionTier,
    audit: &AuditLogger,
) -> RpcResult {
    let started = Instant::now();
    let device_label = call.source_device_id.as_str().to_owned();
    let command = call.command.clone();

    let result = dispatch_inner(host, call, tier).await;

    let ok = matches!(result, RpcResult::Ok { .. });
    let latency_ms = started.elapsed().as_millis() as u64;
    audit.log(&device_label, &command, ok, latency_ms).await;

    result
}

async fn dispatch_inner<H: DispatchHost + ?Sized>(
    host: &H,
    call: RpcCall,
    tier: PermissionTier,
) -> RpcResult {
    let id = call.id.clone();

    if let Err(err) = check_or_reject(tier, &call.command) {
        return RpcResult::Err {
            id,
            error: err.to_string(),
        };
    }

    match call.command.as_str() {
        CMD_SESSIONS_LIST => match host.list_sessions().await {
            Ok(data) => RpcResult::Ok { id, data },
            Err(err) => RpcResult::Err {
                id,
                error: err.to_string(),
            },
        },
        CMD_SESSION_GET => {
            let args: GetSessionArgs = match parse_args(call.args, &call.command) {
                Ok(args) => args,
                Err(err) => {
                    return RpcResult::Err {
                        id,
                        error: err.to_string(),
                    };
                }
            };
            match host.get_session(&args.id).await {
                Ok(data) => RpcResult::Ok { id, data },
                Err(err) => RpcResult::Err {
                    id,
                    error: err.to_string(),
                },
            }
        }
        CMD_TOOL_CALL_APPROVE => {
            let args: ToolCallApproveArgs = match parse_args(call.args, &call.command) {
                Ok(args) => args,
                Err(err) => {
                    return RpcResult::Err {
                        id,
                        error: err.to_string(),
                    };
                }
            };
            match host
                .approve_tool_call(&args.session_id, &args.call_id)
                .await
            {
                Ok(()) => RpcResult::Ok {
                    id,
                    data: serde_json::Value::Null,
                },
                Err(err) => RpcResult::Err {
                    id,
                    error: err.to_string(),
                },
            }
        }
        CMD_TOOL_CALL_DENY => {
            let args: ToolCallDenyArgs = match parse_args(call.args, &call.command) {
                Ok(args) => args,
                Err(err) => {
                    return RpcResult::Err {
                        id,
                        error: err.to_string(),
                    };
                }
            };
            match host
                .deny_tool_call(&args.session_id, &args.call_id, args.reason)
                .await
            {
                Ok(()) => RpcResult::Ok {
                    id,
                    data: serde_json::Value::Null,
                },
                Err(err) => RpcResult::Err {
                    id,
                    error: err.to_string(),
                },
            }
        }
        CMD_AGENT_SEND_MESSAGE => {
            let args: AgentSendMessageArgs = match parse_args(call.args, &call.command) {
                Ok(args) => args,
                Err(err) => {
                    return RpcResult::Err {
                        id,
                        error: err.to_string(),
                    };
                }
            };
            match host.send_message(&args.session_id, &args.content).await {
                Ok(()) => RpcResult::Ok {
                    id,
                    data: serde_json::Value::Null,
                },
                Err(err) => RpcResult::Err {
                    id,
                    error: err.to_string(),
                },
            }
        }
        other => RpcResult::Err {
            id,
            error: format!("unknown command: {other}"),
        },
    }
}

fn parse_args<T: for<'de> Deserialize<'de>>(
    args: serde_json::Value,
    command: &str,
) -> Result<T, MobileRemoteError> {
    serde_json::from_value(args).map_err(|err| {
        MobileRemoteError::DispatchHandler(format!("malformed args for {command}: {err}"))
    })
}

/// Compile-time-wiring stand-in. Every method returns
/// [`MobileRemoteError::DispatchHandler`] so test code (and any
/// pre-`AppHandle` startup path) has a `DispatchHost` it can hand to
/// `dispatch_rpc` without a real Tauri runtime.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopDispatchHost;

impl NoopDispatchHost {
    fn not_wired<T>(method: &str) -> Result<T, MobileRemoteError> {
        Err(MobileRemoteError::DispatchHandler(format!(
            "{method}: not yet wired"
        )))
    }
}

#[async_trait]
impl DispatchHost for NoopDispatchHost {
    async fn list_sessions(&self) -> Result<serde_json::Value, MobileRemoteError> {
        Self::not_wired("list_sessions")
    }
    async fn get_session(&self, _id: &str) -> Result<serde_json::Value, MobileRemoteError> {
        Self::not_wired("get_session")
    }
    async fn approve_tool_call(
        &self,
        _session_id: &str,
        _call_id: &str,
    ) -> Result<(), MobileRemoteError> {
        Self::not_wired("approve_tool_call")
    }
    async fn deny_tool_call(
        &self,
        _session_id: &str,
        _call_id: &str,
        _reason: Option<String>,
    ) -> Result<(), MobileRemoteError> {
        Self::not_wired("deny_tool_call")
    }
    async fn send_message(
        &self,
        _session_id: &str,
        _content: &str,
    ) -> Result<(), MobileRemoteError> {
        Self::not_wired("send_message")
    }
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
