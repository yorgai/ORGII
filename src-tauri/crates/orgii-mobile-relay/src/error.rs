//! Crate-wide error type.
//!
//! Variants beyond `Io` and `Server` are declared up-front so call sites
//! in Phase 2 (storage init, pairing claim, frame routing) can fail with
//! a typed error from day one instead of stringly-typed `String` errors
//! that need to be re-classified later.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RelayError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// Catch-all for axum / hyper failures during `serve()` that don't
    /// map cleanly onto `io::Error`. Keep the variant `String` so we
    /// don't leak third-party error types across the crate boundary.
    #[error("server error: {0}")]
    Server(String),

    /// Reserved for Phase 2 storage layer (SQLite open / migration /
    /// query failures). Wired here so signatures returning `RelayError`
    /// don't need to grow a variant later.
    #[error("storage error: {0}")]
    Storage(String),

    /// Reserved for Phase 2 pairing / token validation paths.
    #[error("auth error: {0}")]
    Auth(String),

    /// Reserved for Phase 2 frame routing failures (unknown desktop id,
    /// closed channel, version mismatch).
    #[error("protocol error: {0}")]
    Protocol(String),
}
