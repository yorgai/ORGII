//! `GET /devices`, `DELETE /devices/:id`, `PUT /devices/:id/primary`.
//!
//! Phase 5 Lane-A endpoint: lets the desktop reconcile its local
//! paired-device cache against the server-side truth, revoke a device
//! server-side (so the relay refuses future RPC frames from it), and
//! mark a desktop as the user's primary.
//!
//! ## Auth
//!
//! Reuses the same `X-User-Id` temporary header model as the pairing
//! endpoints. See `handlers::pairing` for the full rationale and the
//! Phase 3 replacement plan; do NOT add a parallel auth path here.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::{Json, Router};
use orgii_protocol::{
    DesktopId, DeviceId, DeviceListEntry, DeviceListResponse, SetPrimaryDesktopResponse, UserId,
};

use crate::state::AppState;

const HEADER_USER_ID: &str = "x-user-id";

pub fn device_routes() -> Router<AppState> {
    Router::new()
        .route("/devices", axum::routing::get(list_devices))
        .route("/devices/{device_id}", axum::routing::delete(revoke_device))
        .route(
            "/desktops/{desktop_id}/primary",
            axum::routing::put(set_primary_desktop),
        )
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

async fn list_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> axum::response::Response {
    let user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let rows = match state.storage.list_paired_devices_for_user(&user_id).await {
        Ok(rows) => rows,
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage list failed: {err}"),
            );
        }
    };

    let body = DeviceListResponse {
        devices: rows
            .into_iter()
            .map(|row| DeviceListEntry {
                device_id: row.device_id,
                desktop_id: row.desktop_id,
                label: row.label,
                tier: row.tier,
                paired_at_ms: row.paired_at_ms,
                last_seen_ms: row.last_seen_ms,
                is_primary: row.is_primary,
            })
            .collect(),
    };
    (StatusCode::OK, Json(body)).into_response()
}

/// `DELETE /devices/:device_id` — revoke a paired mobile device.
///
/// Returns 404 if the device doesn't exist OR doesn't belong to the
/// caller; we deliberately conflate the two so a probe can't enumerate
/// device IDs across users. Returns 204 on success — there's no body
/// worth returning since the caller already knows the device_id.
async fn revoke_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> axum::response::Response {
    let user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let device_id = DeviceId::new(device_id);

    let existing = match state.storage.get_paired_device(&device_id).await {
        Ok(d) => d,
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage lookup failed: {err}"),
            );
        }
    };
    let Some(row) = existing else {
        return error_response(StatusCode::NOT_FOUND, "device not found");
    };
    if row.user_id != user_id {
        // Cross-user probe; same response as not-found to avoid
        // leaking which device IDs exist on other accounts.
        return error_response(StatusCode::NOT_FOUND, "device not found");
    }

    if let Err(err) = state.storage.revoke_paired_device(&device_id).await {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("revoke failed: {err}"),
        );
    }

    // TODO(phase 6): drop any active WS session for this device by
    // signalling the UserHubRegistry. For now the device's WS will
    // notice on its next reconnect attempt because the authn lookup
    // will miss.
    StatusCode::NO_CONTENT.into_response()
}

/// `PUT /desktops/:desktop_id/primary` — mark a desktop as the user's
/// primary. Idempotent: re-issuing for the current primary is a no-op.
///
/// Returns the new primary `desktop_id` so the client can update local
/// state without an extra `GET /devices` round-trip.
async fn set_primary_desktop(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(desktop_id): Path<String>,
) -> axum::response::Response {
    let user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    let desktop_id = DesktopId::new(desktop_id);

    // Verify the user actually has a paired device on that desktop —
    // otherwise we'd let any caller mark any desktop_id primary.
    let owns = match state.storage.list_paired_devices_for_user(&user_id).await {
        Ok(rows) => rows.iter().any(|row| row.desktop_id == desktop_id),
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage list failed: {err}"),
            );
        }
    };
    if !owns {
        return error_response(StatusCode::NOT_FOUND, "no paired device on that desktop");
    }

    if let Err(err) = state
        .storage
        .set_primary_desktop(&user_id, &desktop_id)
        .await
    {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("set primary failed: {err}"),
        );
    }

    let body = SetPrimaryDesktopResponse { desktop_id };
    (StatusCode::OK, Json(body)).into_response()
}

#[cfg(test)]
#[path = "devices_tests.rs"]
mod tests;
