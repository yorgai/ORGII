/**
 * AgentOrgs active-tab atom.
 *
 * The detail panel (BuiltInAgentDetailView, CustomAgentDetailView,
 * CliAgentDetailView) renders one tab at a time (General / Models /
 * Rules / Skills / MCP / ...). The active tab key was previously a
 * local `useState` inside each detail view, which made it inaccessible
 * to:
 *
 *   1. Sibling components (e.g. the future Edit/View mode toggle in
 *      the agent detail header that needs to remember which tab the
 *      user was on when toggling modes).
 *   2. E2E tests that need to programmatically navigate the user into
 *      a specific tab without driving real sidebar clicks (which are
 *      brittle to list ordering and async loading).
 *
 * Lifting it into a Jotai atom solves both. Default value mirrors the
 * old `useState("general")` so behaviour for the most common path
 * (built-in OS / SDE / Wingman) is unchanged.
 */
import { atom } from "jotai";

export const agentOrgsActiveTabAtom = atom<string>("general");

agentOrgsActiveTabAtom.debugLabel = "agentOrgsActiveTabAtom";
