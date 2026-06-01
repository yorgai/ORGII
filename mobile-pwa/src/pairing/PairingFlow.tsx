// Mobile-side pairing orchestrator.
//
// Drives the user through the full QR-plus-SAS flow from the phone:
//
//   idle → scanning → claiming → awaiting_sas → confirming → done
//
// with `error` reachable from every transient state. The desktop runs
// its own pairing wizard in parallel; the relay holds both sides'
// state and only finalises the pairing after BOTH have called
// /pair/confirm.
//
// Why this state machine, not a series of useEffects: the SAS
// confirmation step is human-paced (the user physically reads the
// phrase off two screens). Modeling that as a discrete waiting state
// lets us guard against double-submitting on impatient taps and lets
// us resume cleanly if the user backgrounds the tab partway through.
import { useCallback, useReducer } from "react";

import {
  type PairClaimResponse,
  type PermissionTier,
  pairClaim,
  pairConfirm,
} from "../api/relay";
import { type QrPayload, QrScanner } from "./QrScanner";

/** Persisted shape under localStorage key "orgii.pairing".
 *
 * `deviceToken` is reserved for when the relay starts issuing one
 * (today it does not — see the report from this subagent). The PWA
 * still authenticates by the temporary `X-User-Id` header. */
export interface PairedSession {
  relayUrl: string;
  desktopId: string;
  userId: string;
  deviceId: string;
  /** Tier the desktop chose at /pair/init time, echoed back by /pair/claim. */
  tier: PermissionTier;
  /** Human label the mobile sent in /pair/claim — useful for debug UI. */
  label: string;
  /** Reserved for the relay-issued bearer token (Phase 3). Today
   * unset on every successful pairing. */
  deviceToken?: string;
}

export const PAIRED_STORAGE_KEY = "orgii.pairing";

interface Props {
  /** The temporary user id used to author the X-User-Id header on
   * /pair/claim and /pair/confirm. Same value the WS leg uses. */
  userId: string;
  /** Human label this device sends in /pair/claim. */
  deviceLabel: string;
  /** Called once pairing completes successfully. The parent persists
   * the value via PairedSession storage helpers and transitions to
   * "connecting". */
  onPaired: (session: PairedSession) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "claiming"; payload: QrPayload }
  | {
      kind: "awaiting_sas";
      payload: QrPayload;
      claim: PairClaimResponse;
    }
  | {
      kind: "confirming";
      payload: QrPayload;
      claim: PairClaimResponse;
    }
  | {
      kind: "done";
      session: PairedSession;
    }
  | { kind: "error"; message: string };

type Action =
  | { type: "begin" }
  | { type: "scanned"; payload: QrPayload }
  | { type: "claimed"; payload: QrPayload; claim: PairClaimResponse }
  | { type: "confirm_start" }
  | { type: "confirmed"; session: PairedSession }
  | { type: "fail"; message: string }
  | { type: "reset" };

function reduce(state: Status, action: Action): Status {
  switch (action.type) {
    case "begin":
      return { kind: "scanning" };
    case "scanned":
      // Only accept a scan when we are still in the scanning state.
      // BarcodeDetector can fire multiple results per frame; the
      // guard prevents the user from claiming twice.
      if (state.kind !== "scanning") {
        return state;
      }
      return { kind: "claiming", payload: action.payload };
    case "claimed":
      if (state.kind !== "claiming") {
        return state;
      }
      return {
        kind: "awaiting_sas",
        payload: action.payload,
        claim: action.claim,
      };
    case "confirm_start":
      if (state.kind !== "awaiting_sas") {
        return state;
      }
      return {
        kind: "confirming",
        payload: state.payload,
        claim: state.claim,
      };
    case "confirmed":
      return { kind: "done", session: action.session };
    case "fail":
      return { kind: "error", message: action.message };
    case "reset":
      return { kind: "scanning" };
  }
}

export function PairingFlow({
  userId,
  deviceLabel,
  onPaired,
}: Props): JSX.Element {
  const [status, dispatch] = useReducer(reduce, { kind: "idle" });

  const beginScan = useCallback(() => {
    dispatch({ type: "begin" });
  }, []);

  const onScanned = useCallback(
    (payload: QrPayload) => {
      dispatch({ type: "scanned", payload });
      // Kick off /pair/claim. We do not await here; the dispatch
      // above already moved us into "claiming" so the UI shows a
      // spinner while we wait for the relay.
      void (async () => {
        try {
          // The PWA does not yet own a real keypair; pass an empty
          // fingerprint. The relay stores it verbatim and the
          // desktop can verify it later when WebCrypto identity
          // lands. The label is human-supplied — for the alpha we
          // pass through `deviceLabel` from the caller.
          const claim = await pairClaim(payload.relayUrl, userId, {
            pairing_code: payload.pairingCode,
            device_label: deviceLabel,
            device_pubkey_fingerprint: "",
          });
          dispatch({ type: "claimed", payload, claim });
        } catch (err) {
          dispatch({
            type: "fail",
            message:
              err instanceof Error
                ? `Could not redeem pairing code: ${err.message}`
                : "Could not redeem pairing code.",
          });
        }
      })();
    },
    [userId, deviceLabel]
  );

  const onConfirm = useCallback(() => {
    if (status.kind !== "awaiting_sas") {
      return;
    }
    const { payload, claim } = status;
    dispatch({ type: "confirm_start" });
    void (async () => {
      try {
        // Pass through the tier echoed by /pair/claim. The relay
        // ignores the mobile's `tier` field on /pair/confirm (the
        // desktop owns that decision at /pair/init time), but the
        // request shape requires the field, so we send the value
        // /pair/claim already gave us. If the relay ever stops
        // echoing tier, fall back to a string the relay will
        // tolerate — but breaking that contract should be a relay-
        // side change with an explicit migration.
        const response = await pairConfirm(payload.relayUrl, userId, {
          pairing_code: payload.pairingCode,
          confirming_side: "mobile",
          tier: claim.tier,
        });
        if (response.status === "awaiting_other_side") {
          // The relay will keep the pairing row alive until the
          // desktop also confirms. We treat this as success on the
          // mobile side because there is nothing more for the user
          // to do here. The desktop is expected to confirm
          // automatically as part of its own wizard flow.
        }
        const session: PairedSession = {
          relayUrl: payload.relayUrl,
          desktopId: claim.desktop_id,
          userId: claim.user_id,
          deviceId: response.device_id ?? claim.device_id,
          tier: claim.tier,
          label: claim.label,
          deviceToken: undefined,
        };
        dispatch({ type: "confirmed", session });
        onPaired(session);
      } catch (err) {
        dispatch({
          type: "fail",
          message:
            err instanceof Error
              ? `Confirmation failed: ${err.message}`
              : "Confirmation failed.",
        });
      }
    })();
  }, [status, userId, onPaired]);

  const onCancelMismatch = useCallback(() => {
    dispatch({
      type: "fail",
      message:
        "You reported the phrase did not match. Pairing aborted. Re-scan to try again — make sure you are looking at the right desktop.",
    });
  }, []);

  const onRetry = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  switch (status.kind) {
    case "idle":
      return (
        <section>
          <p className="status">
            Pair this phone with your desktop. The desktop will show a QR code
            under Settings → Mobile Remote → Add device.
          </p>
          <button type="button" className="btn" onClick={beginScan}>
            Start pairing
          </button>
        </section>
      );

    case "scanning":
      return (
        <section>
          <h2>Scan QR</h2>
          <QrScanner onScanned={onScanned} />
        </section>
      );

    case "claiming":
      return (
        <section>
          <p className="status">Redeeming pairing code...</p>
        </section>
      );

    case "awaiting_sas":
      return (
        <section>
          <h2>Confirm pairing phrase</h2>
          <p className="status">
            Compare this phrase to the one on your desktop. Tap{" "}
            <strong>Confirm</strong> only if they match exactly.
          </p>
          <p
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              padding: "0.75rem 1rem",
              border: "1px solid #888",
              borderRadius: 6,
              wordBreak: "break-word",
            }}
          >
            {status.claim.confirmation_phrase}
          </p>
          <p className="status">
            Pairing with desktop <code>{status.claim.desktop_id}</code> for user{" "}
            <code>{status.claim.user_id}</code> at tier{" "}
            <code>{status.claim.tier}</code>.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={onConfirm}>
              Confirm — phrase matches
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={onCancelMismatch}
            >
              Does not match — cancel
            </button>
          </div>
        </section>
      );

    case "confirming":
      return (
        <section>
          <p className="status">Finalising pairing...</p>
        </section>
      );

    case "done":
      return (
        <section>
          <p className="status">
            Paired with desktop <code>{status.session.desktopId}</code>.
            Connecting...
          </p>
        </section>
      );

    case "error":
      return (
        <section>
          <p className="error">{status.message}</p>
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </section>
      );
  }
}
