//! Shared test helpers for the `key_vault` crate.
//!
//! Lives behind `#[cfg(test)]` only — never compiled into the production
//! binary. Use this module instead of duplicating helpers across test files.

use std::sync::Once;

/// Install the `ring` rustls crypto provider exactly once per test process.
///
/// `key_vault`'s `reqwest` dependency is built with the `rustls-no-provider`
/// feature, so any test that constructs a `reqwest::Client` (directly or
/// indirectly via a validator like [`crate::providers::cursor::CursorValidator`])
/// panics with `"No provider set"` unless a crypto provider has been
/// installed in the process. The production binary installs the same
/// provider in `lib.rs::run`; tests need their own one-shot bootstrap.
///
/// Call this at the top of any test (or test helper) that may construct a
/// `reqwest::Client`. It's idempotent and cheap to call repeatedly.
pub fn install_crypto_provider_for_tests() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    });
}
