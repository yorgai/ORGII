/**
 * useWizardParam
 *
 * Reads + writes the `?wizard=<id>&id=<entityId>` URL params that all
 * "Add / Create" wizards in the app use as their open-state. Hosts
 * should consult this hook instead of holding their own `useState`
 * boolean — the URL is the single source of truth so deep-links,
 * refresh, and the back button all behave correctly, and Spotlight
 * can navigate straight to a wizard without a side-channel.
 *
 *   const { wizard, entityId, openWizard, closeWizard } =
 *     useWizardParam();
 *
 *   if (wizard === WIZARD_IDS.MCP_ADD) {
 *     return <McpAddWizard ... />;
 *   }
 *
 *   <Button onClick={() => openWizard(WIZARD_IDS.MCP_ADD)}>+ MCP</Button>
 */
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  type WizardId,
  buildWizardPath,
  parseWizardParam,
  stripWizardParams,
} from "@src/config/mainAppPaths";

export interface UseWizardParamReturn {
  /** Currently open wizard id, or `null`. */
  wizard: WizardId | null;
  /** Entity id (for edit-style wizards) or `null`. */
  entityId: string | null;
  /**
   * Open `wizard` on top of the current pathname. Pass `entityId`
   * for edit-mode wizards. Other query params on the current URL
   * are preserved.
   */
  openWizard: (wizard: WizardId, entityId?: string) => void;
  /**
   * Close any open wizard by stripping the `wizard` / `id` params
   * from the current URL. Other query params are preserved.
   */
  closeWizard: () => void;
}

export function useWizardParam(): UseWizardParamReturn {
  const location = useLocation();
  const navigate = useNavigate();

  const { wizard, id } = useMemo(
    () => parseWizardParam(location.search),
    [location.search]
  );

  const openWizard = useCallback(
    (next: WizardId, entityId?: string) => {
      const base = location.pathname + stripWizardParams(location.search);
      navigate(buildWizardPath(base, next, entityId), { replace: false });
    },
    [navigate, location.pathname, location.search]
  );

  const closeWizard = useCallback(() => {
    const search = stripWizardParams(location.search);
    navigate({ pathname: location.pathname, search }, { replace: false });
  }, [navigate, location.pathname, location.search]);

  return { wizard, entityId: id, openWizard, closeWizard };
}
