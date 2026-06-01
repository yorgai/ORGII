/**
 * Sub-agent visibility rule.
 *
 * An agent is a valid sub-agent candidate when:
 *   - delegationConfig.delegatable !== false  (background workers like
 *     `builtin:memory-extractor` opt out explicitly. The runtime's
 *     `agent` tool schema honors this flag.)
 *
 * Tier is **not** filtered here. Primary-tier agents (OS / SDE /
 * Wingman) are session-root personas, but they can still be invoked
 * as sub-agents by another parent — `builtin:os.sub_agents` ships with
 * `builtin:sde` in its allowlist by default, and the runtime's
 * `agent::execute()` does not check tier. Filtering Primary in the
 * picker would prevent users from configuring legitimate
 * "specialist-as-sub-agent" graphs (e.g. adding SDE as a sub-agent of
 * a custom orchestrator).
 *
 * Built-in delegation primitives (`builtin:explore`, `builtin:general`)
 * are always reachable from every parent regardless of the parent's
 * `subAgents` list, so they are filtered upstream by `useAgentDefinitions`
 * (`INTERNAL_AGENT_IDS`) and never reach this predicate. Custom
 * (user-created) agents default to `delegatable = true`, so they pass
 * the filter unless the author opts out.
 *
 * Self-exclusion + cycle detection live in `SubAgentsEditor` itself —
 * those rules need the `currentAgentId` and the full sub-agent graph,
 * which this pure predicate does not have.
 */
import type { AgentDefinition } from "../types";

export function isSubAgentCandidate(agent: AgentDefinition): boolean {
  if (agent.delegationConfig?.delegatable === false) return false;
  return true;
}

/**
 * Dedupe a list of agents by `id`, preserving first-write-wins order.
 * The two atoms (`builtInAgentsAtom`, `customAgentsAtom`) are
 * disjoint by construction, but defensive dedup keeps the picker
 * robust against future refactors that merge the lists upstream.
 */
export function dedupeAgentsById(agents: AgentDefinition[]): AgentDefinition[] {
  const seen = new Set<string>();
  const out: AgentDefinition[] = [];
  for (const agent of agents) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}
