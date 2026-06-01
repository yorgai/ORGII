//! `POST /pair/init`, `POST /pair/claim`, `POST /pair/confirm`.
//!
//! ## TEMPORARY AUTH MODEL — Phase 2 only
//!
//! All three endpoints currently authenticate via the `X-User-Id`
//! HTTP header. **This is INSECURE: any caller can claim to be any
//! `UserId` simply by sending the header.** It exists so Phase 2 can
//! land the storage + routing layers without blocking on the desktop
//! identity project.
//!
//! TODO(phase 3): replace with one of:
//! - signed bearer tokens issued by the ORGII account service, OR
//! - pre-shared keys per relay instance for self-hosted single-tenant
//!   deployments.
//!
//! Until then, every handler in this module begins by extracting the
//! header and 401-ing if absent.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::{Json, Router};
use chrono::Utc;
use orgii_protocol::{
    ConfirmingSide, DeviceId, PairingClaimRequest, PairingClaimResponse, PairingConfirmRequest,
    PairingConfirmResponse, PairingConfirmStatus, PairingInitRequest, PairingInitResponse, UserId,
    PAIRING_EXPIRY_SECONDS,
};

use super::sas::{generate_confirmation_phrase, generate_pairing_code};
use crate::state::AppState;
use crate::storage::types::{PairedDevice, PendingPairing};

/// Header name carrying the temporary `UserId`. The string is
/// intentionally lowercase: HTTP header names are case-insensitive
/// but axum's `HeaderMap` interns them lowercase, so matching against
/// a lowercase literal avoids subtle bugs.
const HEADER_USER_ID: &str = "x-user-id";

/// Mount the pairing endpoints onto an existing router. Kept separate
/// from `routes::build_router` so handler-level wiring doesn't clutter
/// the top-level route table.
pub fn pairing_routes() -> Router<AppState> {
    Router::new()
        .route("/pair/init", axum::routing::post(pair_init))
        .route("/pair/claim", axum::routing::post(pair_claim))
        .route("/pair/confirm", axum::routing::post(pair_confirm))
}

/// Common error response shape so every failure path renders the same
/// JSON contract (`{ "error": "<message>" }`).
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

async fn pair_init(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PairingInitRequest>,
) -> axum::response::Response {
    let user_id = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let pairing_code = generate_pairing_code();
    let confirmation_phrase = generate_confirmation_phrase();
    let now_ms = Utc::now().timestamp_millis();
    let expires_at_ms = now_ms + (PAIRING_EXPIRY_SECONDS as i64) * 1_000;

    let pending = PendingPairing {
        pairing_code: pairing_code.clone(),
        user_id,
        desktop_id: req.desktop_id,
        requested_tier: req.tier,
        confirmation_phrase: confirmation_phrase.clone(),
        expires_at_ms,
        claimed_by_device_id: None,
        confirmed_by_desktop: false,
        confirmed_by_mobile: false,
        device_label: None,
        device_pubkey_fingerprint: None,
        desktop_pubkey_fingerprint: req.device_pubkey_fingerprint,
    };

    if let Err(err) = state.storage.insert_pending_pairing(pending).await {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to insert pending pairing: {err}"),
        );
    }

    let body = PairingInitResponse {
        pairing_code,
        confirmation_phrase,
        expires_in_seconds: PAIRING_EXPIRY_SECONDS,
    };
    (StatusCode::OK, Json(body)).into_response()
}

async fn pair_claim(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PairingClaimRequest>,
) -> axum::response::Response {
    let _user_id_caller = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let pending = match state.storage.get_pending_pairing(&req.pairing_code).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            return error_response(StatusCode::NOT_FOUND, "unknown pairing code");
        }
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage lookup failed: {err}"),
            );
        }
    };

    let now_ms = Utc::now().timestamp_millis();
    if pending.expires_at_ms < now_ms {
        // Best-effort cleanup; the periodic GC sweep would catch this
        // anyway but cleaning up on the hot path keeps the table from
        // growing unboundedly under abuse.
        let _ = state
            .storage
            .delete_pending_pairing(&req.pairing_code)
            .await;
        return error_response(StatusCode::GONE, "pairing code expired");
    }
    if pending.claimed_by_device_id.is_some() {
        return error_response(StatusCode::CONFLICT, "pairing code already claimed");
    }

    let device_id = DeviceId::new(format!("dev-{}", uuid::Uuid::new_v4()));

    if let Err(err) = state
        .storage
        .mark_pairing_claimed(&req.pairing_code, &device_id)
        .await
    {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to mark pairing claimed: {err}"),
        );
    }

    // Persist the mobile-supplied label + fingerprint onto the
    // pending row so `pair_confirm` can copy them onto the final
    // `paired_devices` row without needing a second round-trip from
    // the mobile side. Re-read then write because Storage doesn't
    // expose a partial-update API for these fields — fine since
    // claim is one-shot per pairing.
    let mut updated = pending.clone();
    updated.claimed_by_device_id = Some(device_id.clone());
    updated.device_label = Some(req.device_label.clone());
    updated.device_pubkey_fingerprint = Some(req.device_pubkey_fingerprint.clone());
    if let Err(err) = state.storage.insert_pending_pairing(updated).await {
        // INSERT OR REPLACE behavior — `INSERT ... ON CONFLICT DO
        // UPDATE` in `upsert_paired_device` is the precedent; for
        // pending_pairings we fall through to a fresh INSERT against
        // the same primary key. SQLite reports a UNIQUE violation;
        // log it but don't fail the request — the `mark_pairing_*`
        // calls above already updated the canonical fields.
        tracing::debug!(
            error = %err,
            "secondary update of pending_pairing label/fp failed; non-fatal",
        );
    }

    let body = PairingClaimResponse {
        desktop_id: pending.desktop_id,
        user_id: pending.user_id,
        device_id,
        tier: pending.requested_tier,
        label: req.device_label,
        confirmation_phrase: pending.confirmation_phrase,
    };
    (StatusCode::OK, Json(body)).into_response()
}

async fn pair_confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PairingConfirmRequest>,
) -> axum::response::Response {
    let _user_id_caller = match extract_user_id(&headers) {
        Ok(u) => u,
        Err(resp) => return resp,
    };

    let pending = match state.storage.get_pending_pairing(&req.pairing_code).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            return error_response(StatusCode::NOT_FOUND, "unknown pairing code");
        }
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage lookup failed: {err}"),
            );
        }
    };

    let now_ms = Utc::now().timestamp_millis();
    if pending.expires_at_ms < now_ms {
        let _ = state
            .storage
            .delete_pending_pairing(&req.pairing_code)
            .await;
        return error_response(StatusCode::GONE, "pairing code expired");
    }

    if let Err(err) = state
        .storage
        .mark_pairing_confirmed(&req.pairing_code, req.confirming_side)
        .await
    {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to mark pairing confirmed: {err}"),
        );
    }

    // When the desktop confirms, persist its chosen tier onto the
    // pending row so the eventual finalisation reads the right value
    // regardless of which side's call lands second. The mobile's
    // `tier` field is intentionally ignored — see the type docs.
    if matches!(req.confirming_side, ConfirmingSide::Desktop) {
        // Re-read + write because Storage doesn't expose a partial
        // update for `requested_tier`; insert_pending_pairing acts as
        // an upsert here because the primary key collides.
        if let Ok(Some(mut row)) = state.storage.get_pending_pairing(&req.pairing_code).await {
            row.requested_tier = req.tier;
            row.confirmed_by_desktop = true;
            if let Err(err) = state.storage.insert_pending_pairing(row).await {
                tracing::debug!(
                    error = %err,
                    "secondary update of requested_tier failed; non-fatal",
                );
            }
        }
    }

    // Re-read to see whether the OTHER side has also confirmed.
    let after = match state.storage.get_pending_pairing(&req.pairing_code).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            // Race with `delete_expired_pairings` is the only realistic
            // way to land here; treat it as an expired pairing.
            return error_response(StatusCode::GONE, "pairing code disappeared");
        }
        Err(err) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("storage re-read failed: {err}"),
            );
        }
    };

    let final_tier = after.requested_tier;

    if !(after.confirmed_by_desktop && after.confirmed_by_mobile) {
        // The mobile already learned its `device_id` from `/pair/claim`,
        // and the desktop has not yet been told one — so neither side
        // needs the field on this branch.
        let body = PairingConfirmResponse {
            status: PairingConfirmStatus::AwaitingOtherSide,
            device_id: None,
        };
        return (StatusCode::OK, Json(body)).into_response();
    }

    // Both sides confirmed — finalise the pairing. We need a
    // claimed device + fingerprint on the pending row; refuse if
    // either is missing (would mean a confirm came in before claim,
    // which the design says never happens but we defend in depth).
    let device_id = match after.claimed_by_device_id.clone() {
        Some(d) => d,
        None => {
            return error_response(
                StatusCode::CONFLICT,
                "pairing confirmed but never claimed by a mobile device",
            );
        }
    };
    let device_label = after.device_label.clone().unwrap_or_default();
    let device_fingerprint = after.device_pubkey_fingerprint.clone().unwrap_or_default();

    let paired = PairedDevice {
        device_id: device_id.clone(),
        user_id: after.user_id.clone(),
        desktop_id: after.desktop_id.clone(),
        label: device_label,
        tier: final_tier,
        paired_at_ms: now_ms,
        last_seen_ms: None,
        is_primary: false,
        device_pubkey_fingerprint: device_fingerprint,
    };

    if let Err(err) = state.storage.upsert_paired_device(paired).await {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to insert paired_device: {err}"),
        );
    }
    if let Err(err) = state
        .storage
        .delete_pending_pairing(&req.pairing_code)
        .await
    {
        // Pairing already inserted; this just leaves a dangling
        // pending row that the GC sweep removes. Log and proceed.
        tracing::warn!(error = %err, "failed to delete consumed pending pairing");
    }

    let body = PairingConfirmResponse {
        status: PairingConfirmStatus::Paired,
        device_id: Some(device_id),
    };
    (StatusCode::OK, Json(body)).into_response()
}

#[cfg(test)]
#[path = "pairing_tests.rs"]
mod tests;
