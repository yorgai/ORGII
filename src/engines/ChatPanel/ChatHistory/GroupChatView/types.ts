/**
 * GroupChatView types.
 *
 * `GroupChatAgent` is the only shared shape this iteration uses — the
 * view itself (see `./index.tsx`) flattens every agent's event stream
 * into a single chronological bubble feed, so per-round / per-bucket
 * structures are unnecessary.
 */
import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";

export interface GroupChatAgent {
  /** Stable id — `memberId` for org members, `"coordinator"` for the root. */
  id: string;
  /** Display name; coordinator gets the verbatim "Coordinator" label. */
  name: string;
  /** Member session id (or coordinator session id) — keys event lookups. */
  sessionId: string;
  /** Underlying org-run row (null for the coordinator entry). */
  member: AgentOrgRunMemberView | null;
  /** True when this is the coordinator entry. */
  isCoordinator: boolean;
}
