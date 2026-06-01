//! Runtime configuration for the relay server.
//!
//! Phase 1b only exposes the struct + sensible defaults. Environment /
//! file loading is intentionally deferred to Phase 2 so the wiring stays
//! reviewable in isolation.

use std::net::SocketAddr;
use std::path::PathBuf;

/// Default loopback bind. Phase 2 may switch to `0.0.0.0` once auth /
/// pairing are in place; until then we refuse to expose unauthenticated
/// endpoints to the LAN.
const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:7878";

/// Default storage filename. Stored relative to the working directory so
/// `cargo run` "just works"; production deployments override via CLI.
const DEFAULT_STORAGE_FILENAME: &str = "orgii-relay.db";

/// Default `RUST_LOG`-style filter for tracing-subscriber.
const DEFAULT_LOG_LEVEL: &str = "info";

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub listen_addr: SocketAddr,
    pub storage_path: PathBuf,
    pub log_level: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            listen_addr: DEFAULT_LISTEN_ADDR
                .parse()
                .expect("DEFAULT_LISTEN_ADDR is a valid SocketAddr literal"),
            storage_path: PathBuf::from(DEFAULT_STORAGE_FILENAME),
            log_level: DEFAULT_LOG_LEVEL.to_owned(),
        }
    }
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
