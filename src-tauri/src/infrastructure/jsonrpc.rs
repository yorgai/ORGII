//! Shared JSON-RPC 2.0 protocol types
//!
//! Canonical definitions live in `core_types::jsonrpc`. This module is a
//! thin re-export so existing call sites under `crate::infrastructure::jsonrpc`
//! keep compiling while leaf crates depend on `core_types` directly.

pub use core_types::jsonrpc::{JsonRpcError, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
