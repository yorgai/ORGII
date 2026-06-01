//! HTTP route table for the relay server.
//!
//! The router is split in two:
//!
//! - `http`: short-lived requests wrapped in [`TimeoutLayer`] —
//!   liveness probes, `/version`, pairing, device CRUD.
//! - `ws`: long-lived WebSocket upgrades that must NOT be wrapped in
//!   the request timeout (otherwise a healthy connection gets
//!   killed at the 30 s mark). `/mobile/connect` and
//!   `/desktop/connect` both live here.
//!
//! Both halves share the same `AppState` and CORS policy.

use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use orgii_protocol::PROTOCOL_VERSION;
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;

use crate::handlers::{
    audit_routes, desktop_ws_routes, device_routes, mobile_ws_routes, pairing_routes,
};
use crate::state::AppState;

/// Per-request timeout. axum will return 408 Request Timeout when the
/// downstream handler hasn't completed in time. Conservative for HTTP;
/// the WebSocket routes are merged AFTER this layer so long-lived
/// sockets don't trip it.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub fn build_router(state: AppState) -> Router {
    let http = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/version", get(version))
        .merge(pairing_routes())
        .merge(device_routes())
        .merge(audit_routes())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ));
    let ws = mobile_ws_routes().merge(desktop_ws_routes());

    http.merge(ws)
        .with_state(state)
        .layer(CorsLayer::permissive())
}

async fn healthz(State(_state): State<AppState>) -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn readyz(State(_state): State<AppState>) -> impl IntoResponse {
    // Phase 2 will gate readiness on storage + UserHub registry being
    // live. Until then "started" implies "ready".
    (StatusCode::OK, "ready")
}

async fn version(State(_state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": {
            "major": PROTOCOL_VERSION.major,
            "minor": PROTOCOL_VERSION.minor,
        },
    }))
}

#[cfg(test)]
#[path = "routes_tests.rs"]
mod tests;
