/**
 * usePairingFlow
 *
 * State machine for the pairing wizard:
 *
 *   idle -> initializing -> awaitingMobile -> success
 *                       \-> error
 *                        \-> cancelled
 *
 * Stages:
 *   - idle:           dialog just opened, user hasn't started yet
 *   - initializing:   `mobile_remote_pair_init` in flight
 *   - awaitingMobile: QR + SAS phrase shown; polling list_devices
 *                     every 2s for a NEW device record
 *   - success:        a new device appeared; show confirmation
 *   - error:          init failed or polling raised; surface message
 *   - cancelled:      user pressed Cancel; rely on relay TTL to expire
 *                     the pairing code
 *
 * Polling is gated by an `enabled` flag and cancelled in cleanup, per
 * the workspace hook rules. The `start()` action transitions idle ->
 * initializing; the dialog calls it on open.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type PairedDeviceInfo,
  type PairingInitOutput,
  type PermissionTier,
  listDevices,
  pairInit,
} from "@src/api/tauri/mobileRemote";

export type PairingStage =
  | "idle"
  | "initializing"
  | "awaitingMobile"
  | "success"
  | "error"
  | "cancelled";

export interface PairingFlowState {
  stage: PairingStage;
  init: PairingInitOutput | null;
  newDevice: PairedDeviceInfo | null;
  errorKey: string | null;
}

export interface UsePairingFlowArgs {
  /** Gates ALL side effects (poll + init kicks). */
  enabled: boolean;
  /** User-chosen tier for the new device. */
  tier: PermissionTier;
  /** User-chosen label for the new device. */
  label: string;
  /** Whether to mark this as the primary desktop on pair-init. */
  isPrimary: boolean;
  /**
   * Snapshot of device IDs the local cache already knows about at the
   * moment the dialog opens. The flow watches for a new ID outside
   * this set — that's how we detect "the mobile finished claiming".
   */
  knownDeviceIds: ReadonlySet<string>;
  /** Called when the flow successfully observes a new device. */
  onSuccess?: (device: PairedDeviceInfo) => void;
}

const POLL_INTERVAL_MS = 2_000;

/** Map a Rust error string to an i18n key under `mobileRemote.errors`. */
function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("expired") || lower.includes("not found")) {
    return "mobileRemote.errors.codeExpired";
  }
  if (lower.includes("init") || lower.includes("relay")) {
    return "mobileRemote.errors.pairInitFailed";
  }
  return "mobileRemote.errors.unknown";
}

export function usePairingFlow(args: UsePairingFlowArgs): {
  state: PairingFlowState;
  start: () => void;
  cancel: () => void;
  reset: () => void;
} {
  const { enabled, tier, label, isPrimary, knownDeviceIds, onSuccess } = args;

  const [state, setState] = useState<PairingFlowState>({
    stage: "idle",
    init: null,
    newDevice: null,
    errorKey: null,
  });

  // Latch user inputs into refs so the polling effect doesn't have to
  // depend on values that change between dialog renders. The effect is
  // re-keyed only on the stage transition.
  const knownIdsRef = useRef(knownDeviceIds);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    knownIdsRef.current = knownDeviceIds;
  }, [knownDeviceIds]);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const start = useCallback(() => {
    setState({
      stage: "initializing",
      init: null,
      newDevice: null,
      errorKey: null,
    });
  }, []);

  const cancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      stage: "cancelled",
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      stage: "idle",
      init: null,
      newDevice: null,
      errorKey: null,
    });
  }, []);

  // Kick the initial pair_init call when entering `initializing`.
  useEffect(() => {
    if (!enabled) return;
    if (state.stage !== "initializing") return;

    let cancelled = false;
    (async () => {
      try {
        const init = await pairInit({ tier, label, isPrimary });
        if (cancelled) return;
        setState({
          stage: "awaitingMobile",
          init,
          newDevice: null,
          errorKey: null,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({
          stage: "error",
          init: null,
          newDevice: null,
          errorKey: classifyError(message),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, state.stage, tier, label, isPrimary]);

  // Poll list_devices while awaiting the mobile side.
  useEffect(() => {
    if (!enabled) return;
    if (state.stage !== "awaitingMobile") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const devices = await listDevices();
        if (cancelled) return;
        const known = knownIdsRef.current;
        const fresh = devices.find((dev) => !known.has(dev.deviceId));
        if (fresh) {
          setState({
            stage: "success",
            init: null,
            newDevice: fresh,
            errorKey: null,
          });
          onSuccessRef.current?.(fresh);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({
          stage: "error",
          init: null,
          newDevice: null,
          errorKey: classifyError(message),
        });
        return;
      }
      if (!cancelled) {
        timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    timeoutId = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  }, [enabled, state.stage]);

  return { state, start, cancel, reset };
}

export default usePairingFlow;
