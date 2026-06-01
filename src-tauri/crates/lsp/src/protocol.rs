//! JSON-RPC framing helpers
//!
//! Inbound parsing (`Content-Length: N\r\n\r\n<body>` → body bytes)
//! lives in `crate::codec::LspCodec`, which drives a
//! `tokio_util::codec::FramedRead` in `server::start_listening`.
//! This module only owns the *outbound* format helper plus the
//! re-exports of the JSON-RPC envelope types from `core_types`.

pub use core_types::jsonrpc::{JsonRpcError, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};

/// Wrap a JSON-RPC envelope in the LSP `Content-Length` framing.
///
/// The header length must count *bytes* of the UTF-8 body, not
/// characters — `str::len()` is exactly that, so we use it directly.
pub fn format_lsp_message(json_content: &str) -> String {
    format!(
        "Content-Length: {}\r\n\r\n{}",
        json_content.len(),
        json_content
    )
}

#[cfg(test)]
#[path = "tests/protocol_tests.rs"]
mod tests;
