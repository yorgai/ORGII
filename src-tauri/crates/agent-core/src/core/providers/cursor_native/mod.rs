//! Cursor native provider — ORGII native harness for Cursor subscription accounts.
//!
//! This module is a standard `LLMProvider` implementation selected by the
//! provider factory when a Rust Agent session asks for `cursor_native` via
//! `native_harness_type`. CLI Agent sessions continue to use the CLI runner.

pub mod auth;
pub mod client;
pub mod connect;
pub mod proto;
pub mod provider;
pub mod request;
pub mod tools;

pub use provider::{
    CursorNativeProvider, CursorNativeWorkspaceContext, DEFAULT_MODEL, PROVIDER_NAME,
};
