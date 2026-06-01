import { buildAgentOrgsPath } from "@src/config/mainAppPaths";
import { agentOrgsActiveTabAtom } from "@src/modules/MainApp/AgentOrgs/store/agentOrgsActiveTabAtom";
import { router } from "@src/router";
import type { AgentConfigTabVariant } from "@src/store/workstation/tabs";
import { getRustAgentType } from "@src/util/session/sessionDispatch";
import { openAgentConfigInWorkStation } from "@src/util/ui/openAgentConfigInWorkStation";

import { asError } from "../result";
import type { E2EStore, Err } from "../types";

export function createNavigationHelpers(store: E2EStore) {
  const navigateTo = async (path: string): Promise<{ ok: true } | Err> => {
    try {
      await router.navigate(path);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const getLocationPathname = (): string => window.location.pathname;

  const openAgentTab = async (
    agentId: string,
    tab: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await router.navigate(buildAgentOrgsPath({ tab: "agents" }));
      const rustAgentType = getRustAgentType(agentId);
      const variant: AgentConfigTabVariant =
        rustAgentType === "os"
          ? "builtin-os"
          : rustAgentType === "sde"
            ? "builtin-sde"
            : rustAgentType === "wingman"
              ? "wingman"
              : "custom";
      openAgentConfigInWorkStation({
        variant,
        entityId: agentId,
        displayName: agentId,
      });
      store.set(agentOrgsActiveTabAtom, tab);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    navigateTo,
    getLocationPathname,
    openAgentTab,
  };
}
