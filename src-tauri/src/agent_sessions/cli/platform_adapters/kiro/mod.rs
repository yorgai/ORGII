//! Kiro Integration
//!
//! - `kiro_auth`: PTY-based login flow (drives the official `kiro-cli login`
//!   binary), embedded webview helpers, local token reader.
//! - `proxy_auth`: builds a fake-AWS-token Kiro SQLite for market-key /
//!   MITM proxy sessions. No AWS SDK dependency.
//!
//! The own-key direct-AWS-SDK SSO login lived in `sso.rs` and has been
//! archived to `.archive/kiro-sso/` to drop the `aws-config` /
//! `aws-sdk-ssooidc` dependency tree (~167 transitive crates including
//! `aws-lc-sys`). Frontend now uses the PTY login path
//! (`start_kiro_login` / `cancel_kiro_login`) for own-key Kiro Pro auth.

pub mod kiro_auth;
pub mod proxy_auth;
