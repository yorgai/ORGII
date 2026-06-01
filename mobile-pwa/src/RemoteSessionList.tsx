import { useCallback, useEffect, useState } from "react";

import type { RelayClient } from "./api/relay";

// Schema mirrors what the desktop's `TauriDispatchHost::sessions_list`
// returns. Keep it intentionally narrow — this is a spike, not a
// production view layer. Add fields only as the UI needs them.
interface SessionListItem {
  id: string;
  title: string | null;
  agent_kind: string | null;
  last_activity_ms: number | null;
}

interface SessionsListResponse {
  sessions: SessionListItem[];
}

interface Props {
  client: RelayClient;
  // T4 will wire navigation; the prop is the seam between T2/T3 and T4.
  onSelectSession?: (id: string) => void;
}

function isSessionsListResponse(value: unknown): value is SessionsListResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { sessions?: unknown };
  return Array.isArray(candidate.sessions);
}

function coerceItem(raw: unknown): SessionListItem | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string") {
    return null;
  }
  return {
    id: obj.id,
    title: typeof obj.title === "string" ? obj.title : null,
    agent_kind: typeof obj.agent_kind === "string" ? obj.agent_kind : null,
    last_activity_ms:
      typeof obj.last_activity_ms === "number" ? obj.last_activity_ms : null,
  };
}

export function RemoteSessionList({
  client,
  onSelectSession,
}: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await client.invoke("sessions_list", {});
      if (!isSessionsListResponse(data)) {
        setSessions([]);
        setErrorMessage("Unexpected response shape from sessions_list.");
        return;
      }
      const items: SessionListItem[] = [];
      for (const raw of data.sessions) {
        const item = coerceItem(raw);
        if (item !== null) {
          items.push(item);
        }
      }
      setSessions(items);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return (
    <div>
      <h2>Sessions</h2>
      <button
        type="button"
        className="btn"
        onClick={refresh}
        disabled={loading}
      >
        {loading ? "Refreshing..." : "Refresh"}
      </button>
      {errorMessage !== "" && <p className="error">{errorMessage}</p>}
      {sessions.length === 0 && !loading && errorMessage === "" && (
        <p className="status">No sessions yet.</p>
      )}
      <ul className="list">
        {sessions.map((session) => (
          <li key={session.id}>
            {onSelectSession !== undefined ? (
              <button
                type="button"
                className="title"
                onClick={() => onSelectSession(session.id)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  font: "inherit",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {session.title ?? session.id}
              </button>
            ) : (
              <div className="title">{session.title ?? session.id}</div>
            )}
            <div className="meta">
              <span>{session.id}</span>
              {session.agent_kind !== null && (
                <span> &middot; {session.agent_kind}</span>
              )}
              {session.last_activity_ms !== null && (
                <span>
                  {" "}
                  &middot; {new Date(session.last_activity_ms).toLocaleString()}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
