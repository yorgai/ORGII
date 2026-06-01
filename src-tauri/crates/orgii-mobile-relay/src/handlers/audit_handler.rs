//! `GET /audit` and `POST /audit/record` — read + write endpoints for
//! the relay-local audit log.
//!
//! Mirrors the auth boilerplate of [`super::devices`]: the
//! `X-User-Id` header identifies the calling account and the handler
//! always scopes results to that account. A caller cannot probe
//! another user's rows even by spoofing query parameters because the
//! handler overwrites `AuditQuery::user_id` with the header value
//! before passing the filter to storage.
//!
//! ## `GET /audit` query parameters
//!
//! All optional:
//!
//! | param        | type   | semantics                                         |
//! |--------------|--------|---------------------------------------------------|
//! | `device_id`  | string | exact match on the audited device                 |
//! | `command`    | string | exact match on the canonical command name         |
//! | `since_ts_ms`| i64    | only rows with `ts_ms >= since_ts_ms`             |
//! | `limit`      | u32    | default 100, hard-capped server-side at 1000      |
//! | `ok_only`    | bool   | true = successes only, false = failures only      |
//!
//! ## `POST /audit/record` body
//!
//! Mirrors [`AuditRecord`] minus the storage-assigned `id` and the
//! optional `error` field — the desktop's audit logger only emits the
//! summary line, not the underlying error string. The body's
//! `user_id` MUST equal the `X-User-Id` header; this is a self-report
//! endpoint, not a moderator surface.
//!
//! ## Status codes
//!
//! - `200 OK` — `GET /audit` array of `AuditRecord` JSON objects,
//!   newest-first.
//! - `202 Accepted` — `POST /audit/record` accepted the row for
//!   asynchronous persistence. The handler does NOT wait for the
//!   SQLite write to complete; the design doc explicitly forbids
//!   audit writes from sitting on the dispatch hot path.
//! - `400 Bad Request` — `X-User-Id` is non-ASCII; `limit` is not a
//!   parseable u32; `ok_only` is not a parseable bool; `command`
//!   exceeds [`AUDIT_RECORD_COMMAND_MAX_LEN`] characters; or
//!   `latency_ms` is implausibly large
//!   ([`AUDIT_RECORD_LATENCY_MAX_MS`]).
//! - `401 Unauthorized` — `X-User-Id` header missing or empty.
//! - `403 Forbidden` — `POST /audit/record` body's `user_id` does
//!   not match the `X-User-Id` header (cross-tenant report attempt).
//! - `500 Internal Server Error` — storage layer failed (read path
//!   only; the write path returns 202 before the storage call
//!   resolves).

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use orgii_protocol::{DeviceId, UserId};
use serde::Deserialize;

use crate::audit::{AuditQuery, AuditRecord, AuditWriter};
use crate::state::AppState;

const HEADER_USER_ID: &str = "x-user-id";

/// Maximum accepted length of the `command` field on a posted audit
/// row. Mirrors the dispatch layer's command vocabulary (canonical
/// command names are short snake_case strings) plus a safety margin
/// for any future namespacing. Anything larger is rejected as
/// malformed input rather than silently truncated.
pub const AUDIT_RECORD_COMMAND_MAX_LEN: usize = 256;

/// Maximum plausible per-call latency, in milliseconds. Ten minutes
/// is well past anything a real RPC dispatch can take; values larger
/// than this are almost certainly bugs (signed/unsigned underflow,
/// wrong time unit) and rejected so they don't pollute dashboards.
pub const AUDIT_RECORD_LATENCY_MAX_MS: u64 = 10 * 60 * 1000;

pub fn audit_routes() -> Router<AppState> {
    Router::new()
        .route("/audit", get(list_audit))
        .route("/audit/record", post(record_audit))
}

/// Wire-side query string. Lives separately from [`AuditQuery`]
/// because the latter carries an authenticated `user_id` that callers
/// must not be able to spoof through the URL.
#[derive(Debug, Deserialize)]
struct AuditQueryParams {
    device_id: Option<String>,
    command: Option<String>,
    since_ts_ms: Option<i64>,
    limit: Option<u32>,
    ok_only: Option<bool>,
}

fn error_response(status: StatusCode, message: impl Into<String>) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": message.into() }))).into_response()
}

fn extract_user_id(headers: &HeaderMap) -> Result<UserId, axum::response::Response> {
    let value = headers
        .get(HEADER_USER_ID)
        .ok_or_else(|| error_response(StatusCode::UNAUTHORIZED, "missing X-User-Id header"))?;
    let s = value.to_str().map_err(|_| {
        error_response(
            StatusCode::BAD_REQUEST,
            "X-User-Id header is not valid ASCII",
        )
    })?;
    if s.is_empty() {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "empty X-User-Id header",
        ));
    }
    Ok(UserId::new(s))
}

async fn list_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<AuditQueryParams>,
) -> axum::response::Response {
    let user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    // The user_id field on AuditQuery is filled from the header — never
    // from URL params — to prevent caller-spoofed cross-user reads.
    let filter = AuditQuery {
        user_id,
        device_id: params.device_id.map(DeviceId::new),
        command: params.command,
        since_ts_ms: params.since_ts_ms,
        limit: params.limit,
        ok_only: params.ok_only,
    };

    match state.storage.audit_query(filter).await {
        Ok(rows) => (StatusCode::OK, Json(rows)).into_response(),
        Err(err) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("storage audit_query failed: {err}"),
        ),
    }
}

/// Wire-side body of `POST /audit/record`. Mirrors the persisted
/// [`AuditRecord`] minus the storage-assigned `id`. The desktop's
/// audit logger does not retain the underlying error string, so the
/// `error` column is always written as `None` for self-reported
/// rows.
#[derive(Debug, Clone, Deserialize)]
pub struct AuditRecordBody {
    pub user_id: String,
    pub source_device_id: String,
    pub command: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub ts_ms: i64,
}

async fn record_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AuditRecordBody>,
) -> axum::response::Response {
    let header_user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    if body.user_id.is_empty() || body.user_id != header_user_id.as_str() {
        // Self-report endpoint: the body's user_id must match the
        // authenticated header so a compromised desktop cannot post
        // audit rows that look like another tenant's traffic.
        return error_response(
            StatusCode::FORBIDDEN,
            "body user_id does not match X-User-Id header",
        );
    }

    if body.command.is_empty() || body.command.len() > AUDIT_RECORD_COMMAND_MAX_LEN {
        return error_response(
            StatusCode::BAD_REQUEST,
            format!(
                "command length must be 1..={} characters",
                AUDIT_RECORD_COMMAND_MAX_LEN
            ),
        );
    }

    if body.latency_ms > AUDIT_RECORD_LATENCY_MAX_MS {
        return error_response(
            StatusCode::BAD_REQUEST,
            format!(
                "latency_ms {} exceeds {} ms cap",
                body.latency_ms, AUDIT_RECORD_LATENCY_MAX_MS
            ),
        );
    }

    let record = AuditRecord {
        id: 0,
        ts_ms: body.ts_ms,
        user_id: header_user_id,
        device_id: DeviceId::new(body.source_device_id),
        command: body.command,
        ok: body.ok,
        latency_ms: body.latency_ms,
        error: None,
    };

    // `AuditWriter::record` is non-blocking — it spawns the SQLite
    // write onto a tokio task and returns synchronously. Construct
    // the writer on the fly from `state.storage`; it is a thin
    // `Arc<dyn Storage>` wrapper, so this is allocation-cheap and
    // keeps `AppState` unchanged for now.
    AuditWriter::new(state.storage.clone()).record(record);

    StatusCode::ACCEPTED.into_response()
}

#[cfg(test)]
#[path = "audit_handler_tests.rs"]
mod tests;
