/**
 * Sidebar Actions
 *
 * Control the global sidebar: toggle, collapse, expand, resize.
 *
 * Category: "sidebar"
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@src/store/ui/sidebarAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

// ============================================
// Actions
// ============================================

const sidebarToggle = defineZodAction(
  {
    id: ACTION_ID.SIDEBAR_TOGGLE,
    category: "sidebar",
    description: "Toggle the App Sidebar between collapsed and expanded",
    params: z.object({}),
    layer: "gui",
    examples: ["toggle app sidebar", "show/hide app sidebar"],
  },
  async () => {
    const store = getInstrumentedStore();
    const current = store.get(sidebarCollapsedAtom);
    store.set(sidebarCollapsedAtom, !current);
    return {
      success: true,
      message: current ? "Sidebar expanded" : "Sidebar collapsed",
    };
  }
);

const sidebarCollapse = defineZodAction(
  {
    id: ACTION_ID.SIDEBAR_COLLAPSE,
    category: "sidebar",
    description: "Collapse the sidebar",
    params: z.object({}),
    layer: "gui",
    examples: ["hide sidebar", "collapse sidebar"],
  },
  async () => {
    const store = getInstrumentedStore();
    store.set(sidebarCollapsedAtom, true);
    return { success: true, message: "Sidebar collapsed" };
  }
);

const sidebarExpand = defineZodAction(
  {
    id: ACTION_ID.SIDEBAR_EXPAND,
    category: "sidebar",
    description: "Expand the sidebar",
    params: z.object({}),
    layer: "gui",
    examples: ["show sidebar", "expand sidebar"],
  },
  async () => {
    const store = getInstrumentedStore();
    store.set(sidebarCollapsedAtom, false);
    return { success: true, message: "Sidebar expanded" };
  }
);

const sidebarResize = defineZodAction(
  {
    id: ACTION_ID.SIDEBAR_RESIZE,
    category: "sidebar",
    description: "Set the sidebar width in pixels",
    params: z.object({
      width: z
        .number()
        .min(180)
        .max(600)
        .describe("Sidebar width in pixels (180-600)"),
    }),
    layer: "gui",
  },
  async ({ width }) => {
    const store = getInstrumentedStore();
    store.set(sidebarWidthAtom, width);
    // Also make sure sidebar is expanded
    store.set(sidebarCollapsedAtom, false);
    return { success: true, message: `Sidebar width set to ${width}px` };
  }
);

// ============================================
// Export
// ============================================

export const sidebarZodActions = [
  sidebarToggle,
  sidebarCollapse,
  sidebarExpand,
  sidebarResize,
];

export const sidebarActionRegistration =
  defineAppActionRegistration(sidebarZodActions);
