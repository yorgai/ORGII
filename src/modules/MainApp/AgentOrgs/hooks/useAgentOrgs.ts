/**
 * useAgentOrgs — read-only hook to load agent organizations via Tauri invoke.
 *
 * Returns the list of OrgMember (top-level org definitions) for use in
 * assignee pickers and orchestrator config resolution.
 */
import { useCallback, useEffect, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import { useMounted } from "@src/hooks/lifecycle/useMounted";

import type { OrgMember } from "../types";

export function useAgentOrgs() {
  const [orgs, setOrgs] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useMounted();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rpc.agentOrgs.orgs.list();
      if (mountedRef.current) setOrgs(result);
    } catch (error) {
      console.error("[AgentOrgs] Failed to fetch:", error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [mountedRef]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const result = await rpc.agentOrgs.orgs.list();
        if (!cancelled) setOrgs(result);
      } catch (error) {
        console.error("[AgentOrgs] Failed to fetch:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { orgs, loading, refresh };
}
