//! HTTP handlers for the relay's pairing endpoints.
//!
//! Phase 2 ships three: `POST /pair/init`, `POST /pair/claim`,
//! `POST /pair/confirm`. The WebSocket upgrade handler is deferred to
//! Phase 2.5/3.

// Most handlers in this module return `Result<T, axum::response::Response>`
// so the caller can `?`-propagate ready-to-send error responses. Clippy's
// `result_large_err` lint flags this because `Response<Body>` is ~256 bytes,
// but boxing the error would force an extra heap allocation on every handler
// branch — for a request-scoped error path that's a clear loss in clarity
// for no measurable gain. Suppress at the module level.
#![allow(clippy::result_large_err)]

pub mod audit_handler;
pub mod devices;
pub mod pairing;
pub mod sas;
pub mod ws_desktop;
pub mod ws_mobile;

pub use audit_handler::audit_routes;
pub use devices::device_routes;
pub use pairing::pairing_routes;
pub use ws_desktop::desktop_ws_routes;
pub use ws_mobile::mobile_ws_routes;
