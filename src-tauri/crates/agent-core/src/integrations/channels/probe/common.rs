//! Shared types and helpers for channel probes.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::utils::build_http_client;

/// Probe result returned to the frontend.
#[derive(Debug, Serialize, Deserialize)]
pub struct ProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Human-readable description of the verified identity (e.g. bot name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    /// Elapsed time in milliseconds.
    pub elapsed_ms: u64,
}

impl ProbeResult {
    pub(super) fn success(identity: impl Into<String>, elapsed: u64) -> Self {
        Self {
            ok: true,
            error: None,
            identity: Some(identity.into()),
            elapsed_ms: elapsed,
        }
    }

    pub(super) fn failure(error: impl Into<String>, elapsed: u64) -> Self {
        Self {
            ok: false,
            error: Some(error.into()),
            identity: None,
            elapsed_ms: elapsed,
        }
    }
}

pub(super) fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

pub(super) fn probe_client() -> Client {
    build_http_client(std::time::Duration::from_secs(10))
}
