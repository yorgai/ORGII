//! Claude Code OAuth integration.
//!
//! Drives the same PKCE authorization-code flow as Claude Code, but inside
//! ORGII's KeyVault wizard so the resulting access token can be stored as a
//! `claude_code` OAuth account.

pub mod oauth;
