use std::sync::Mutex;

use async_trait::async_trait;
use orgii_protocol::{DesktopId, DeviceId, RpcCall, RpcId, RpcResult, UserId};
use reqwest::Client;
use serde_json::json;

use super::*;
use crate::audit::AuditLogger;
use crate::test_utils::install_crypto_provider_for_tests;

/// Build an [`AuditLogger`] that posts to a black-hole URL. The
/// dispatch surface awaits `audit.log` synchronously, but `log`
/// itself only spawns a tokio task to do the actual POST — that
/// task's failure to reach `127.0.0.1:1` is logged and dropped, so
/// the dispatch test outcome is unaffected.
fn test_logger() -> AuditLogger {
    install_crypto_provider_for_tests();
    AuditLogger::new(
        "http://127.0.0.1:1".to_owned(),
        UserId::new("local-user"),
        Client::new(),
    )
}

/// Records every method invocation against a [`DispatchHost`] so tests
/// can assert that routing actually fired the right branch with the
/// right args.
#[derive(Debug, Default)]
struct MockHost {
    calls: Mutex<Vec<MockCall>>,
}

#[derive(Debug, Clone, PartialEq)]
enum MockCall {
    ListSessions,
    GetSession {
        id: String,
    },
    Approve {
        session_id: String,
        call_id: String,
    },
    Deny {
        session_id: String,
        call_id: String,
        reason: Option<String>,
    },
    SendMessage {
        session_id: String,
        content: String,
    },
}

impl MockHost {
    fn record(&self, call: MockCall) {
        self.calls.lock().expect("mock host poisoned").push(call);
    }

    fn snapshot(&self) -> Vec<MockCall> {
        self.calls.lock().expect("mock host poisoned").clone()
    }
}

#[async_trait]
impl DispatchHost for MockHost {
    async fn list_sessions(&self) -> Result<serde_json::Value, MobileRemoteError> {
        self.record(MockCall::ListSessions);
        Ok(json!([{ "id": "sess-1" }]))
    }
    async fn get_session(&self, id: &str) -> Result<serde_json::Value, MobileRemoteError> {
        self.record(MockCall::GetSession { id: id.to_owned() });
        Ok(json!({ "id": id }))
    }
    async fn approve_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
    ) -> Result<(), MobileRemoteError> {
        self.record(MockCall::Approve {
            session_id: session_id.to_owned(),
            call_id: call_id.to_owned(),
        });
        Ok(())
    }
    async fn deny_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
        reason: Option<String>,
    ) -> Result<(), MobileRemoteError> {
        self.record(MockCall::Deny {
            session_id: session_id.to_owned(),
            call_id: call_id.to_owned(),
            reason,
        });
        Ok(())
    }
    async fn send_message(&self, session_id: &str, content: &str) -> Result<(), MobileRemoteError> {
        self.record(MockCall::SendMessage {
            session_id: session_id.to_owned(),
            content: content.to_owned(),
        });
        Ok(())
    }
}

fn rpc(command: &str, args: serde_json::Value) -> RpcCall {
    RpcCall {
        id: RpcId::new("req-1"),
        target_desktop_id: DesktopId::new("desk-home"),
        source_device_id: DeviceId::new("dev-test-mobile"),
        command: command.to_owned(),
        args,
    }
}

#[tokio::test]
async fn unknown_command_returns_err() {
    let host = MockHost::default();
    // `Full` so the allowlist gate doesn't short-circuit before we
    // hit the unknown-command branch — the allowlist itself rejects
    // names it doesn't recognize.
    let result = dispatch_rpc(
        &host,
        rpc("totally_made_up", json!({})),
        PermissionTier::Full,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Err { id, error } => {
            assert_eq!(id.as_str(), "req-1");
            assert!(
                error.contains("not allowed") || error.contains("unknown command"),
                "want allowlist or unknown-command rejection, got {error:?}"
            );
        }
        other => panic!("expected Err, got {other:?}"),
    }
    assert!(host.snapshot().is_empty(), "host must not be invoked");
}

#[tokio::test]
async fn read_only_command_with_full_tier_succeeds() {
    let host = MockHost::default();
    let result = dispatch_rpc(
        &host,
        rpc(CMD_SESSIONS_LIST, json!({})),
        PermissionTier::Full,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Ok { id, data } => {
            assert_eq!(id.as_str(), "req-1");
            assert!(data.is_array());
        }
        other => panic!("expected Ok, got {other:?}"),
    }
    assert_eq!(host.snapshot(), vec![MockCall::ListSessions]);
}

#[tokio::test]
async fn write_command_with_read_only_tier_rejected() {
    let host = MockHost::default();
    let result = dispatch_rpc(
        &host,
        rpc(
            CMD_AGENT_SEND_MESSAGE,
            json!({ "session_id": "s1", "content": "hi" }),
        ),
        PermissionTier::ReadOnly,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Err { id, error } => {
            assert_eq!(id.as_str(), "req-1");
            assert!(
                error.contains("not allowed"),
                "want tier rejection, got {error:?}"
            );
        }
        other => panic!("expected Err, got {other:?}"),
    }
    assert!(host.snapshot().is_empty(), "host must not be invoked");
}

#[tokio::test]
async fn write_command_with_full_tier_dispatches() {
    let host = MockHost::default();
    let result = dispatch_rpc(
        &host,
        rpc(
            CMD_TOOL_CALL_APPROVE,
            json!({ "session_id": "s1", "call_id": "c1" }),
        ),
        PermissionTier::Full,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Ok { id, .. } => assert_eq!(id.as_str(), "req-1"),
        other => panic!("expected Ok, got {other:?}"),
    }
    assert_eq!(
        host.snapshot(),
        vec![MockCall::Approve {
            session_id: "s1".to_owned(),
            call_id: "c1".to_owned(),
        }]
    );
}

#[tokio::test]
async fn malformed_args_returns_err() {
    let host = MockHost::default();
    let result = dispatch_rpc(
        &host,
        // `session_get` requires `id: String`; passing `id: 42` is
        // structurally wrong.
        rpc(CMD_SESSION_GET, json!({ "id": 42 })),
        PermissionTier::ReadOnly,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Err { id, error } => {
            assert_eq!(id.as_str(), "req-1");
            assert!(
                error.contains("malformed args"),
                "want decode error, got {error:?}"
            );
        }
        other => panic!("expected Err, got {other:?}"),
    }
    assert!(host.snapshot().is_empty(), "host must not be invoked");
}

#[tokio::test]
async fn host_error_propagates_as_rpc_err() {
    /// One-shot host that always errors so we exercise the
    /// `Err -> RpcResult::Err` branch without dragging the full mock.
    struct FailingHost;
    #[async_trait]
    impl DispatchHost for FailingHost {
        async fn list_sessions(&self) -> Result<serde_json::Value, MobileRemoteError> {
            Err(MobileRemoteError::DispatchHandler("boom".into()))
        }
        async fn get_session(&self, _id: &str) -> Result<serde_json::Value, MobileRemoteError> {
            unreachable!()
        }
        async fn approve_tool_call(
            &self,
            _session_id: &str,
            _call_id: &str,
        ) -> Result<(), MobileRemoteError> {
            unreachable!()
        }
        async fn deny_tool_call(
            &self,
            _session_id: &str,
            _call_id: &str,
            _reason: Option<String>,
        ) -> Result<(), MobileRemoteError> {
            unreachable!()
        }
        async fn send_message(
            &self,
            _session_id: &str,
            _content: &str,
        ) -> Result<(), MobileRemoteError> {
            unreachable!()
        }
    }

    let result = dispatch_rpc(
        &FailingHost,
        rpc(CMD_SESSIONS_LIST, json!({})),
        PermissionTier::ReadOnly,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Err { id, error } => {
            assert_eq!(id.as_str(), "req-1");
            assert!(
                error.contains("boom"),
                "want host error text, got {error:?}"
            );
        }
        other => panic!("expected Err, got {other:?}"),
    }
}

#[tokio::test]
async fn noop_host_returns_dispatch_handler_error() {
    let result = dispatch_rpc(
        &NoopDispatchHost,
        rpc(CMD_SESSIONS_LIST, json!({})),
        PermissionTier::ReadOnly,
        &test_logger(),
    )
    .await;
    match result {
        RpcResult::Err { error, .. } => {
            assert!(
                error.contains("not yet wired"),
                "want noop error text, got {error:?}"
            );
        }
        other => panic!("expected Err, got {other:?}"),
    }
}
