//! Environment variable names injected into CLI agent subprocesses for
//! MITM proxy routing and TLS trust.
//!
//! Lives in `core_types` (not in `agent_sessions::cli` or `integrations::proxy`)
//! because both sides set/consume these strings — the proxy server registers
//! them, and the session runner injects them into the spawned child process.
//! Putting them here keeps the two crates from depending on each other for
//! four string constants.

/// Standard HTTPS proxy (most HTTP clients check this).
pub const HTTPS_PROXY: &str = "HTTPS_PROXY";

/// Lowercase variant — curl, Python requests, and some Node clients check this.
pub const HTTPS_PROXY_LOWER: &str = "https_proxy";

/// Path to the CA certificate file for TLS verification.
pub const SSL_CERT_FILE: &str = "SSL_CERT_FILE";

/// Node.js-specific CA cert path (used by npm, Node fetch, etc.).
pub const NODE_EXTRA_CA_CERTS: &str = "NODE_EXTRA_CA_CERTS";
