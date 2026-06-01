//! Codex OAuth integration.
//!
//! Drives the same PKCE authorization-code flow as Codex CLI inside ORGII's
//! KeyVault wizard so the resulting ChatGPT OAuth tokens can be stored as a
//! `codex` OAuth account.

pub mod oauth;
