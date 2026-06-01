// Top-level shell for the mobile PWA.
//
// Owns the connection lifecycle (unpaired → connecting → connected)
// and the localStorage pairing record. T4 will layer client-side
// routing (home | session/:id) on top of the "connected" branch
// using the `<RemoteSessionList onSelectSession>` seam below.
//
// PLACEHOLDER_USER_ID stays "local-user" for the alpha; Plan C T6
// will replace it with a real user id once the desktop side is
// stable.
import { useCallback, useEffect, useRef, useState } from "react";

import { RemoteSessionList } from "./RemoteSessionList";
import { SessionDetail } from "./SessionDetail";
import { type ConnectionStatus, RelayClient } from "./api/relay";
import { PAIRED_STORAGE_KEY, type PairedSession, PairingFlow } from "./pairing";

// Pre-Plan-C testers persisted relay URL + desktop ID into two
// separate keys. Read them at first boot so the migration is silent.
const LEGACY_STORAGE_RELAY_URL = "orgii.relay_url";
const LEGACY_STORAGE_DESKTOP_ID = "orgii.desktop_id";

const PLACEHOLDER_USER_ID = "local-user";
// Default human label sent in /pair/claim. Real device naming UI
// arrives post-alpha; for the spike we just identify the form factor.
const DEFAULT_DEVICE_LABEL = "ORGII mobile";

// Reconnect backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s. Mirrors the
// desktop client's `connect_with_reconnect` schedule in
// `src-tauri/src/api/mobile_remote/relay_client/ws.rs`.
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

type Phase = "unpaired" | "connecting" | "connected";

// Local router state for the `connected` branch. Two routes is enough
// for v1: the session list and one session-detail screen. Lifted to
// App-level (instead of being declared inside the conditional render)
// so React's rules-of-hooks invariant holds — but only consumed inside
// the `connected` branch's JSX.
type ConnectedRoute = { kind: "list" } | { kind: "detail"; id: string };

function loadStoredPairing(): PairedSession | null {
  const raw = localStorage.getItem(PAIRED_STORAGE_KEY);
  if (raw !== null && raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      const coerced = coercePairedSession(parsed);
      if (coerced !== null) {
        return coerced;
      }
    } catch {
      // Fall through to legacy migration; a corrupt blob is
      // recoverable by re-pairing.
    }
  }

  // Migrate from the pre-Plan-C two-key scheme. We can't recover
  // the device_id, tier, or label — those did not exist in the
  // legacy flow — so we synthesize placeholders that the WS leg
  // will accept. The next /pair/claim writes a real record.
  const legacyRelay = (
    localStorage.getItem(LEGACY_STORAGE_RELAY_URL) ?? ""
  ).trim();
  const legacyDesktop = (
    localStorage.getItem(LEGACY_STORAGE_DESKTOP_ID) ?? ""
  ).trim();
  if (legacyRelay !== "" && legacyDesktop !== "") {
    const migrated: PairedSession = {
      relayUrl: legacyRelay,
      desktopId: legacyDesktop,
      userId: PLACEHOLDER_USER_ID,
      deviceId: "",
      tier: "",
      label: "",
      deviceToken: undefined,
    };
    localStorage.setItem(PAIRED_STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_STORAGE_RELAY_URL);
    localStorage.removeItem(LEGACY_STORAGE_DESKTOP_ID);
    return migrated;
  }
  return null;
}

function coercePairedSession(value: unknown): PairedSession | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.relayUrl !== "string" ||
    typeof obj.desktopId !== "string" ||
    typeof obj.userId !== "string"
  ) {
    return null;
  }
  return {
    relayUrl: obj.relayUrl,
    desktopId: obj.desktopId,
    userId: obj.userId,
    deviceId: typeof obj.deviceId === "string" ? obj.deviceId : "",
    tier: typeof obj.tier === "string" ? obj.tier : "",
    label: typeof obj.label === "string" ? obj.label : "",
    deviceToken:
      typeof obj.deviceToken === "string" ? obj.deviceToken : undefined,
  };
}

export function App(): JSX.Element {
  const [paired, setPaired] = useState<PairedSession | null>(() =>
    loadStoredPairing()
  );
  const [phase, setPhase] = useState<Phase>(() =>
    loadStoredPairing() === null ? "unpaired" : "connecting"
  );

  const [client, setClient] = useState<RelayClient | null>(null);
  const [statusLabel, setStatusLabel] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  // Drives the home/detail split inside the `connected` branch.
  const [route, setRoute] = useState<ConnectedRoute>({ kind: "list" });

  // Track which backoff slot to use next; reset on successful connect.
  const attemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tearDownReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const startConnection = useCallback(
    (session: PairedSession) => {
      tearDownReconnectTimer();
      const next = new RelayClient({
        url: session.relayUrl,
        userId: session.userId,
        desktopId: session.desktopId,
      });

      const onChange = (event: Event): void => {
        const detail = (event as CustomEvent<ConnectionStatus>).detail;
        setStatusLabel(detail);
        if (detail === "connected") {
          attemptRef.current = 0;
          setErrorMessage("");
          setPhase("connected");
        } else if (detail === "closed" || detail === "error") {
          setPhase("connecting");
          const slot = Math.min(attemptRef.current, BACKOFF_MS.length - 1);
          const delay = BACKOFF_MS[slot];
          attemptRef.current += 1;
          tearDownReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            next.connect();
          }, delay);
        }
      };

      next.addEventListener("connectionchange", onChange);
      setClient(next);
      next.connect();

      return () => {
        next.removeEventListener("connectionchange", onChange);
        tearDownReconnectTimer();
        next.disconnect();
      };
    },
    [tearDownReconnectTimer]
  );

  useEffect(() => {
    if (phase === "unpaired" || paired === null) {
      return;
    }
    return startConnection(paired);
    // We deliberately key on phase + the paired identity (relay+desktop)
    // so a re-pair triggers reconnect without thrashing on transient
    // statusLabel re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paired?.relayUrl, paired?.desktopId, paired?.userId]);

  const onPaired = useCallback((session: PairedSession) => {
    localStorage.setItem(PAIRED_STORAGE_KEY, JSON.stringify(session));
    attemptRef.current = 0;
    setErrorMessage("");
    setPaired(session);
    setPhase("connecting");
  }, []);

  const onForgetClick = useCallback(() => {
    localStorage.removeItem(PAIRED_STORAGE_KEY);
    tearDownReconnectTimer();
    if (client !== null) {
      client.disconnect();
    }
    setClient(null);
    setPaired(null);
    setPhase("unpaired");
    setStatusLabel("idle");
    setErrorMessage("");
    // Drop any in-flight detail navigation so re-pairing lands on the
    // list view, never on a stale session id from a different desktop.
    setRoute({ kind: "list" });
  }, [client, tearDownReconnectTimer]);

  return (
    <div className="app">
      <h1>ORGII Mobile</h1>

      {phase === "unpaired" && (
        <PairingFlow
          userId={PLACEHOLDER_USER_ID}
          deviceLabel={DEFAULT_DEVICE_LABEL}
          onPaired={onPaired}
        />
      )}

      {phase === "connecting" && paired !== null && (
        <section>
          <p className="status">
            Connecting to {paired.relayUrl} as desktop{" "}
            <code>{paired.desktopId}</code>... ({statusLabel})
          </p>
          {errorMessage !== "" && <p className="error">{errorMessage}</p>}
          <button
            type="button"
            className="btn secondary"
            onClick={onForgetClick}
          >
            Forget pairing
          </button>
        </section>
      )}

      {phase === "connected" && paired !== null && client !== null && (
        <section>
          {route.kind === "list" && (
            <>
              <p className="status">
                Connected to <code>{paired.desktopId}</code> via{" "}
                {paired.relayUrl}.
              </p>
              <RemoteSessionList
                client={client}
                onSelectSession={(id) => setRoute({ kind: "detail", id })}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={onForgetClick}
              >
                Forget pairing
              </button>
            </>
          )}
          {route.kind === "detail" && (
            <SessionDetail
              client={client}
              sessionId={route.id}
              onBack={() => setRoute({ kind: "list" })}
            />
          )}
        </section>
      )}
    </div>
  );
}
