// Live session-detail screen for the mobile remote.
//
// Subscribes to a single desktop session via the relay's `subscribe`
// frame, renders incoming `Frame::Event` payloads as a scrolling stream,
// surfaces pending tool-call approvals as inline action cards, and
// posts follow-up user messages through `agent_send_message`.
//
// Why subscribe-only for history:
//
// The desktop's mobile-remote dispatch surface (see
// `src-tauri/src/api/mobile_remote/dispatch/mod.rs`) does NOT today
// expose a `session_messages` command — only `sessions_list`,
// `session_get`, `tool_call_approve`, `tool_call_deny`, and
// `agent_send_message`. There is no first-class way to fetch the
// existing message log over the wire, so the live event subscription is
// the authoritative source. We seed the view with whatever
// `session_get` exposes (title / status / agent kind) for header
// context only.
//
// Wire-format note:
//
// The relay forwards `Frame::Event { session_id, event: serde_json::Value }`
// frames opaquely; the embedded `event` payload is owned by the
// desktop's per-session broadcaster, not by this layer. We therefore
// treat every payload as `unknown` and narrow with type guards instead
// of inventing a static schema. Two payload "shapes" are handled:
//
//   1. Free-form messages — anything with a `role` + `content` pair.
//      Rendered as a chat-style row.
//   2. Tool-call permission requests — anything with a `type` discriminant
//      that mentions a tool call AND a `call_id` / `request_id` field.
//      Rendered as an Approve / Deny card. We accept the canonical
//      shape `{ type: "tool_call_pending", call_id, tool_name?, ... }`
//      AND the Tauri `permission:request` shape (which uses
//      `request_id`, `tool_name`, `tool_input`) since the dispatch
//      layer's `tauri_host.rs` documents that the on-wire `call_id`
//      MAY be the `request_id` echoed verbatim from the desktop's
//      permission manager.
//
// Anything we cannot classify is rendered as a raw JSON debug row so
// nothing is silently dropped — the alpha audience is one user who
// will tell us when an unexpected shape appears.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EventFrame, RelayClient } from "./api/relay";

interface Props {
  client: RelayClient;
  sessionId: string;
  onBack: () => void;
}

// Cap the in-memory event log so a chatty session does not balloon
// memory on a phone. 500 entries ~ a long agent run; older ones drop
// off the front. Match the order of magnitude used by the desktop's
// in-memory chat panel.
const MAX_STREAM_ENTRIES = 500;

// Header info pulled from `session_get`. Only fields we render are
// modelled — everything else stays `unknown`.
interface SessionHeader {
  sessionId: string;
  name: string | null;
  status: string | null;
  cliAgentType: string | null;
}

// Internal stream-entry sum type. `kind: "event"` is a generic event
// row; `kind: "tool_call"` is a card with Approve / Deny actions; the
// outcome state mutates in place when the user taps either.
type StreamEntry =
  | {
      kind: "event";
      id: string;
      role: string | null;
      content: string;
      raw: unknown;
    }
  | {
      kind: "tool_call";
      id: string;
      callId: string;
      toolName: string | null;
      summary: string;
      // `decision` mirrors the Approve / Deny button states; the local
      // optimistic transition is overwritten when the desktop emits a
      // follow-up event (e.g. `tool_call_resolved`) but we don't depend
      // on that today — the cards stay sticky in their last user-driven
      // state regardless.
      decision: "pending" | "approving" | "denying" | "approved" | "denied";
      decisionError: string | null;
      raw: unknown;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = obj[key];
    if (typeof candidate === "string" && candidate !== "") {
      return candidate;
    }
  }
  return null;
}

function isToolCallPayload(payload: Record<string, unknown>): boolean {
  // Accept either an explicit `type` discriminant OR the `permission:request`
  // shape that uses `request_id` + `tool_name`. The dispatch layer's
  // approve/deny commands key on whichever string the desktop emitted, so
  // we don't normalize here — we just detect.
  const type = readString(payload, "type", "kind", "event_type");
  if (type !== null) {
    const lowered = type.toLowerCase();
    if (
      lowered.includes("tool_call_pending") ||
      lowered === "tool_call" ||
      lowered.includes("permission_request") ||
      lowered === "permission:request"
    ) {
      return true;
    }
  }
  if (
    readString(payload, "call_id", "request_id") !== null &&
    readString(payload, "tool_name", "name") !== null
  ) {
    return true;
  }
  return false;
}

function summarizeToolCall(payload: Record<string, unknown>): string {
  const toolName = readString(payload, "tool_name", "name") ?? "unknown tool";
  // `tool_input` (Tauri permission:request) or `args` (canonical) — we
  // pretty-print the first ~120 chars for the card body. The full JSON
  // is still rendered in the debug `<pre>` below the buttons so the
  // user can see exactly what they're approving.
  const args = payload["tool_input"] ?? payload["args"] ?? null;
  if (args === null || args === undefined) {
    return toolName;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(args);
  } catch (_err) {
    serialized = String(args);
  }
  if (serialized.length > 120) {
    serialized = `${serialized.slice(0, 117)}...`;
  }
  return `${toolName}(${serialized})`;
}

function classifyEvent(frame: EventFrame, ordinal: number): StreamEntry {
  const id = `evt-${ordinal}`;
  if (!isObject(frame.event)) {
    return {
      kind: "event",
      id,
      role: null,
      content:
        typeof frame.event === "string"
          ? frame.event
          : JSON.stringify(frame.event),
      raw: frame.event,
    };
  }
  const payload = frame.event;
  if (isToolCallPayload(payload)) {
    const callId = readString(payload, "call_id", "request_id");
    if (callId !== null) {
      return {
        kind: "tool_call",
        id,
        callId,
        toolName: readString(payload, "tool_name", "name"),
        summary: summarizeToolCall(payload),
        decision: "pending",
        decisionError: null,
        raw: payload,
      };
    }
    // Tool-call-shaped without an id is useless for approval — fall
    // through and render as a generic event row so the user at least
    // sees something. We log to console once so the wire-shape drift
    // surfaces during alpha.
    console.warn("tool-call payload missing call_id/request_id", payload);
  }
  const role = readString(payload, "role", "from", "actor");
  const content =
    readString(payload, "content", "text", "message") ??
    JSON.stringify(payload);
  return {
    kind: "event",
    id,
    role,
    content,
    raw: payload,
  };
}

function isHeaderResponse(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}

function coerceHeader(value: unknown, fallbackId: string): SessionHeader {
  if (!isHeaderResponse(value)) {
    return {
      sessionId: fallbackId,
      name: null,
      status: null,
      cliAgentType: null,
    };
  }
  return {
    // The aggregate uses `sessionId` (camelCase per serde rename) but
    // older snapshots sometimes carry `id` — accept both.
    sessionId: readString(value, "sessionId", "session_id", "id") ?? fallbackId,
    name: readString(value, "name", "title", "displayLabel", "display_label"),
    status: readString(value, "status"),
    cliAgentType: readString(
      value,
      "cliAgentType",
      "cli_agent_type",
      "agent_kind"
    ),
  };
}

export function SessionDetail({
  client,
  sessionId,
  onBack,
}: Props): JSX.Element {
  const [header, setHeader] = useState<SessionHeader | null>(null);
  const [headerError, setHeaderError] = useState<string>("");
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string>("");

  // Monotonic counter for stream-entry ids. Refs (not state) because
  // updating it must not re-render and it is read inside the event
  // handler closure where reading state would be stale.
  const ordinalRef = useRef<number>(0);
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  // Header fetch. Cancellable so a fast-back navigation doesn't `setState`
  // on an unmounted component.
  useEffect(() => {
    let cancelled = false;
    setHeaderError("");
    setHeader(null);
    void (async () => {
      try {
        const data = await client.sendRpc<unknown>("session_get", {
          id: sessionId,
        });
        if (cancelled) {
          return;
        }
        setHeader(coerceHeader(data, sessionId));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setHeaderError(err instanceof Error ? err.message : String(err));
        setHeader({ sessionId, name: null, status: null, cliAgentType: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  // Live event subscription. `subscribe` is fire-and-forget; we stop
  // listening + send `unsubscribe` on unmount. `client` is stable for
  // a session so this effect runs once per (client, sessionId) pair.
  useEffect(() => {
    const onEvent = (raw: Event): void => {
      const detail = (raw as CustomEvent<EventFrame>).detail;
      if (detail.session_id !== sessionId) {
        return;
      }
      ordinalRef.current += 1;
      const entry = classifyEvent(detail, ordinalRef.current);
      setStream((prev) => {
        const next = prev.concat(entry);
        if (next.length > MAX_STREAM_ENTRIES) {
          return next.slice(next.length - MAX_STREAM_ENTRIES);
        }
        return next;
      });
    };
    client.addEventListener("event", onEvent);
    client.subscribe(sessionId);
    return () => {
      client.removeEventListener("event", onEvent);
      // Best-effort: if the WS is already closed `unsubscribe` is a no-op.
      client.unsubscribe(sessionId);
    };
  }, [client, sessionId]);

  // Auto-scroll on new entries. `scrollIntoView` is cheap and the spec
  // does not specify "follow only when the user is at bottom" behaviour
  // — alpha can scroll-jam, we'll add a sticky-mode toggle in v2 if it
  // becomes annoying.
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [stream]);

  const onSend = useCallback(async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    setSendError("");
    try {
      await client.sendRpc<unknown>("agent_send_message", {
        session_id: sessionId,
        content: trimmed,
      });
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [client, sessionId, draft, sending]);

  const onApprove = useCallback(
    async (entryId: string, callId: string): Promise<void> => {
      setStream((prev) =>
        prev.map((entry) =>
          entry.kind === "tool_call" && entry.id === entryId
            ? { ...entry, decision: "approving", decisionError: null }
            : entry
        )
      );
      try {
        await client.sendRpc<unknown>("tool_call_approve", {
          session_id: sessionId,
          call_id: callId,
        });
        setStream((prev) =>
          prev.map((entry) =>
            entry.kind === "tool_call" && entry.id === entryId
              ? { ...entry, decision: "approved", decisionError: null }
              : entry
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStream((prev) =>
          prev.map((entry) =>
            entry.kind === "tool_call" && entry.id === entryId
              ? { ...entry, decision: "pending", decisionError: message }
              : entry
          )
        );
      }
    },
    [client, sessionId]
  );

  const onDeny = useCallback(
    async (entryId: string, callId: string): Promise<void> => {
      setStream((prev) =>
        prev.map((entry) =>
          entry.kind === "tool_call" && entry.id === entryId
            ? { ...entry, decision: "denying", decisionError: null }
            : entry
        )
      );
      try {
        await client.sendRpc<unknown>("tool_call_deny", {
          session_id: sessionId,
          call_id: callId,
        });
        setStream((prev) =>
          prev.map((entry) =>
            entry.kind === "tool_call" && entry.id === entryId
              ? { ...entry, decision: "denied", decisionError: null }
              : entry
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStream((prev) =>
          prev.map((entry) =>
            entry.kind === "tool_call" && entry.id === entryId
              ? { ...entry, decision: "pending", decisionError: message }
              : entry
          )
        );
      }
    },
    [client, sessionId]
  );

  const headerLabel = useMemo(() => {
    if (header === null) {
      return sessionId;
    }
    return header.name ?? header.sessionId;
  }, [header, sessionId]);

  return (
    <section className="session-detail">
      <header className="session-detail-header">
        <button type="button" className="btn secondary" onClick={onBack}>
          Back
        </button>
        <div className="session-detail-title">
          <div className="title">{headerLabel}</div>
          <div className="meta">
            <span>{sessionId}</span>
            {header?.cliAgentType !== undefined &&
              header?.cliAgentType !== null && (
                <span> &middot; {header.cliAgentType}</span>
              )}
            {header?.status !== undefined && header?.status !== null && (
              <span> &middot; {header.status}</span>
            )}
          </div>
        </div>
      </header>

      {headerError !== "" && (
        <p className="error">Failed to load session header: {headerError}</p>
      )}

      <div className="stream">
        {stream.length === 0 && (
          <p className="status">
            Subscribed. Live messages will appear here as the agent emits them.
          </p>
        )}
        <ul className="stream-list">
          {stream.map((entry) => {
            if (entry.kind === "tool_call") {
              return (
                <li key={entry.id} className="stream-item tool-call">
                  <div className="tool-call-header">
                    <span className="badge">tool call</span>
                    <span className="tool-name">
                      {entry.toolName ?? "unknown tool"}
                    </span>
                  </div>
                  <div className="tool-call-summary">{entry.summary}</div>
                  <details>
                    <summary>raw payload</summary>
                    <pre>{JSON.stringify(entry.raw, null, 2)}</pre>
                  </details>
                  {entry.decisionError !== null && (
                    <p className="error">{entry.decisionError}</p>
                  )}
                  <div className="tool-call-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={entry.decision !== "pending"}
                      onClick={() => {
                        void onApprove(entry.id, entry.callId);
                      }}
                    >
                      {entry.decision === "approving"
                        ? "Approving..."
                        : entry.decision === "approved"
                          ? "Approved"
                          : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={entry.decision !== "pending"}
                      onClick={() => {
                        void onDeny(entry.id, entry.callId);
                      }}
                    >
                      {entry.decision === "denying"
                        ? "Denying..."
                        : entry.decision === "denied"
                          ? "Denied"
                          : "Deny"}
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li key={entry.id} className="stream-item event">
                {entry.role !== null && (
                  <div className="role">{entry.role}</div>
                )}
                <div className="content">{entry.content}</div>
              </li>
            );
          })}
        </ul>
        <div ref={streamEndRef} />
      </div>

      <footer className="session-detail-footer">
        {sendError !== "" && <p className="error">{sendError}</p>}
        <textarea
          className="composer"
          placeholder="Send a follow-up..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          disabled={sending}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            void onSend();
          }}
          disabled={sending || draft.trim() === ""}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </footer>
    </section>
  );
}
