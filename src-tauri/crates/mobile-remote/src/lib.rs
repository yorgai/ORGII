//! Mobile Remote — desktop-side bridge to the ORGII mobile relay.
//!
//! Connects outward to the standalone `orgii_mobile_relay` and forwards
//! RPCs from a paired phone / browser back into the existing Tauri
//! command surface. See
//! `Documentation/MainApp/collaboration/mobile-remote-control--0504.md`
//! for the architecture.
//!
//! ## Layering
//!
//! Pure leaf — no back-edges into `app`. The `DispatchHost` trait
//! (`dispatch::DispatchHost`) is the integration point: production code
//! in `app::lib.rs::run` constructs a `dispatch::TauriDispatchHost`
//! (which depends on `agent_core::state::AgentAppState`) and a
//! `dispatch::SessionListProvider` adapter (which forwards to
//! `crate::agent_sessions::unified_stats::list_all_sessions`) and hands
//! both to `BridgeSupervisor::start`. The supervisor owns wiring; the
//! bridge / pairing / relay-client layers know nothing about
//! `agent_core` or `agent_sessions`.
//!
//! ## Owned Tauri commands
//!
//! Re-registered from `commands/handler_list.inc` via the bare
//! `mobile_remote::pairing::commands::…` paths.

pub mod allowlist;
pub mod audit;
pub mod bridge;
pub mod config;
pub mod dispatch;
pub mod error;
pub mod pairing;
pub mod relay_client;
pub mod supervisor;

#[cfg(test)]
pub(crate) mod test_utils {
    use std::sync::Once;

    /// Install the process-wide rustls crypto provider so tests that
    /// construct `reqwest::Client` (or `tokio_tungstenite::connect_async`)
    /// don't panic with `"No provider set"`. Idempotent.
    pub fn install_crypto_provider_for_tests() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        });
    }
}
