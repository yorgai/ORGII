// Thin WebSocket shim that mirrors the Rust `orgii_protocol::Frame`
// envelope and exposes a request/response `invoke()` API for the React
// shell. All wire types here MUST stay in sync with
// `src-tauri/crates/orgii-protocol/src/frames.rs` and `version.rs`.
//
// IMPORTANT: this module is browser-only. Do not import any
// `@tauri-apps/api` symbol; the PWA runs in a phone's browser, not in
// a Tauri webview. (The desktop app's `orgii-frontend` Tauri-only rule
// does NOT apply here.)

// ---------------------------------------------------------------------------
// Wire types — discriminated union mirroring `Frame` in frames.rs
// (`#[serde(tag = "kind", rename_all = "snake_case")]`).
// ---------------------------------------------------------------------------

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export type PeerRole = "desktop" | "mobile";

/**
 * First frame on every WebSocket. Folded into the `Frame` union as
 * a regular `kind: "handshake"` variant so the same JSON.parse +
 * dispatch path handles every inbound message — see
 * `src-tauri/crates/orgii-protocol/src/frames.rs`.
 */
export interface HandshakeFrame {
  kind: "handshake";
  version: ProtocolVersion;
  role: PeerRole;
  agent: string;
}

export interface RpcCallFrame {
  kind: "rpc_call";
  id: string;
  target_desktop_id: string;
  command: string;
  args: unknown;
}

// `RpcResult` is itself a Rust enum tagged by `outcome` ("ok" | "err"),
// nested inside the outer `kind: "rpc_result"` envelope.
export type RpcResultFrame =
  | { kind: "rpc_result"; outcome: "ok"; id: string; data: unknown }
  | { kind: "rpc_result"; outcome: "err"; id: string; error: string };

export interface SubscriptionPayload {
  desktop_ids: string[];
  session_filter: string | null;
}

export interface SubscribeFrame {
  kind: "subscribe";
  desktop_ids: string[];
  session_filter: string | null;
}

export interface UnsubscribeFrame {
  kind: "unsubscribe";
  desktop_ids: string[];
  session_filter: string | null;
}

export interface EventFrame {
  kind: "event";
  source_desktop_id: string;
  session_id: string;
  event: unknown;
}

export type DesktopStatusKind = "online" | "offline" | "unpaired";

export interface DesktopStatusFrame {
  kind: "desktop_status";
  desktop_id: string;
  status: DesktopStatusKind;
}

export interface PingFrame {
  kind: "ping";
}

export interface PongFrame {
  kind: "pong";
}

export type Frame =
  | HandshakeFrame
  | RpcCallFrame
  | RpcResultFrame
  | SubscribeFrame
  | UnsubscribeFrame
  | EventFrame
  | DesktopStatusFrame
  | PingFrame
  | PongFrame;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export interface RelayClientConfig {
  url: string;
  userId: string;
  desktopId: string;
}

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const PROTOCOL_VERSION: ProtocolVersion = { major: 0, minor: 1 };
const AGENT_STRING = "orgii-pwa/0.1";
const RPC_TIMEOUT_MS = 30_000;

export class RelayClient extends EventTarget {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private readonly pending = new Map<string, PendingCall>();

  constructor(private readonly config: RelayClientConfig) {
    super();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.ws !== null) {
      return;
    }
    this.setStatus("connecting");

    // The relay's per-peer auth is conveyed via headers on the WS
    // upgrade in the Rust desktop client. Browsers cannot set custom
    // headers on `new WebSocket(...)`, so we surface the same values
    // as URL query parameters. The relay-side mobile handler must
    // accept either; coordinate with relay agent before merging.
    const url = this.buildUrl();

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      const handshake: HandshakeFrame = {
        kind: "handshake",
        version: PROTOCOL_VERSION,
        role: "mobile",
        agent: AGENT_STRING,
      };
      ws.send(JSON.stringify(handshake));
      this.setStatus("connected");
    };

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onerror = () => {
      this.setStatus("error");
    };

    ws.onclose = () => {
      this.cleanup();
      this.setStatus("closed");
    };
  }

  disconnect(): void {
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch (_err) {
        // Swallowing here is fine; close() can throw on already-closing
        // sockets in some browsers. The onclose handler will run anyway.
      }
    }
    this.cleanup();
    this.setStatus("closed");
  }

  /**
   * Generic-typed convenience wrapper around {@link invoke}. Lets callers
   * narrow the resolved value at the call site without re-casting through
   * a `unknown` intermediate. The underlying frame correlation, timeout,
   * and pending-map cleanup all live in `invoke` — this is purely a
   * type-level convenience.
   *
   * Callers MUST pass an `unknown`-narrowing type guard at the consumer
   * site rather than trusting `T` blindly: the wire payload is decoded
   * by the desktop and we have no compile-time guarantee its shape
   * matches `T`.
   */
  sendRpc<T>(command: string, args: unknown): Promise<T> {
    return this.invoke(command, args) as Promise<T>;
  }

  /**
   * Tell the relay we want to receive `Frame::Event` payloads for the
   * given session. The relay's mobile WS handler accepts the frame and
   * does not ack (`Frame::Subscribe` is logged at debug level on the
   * server) so this is fire-and-forget — there is no Promise to await.
   *
   * Implementation note: the on-wire `Subscription` payload addresses
   * **desktops**, not sessions, plus an optional `session_filter`
   * substring. We pass the bound `desktopId` as the only target and use
   * the session id verbatim as the filter so the desktop only forwards
   * events for that one session. When `subscribe` is invoked before the
   * WS reaches the connected state the frame is silently dropped — same
   * contract as `send`'s readyState gate — so the caller should re-issue
   * the subscribe on every fresh `connectionchange === "connected"`.
   */
  subscribe(sessionId: string): void {
    const frame: SubscribeFrame = {
      kind: "subscribe",
      desktop_ids: [this.config.desktopId],
      session_filter: sessionId,
    };
    this.send(frame);
  }

  /**
   * Mirror of {@link subscribe}: tell the relay to stop forwarding
   * events for the given session. Also fire-and-forget.
   */
  unsubscribe(sessionId: string): void {
    const frame: UnsubscribeFrame = {
      kind: "unsubscribe",
      desktop_ids: [this.config.desktopId],
      session_filter: sessionId,
    };
    this.send(frame);
  }

  invoke(command: string, args: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws === null || this.status !== "connected") {
        reject(new Error("relay client not connected"));
        return;
      }
      const id = crypto.randomUUID();
      const frame: RpcCallFrame = {
        kind: "rpc_call",
        id,
        target_desktop_id: this.config.desktopId,
        command,
        args,
      };
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout after ${RPC_TIMEOUT_MS}ms: ${command}`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeoutId });

      try {
        this.ws.send(JSON.stringify(frame));
      } catch (sendErr) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
      }
    });
  }

  private buildUrl(): string {
    // Strip any trailing slash from the configured base URL.
    const base = this.config.url.replace(/\/+$/, "");
    const params = new URLSearchParams({
      user_id: this.config.userId,
      desktop_id: this.config.desktopId,
    });
    return `${base}/mobile/connect?${params.toString()}`;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      // Binary frames are not part of the protocol today.
      return;
    }
    let parsed: Frame;
    try {
      parsed = JSON.parse(raw) as Frame;
    } catch (_err) {
      return;
    }
    switch (parsed.kind) {
      case "handshake":
        // The relay's reply handshake. Logged for visibility; phase
        // 5 has nothing to negotiate beyond version-major
        // compatibility, which the relay enforces server-side.
        return;
      case "rpc_result":
        this.resolvePending(parsed);
        return;
      case "ping":
        this.send({ kind: "pong" });
        return;
      case "pong":
        return;
      case "event":
        // Re-emit as a DOM CustomEvent so per-session views (e.g.
        // `SessionDetail`) can subscribe via `addEventListener("event", ...)`
        // without touching this client's internal state. Per-listener
        // filtering by `session_id` happens in the consumer.
        this.dispatchEvent(
          new CustomEvent<EventFrame>("event", { detail: parsed })
        );
        return;
      case "desktop_status":
        // Re-emit so the shell can react to a paired desktop going
        // online / offline / unpaired without polling.
        this.dispatchEvent(
          new CustomEvent<DesktopStatusFrame>("desktopstatus", {
            detail: parsed,
          })
        );
        return;
      case "rpc_call":
      case "subscribe":
      case "unsubscribe":
        // These are mobile-to-relay only; ignore if echoed back.
        return;
    }
  }

  private resolvePending(frame: RpcResultFrame): void {
    const entry = this.pending.get(frame.id);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timeoutId);
    this.pending.delete(frame.id);
    if (frame.outcome === "ok") {
      entry.resolve(frame.data);
    } else {
      entry.reject(new Error(frame.error));
    }
  }

  private send(frame: Frame): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(frame));
  }

  private cleanup(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error("connection closed"));
    }
    this.pending.clear();
    this.ws = null;
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.dispatchEvent(new CustomEvent("connectionchange", { detail: next }));
  }
}

// ===== Pairing HTTP =====
//
// Thin wrappers over the relay's /pair/claim and /pair/confirm
// endpoints. Wire shapes mirror `orgii_protocol::pairing` exactly:
// the structs there carry `#[serde(rename_all = "snake_case")]` but
// since their fields are already snake_case in Rust, the wire keys
// are the same Rust field names (`pairing_code`, `device_label`,
// `device_pubkey_fingerprint`, `confirming_side`, `tier`, etc.).
//
// Auth: both endpoints require an `X-User-Id` header (Phase 2
// temporary auth — see relay's handlers/pairing.rs). The PWA's
// caller passes the same placeholder user id the desktop uses
// today; once Plan C T6 lands the call sites will switch over.
//
// T4 will add WS frame helpers near the top of this file. Keep new
// HTTP helpers below this banner so the diffs do not collide.

/** Permission tier the relay echoes back from /pair/claim. The Rust
 * enum `PermissionTier` serializes as snake_case strings. We keep the
 * type open as `string` because the PWA does not branch on the value
 * yet — it just persists whatever the relay returned. */
export type PermissionTier = string;

/** Confirming side, must match the Rust `ConfirmingSide` enum.
 * Serialized as snake_case ("desktop" | "mobile"). */
export type ConfirmingSide = "desktop" | "mobile";

/** Body of POST /pair/claim. The mobile picks a human label for
 * itself and submits a public-key fingerprint. The PWA does not
 * currently own a real keypair, so the fingerprint is a placeholder
 * (an empty string is accepted by the relay; it stores it verbatim).
 * Once the PWA has WebCrypto-backed identity, callers should pass
 * the real fingerprint here without changing the wire shape. */
export interface PairClaimRequest {
  pairing_code: string;
  device_label: string;
  device_pubkey_fingerprint: string;
}

/** Response from POST /pair/claim — see PairingClaimResponse in
 * src-tauri/crates/orgii-protocol/src/pairing.rs. */
export interface PairClaimResponse {
  desktop_id: string;
  user_id: string;
  device_id: string;
  tier: PermissionTier;
  label: string;
  confirmation_phrase: string;
}

/** Body of POST /pair/confirm. The mobile's `tier` field is
 * intentionally ignored by the relay (the desktop owns the
 * permission decision); we still send it because the request shape
 * requires the field. We pass through whatever /pair/claim echoed
 * back so the value stays consistent if the relay ever starts
 * cross-checking. */
export interface PairConfirmRequest {
  pairing_code: string;
  confirming_side: ConfirmingSide;
  tier: PermissionTier;
}

/** Response from POST /pair/confirm. `device_id` is added by Plan C
 * T1 (extending PairingConfirmResponse with `device_id:
 * Option<DeviceId>`). It is declared optional so the PWA compiles
 * regardless of T1's landing order; once T1 ships the relay will
 * populate it on the terminal `paired` arm and the PWA will persist
 * it to localStorage. */
export interface PairConfirmResponse {
  status: "paired" | "awaiting_other_side";
  device_id?: string;
}

const PAIRING_HEADER_USER_ID = "X-User-Id";

function trimRelayBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function postJson(
  url: string,
  userId: string,
  body: unknown
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [PAIRING_HEADER_USER_ID]: userId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = extractRelayErrorMessage(text) || response.statusText;
    throw new Error(`relay ${response.status} ${response.url}: ${message}`);
  }
  return response.json();
}

function extractRelayErrorMessage(body: string): string {
  if (body === "") {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Not JSON; fall through to raw body.
  }
  return body;
}

function asPairClaimResponse(value: unknown): PairClaimResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("pair/claim: expected JSON object");
  }
  const obj = value as Record<string, unknown>;
  const required = [
    "desktop_id",
    "user_id",
    "device_id",
    "tier",
    "label",
    "confirmation_phrase",
  ] as const;
  for (const key of required) {
    if (typeof obj[key] !== "string") {
      throw new Error(`pair/claim: missing string field "${key}"`);
    }
  }
  return {
    desktop_id: obj.desktop_id as string,
    user_id: obj.user_id as string,
    device_id: obj.device_id as string,
    tier: obj.tier as string,
    label: obj.label as string,
    confirmation_phrase: obj.confirmation_phrase as string,
  };
}

function asPairConfirmResponse(value: unknown): PairConfirmResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("pair/confirm: expected JSON object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.status !== "string") {
    throw new Error('pair/confirm: missing string field "status"');
  }
  if (obj.status !== "paired" && obj.status !== "awaiting_other_side") {
    throw new Error(`pair/confirm: unknown status "${obj.status}"`);
  }
  // device_id is optional today (Plan C T1). Accept it when present
  // and string-typed; ignore otherwise.
  const deviceId =
    typeof obj.device_id === "string" ? obj.device_id : undefined;
  return {
    status: obj.status,
    device_id: deviceId,
  };
}

/** POST /pair/claim. Redeems the pairing code and returns the SAS
 * confirmation phrase for the user to compare against the desktop.
 *
 * The relay accepts http(s) URLs only; if `relayUrl` is given as a
 * `wss://...` (because that's what the desktop also encodes for the
 * WS leg), we rewrite it to `https://`. The desktop's QR payload
 * always carries the WS form. */
export async function pairClaim(
  relayUrl: string,
  userId: string,
  request: PairClaimRequest
): Promise<PairClaimResponse> {
  const base = httpBaseFromRelayUrl(trimRelayBase(relayUrl));
  const data = await postJson(`${base}/pair/claim`, userId, request);
  return asPairClaimResponse(data);
}

/** POST /pair/confirm. Marks the mobile side as confirmed. When both
 * sides have called this endpoint, the relay finalises the pairing
 * and `status === "paired"`. Otherwise `status === "awaiting_other_side"`. */
export async function pairConfirm(
  relayUrl: string,
  userId: string,
  request: PairConfirmRequest
): Promise<PairConfirmResponse> {
  const base = httpBaseFromRelayUrl(trimRelayBase(relayUrl));
  const data = await postJson(`${base}/pair/confirm`, userId, request);
  return asPairConfirmResponse(data);
}

/** Convert `ws(s)://host/...` → `http(s)://host/...` for HTTP calls,
 * leaving `http(s)://...` untouched. The desktop encodes its relay
 * base as a WS URL in the QR; the pairing endpoints are HTTP. */
function httpBaseFromRelayUrl(url: string): string {
  if (url.startsWith("wss://")) {
    return `https://${url.slice("wss://".length)}`;
  }
  if (url.startsWith("ws://")) {
    return `http://${url.slice("ws://".length)}`;
  }
  return url;
}
