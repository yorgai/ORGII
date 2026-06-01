/**
 * Integrations Toolbar Atoms
 *
 * Pub-sub channels used by the Integrations module to register toolbar
 * actions (refresh button, add-signal) into the GlobalToolbar.
 *
 * Lives in src/store/ui/ so that the scaffold layer (GlobalToolbar) can
 * read these without reaching into a module's private store path.
 */
import { atom } from "jotai";

import type { AddAction } from "@src/api/types/integrations";
import type { RouteToolbarButton } from "@src/store/ui/routeToolbarAtom";

// ─── Refresh / loading state ─────────────────────────────────────────────────

export interface IntegrationsToolbarEntry {
  onRefresh?: () => void;
  loading?: boolean;
  extraButtons?: RouteToolbarButton[];
}

export const integrationsToolbarAtom = atom<IntegrationsToolbarEntry>({});
integrationsToolbarAtom.debugLabel = "integrations/toolbar";

// ─── Add-action signal ───────────────────────────────────────────────────────

/**
 * Pub-sub channel used by GlobalToolbar to dispatch add-actions ("+" button)
 * into useIntegrationsPage. The monotonic `seq` counter ensures that identical
 * repeated actions still produce distinct atom values (avoids effect dedup).
 */
interface AddSignal {
  action: AddAction;
  seq: number;
}

let addSignalSeq = 0;

export const integrationsAddSignalAtom = atom<AddSignal | null>(null);

export const dispatchIntegrationsAddAtom = atom(
  null,
  (_get, set, action: AddAction) => {
    set(integrationsAddSignalAtom, { action, seq: ++addSignalSeq });
  }
);
