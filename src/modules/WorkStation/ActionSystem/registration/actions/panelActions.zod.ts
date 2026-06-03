/**
 * Panel Actions (Zod-based)
 *
 * Actions for showing/hiding panels.
 */
import { z } from "zod";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { PanelService } from "@src/services/panel";
import type {
  BottomPanelTab,
  PrimarySidebarTabKey,
} from "@src/store/ui/workStationAtom";

import { ACTION_ID } from "../../actionIds";
import { defineZodAction } from "../../schema/defineZodAction";

// Source Control is no longer a regular sidebar tab — it lives in the
// tab-specific Diff sidebar — so it's not exposed as a panel.show target.
const primarySidebarTabs = ["files", "search", "testing"] as const;

const bottomPanelTabs = [
  // Bottom-panel Terminal is intentionally hidden while the standalone Terminal tab is the single source of truth.
  // "terminal",
  "problems",
  "output",
  "test-results",
] as const;

export const panelShowPrimary = defineZodAction(
  {
    id: ACTION_ID.PANEL_SHOW_PRIMARY,
    category: "panel",
    description: "Show a specific primary sidebar tab",
    params: z.object({
      panel: z
        .enum(primarySidebarTabs)
        .describe("Panel to show (files, search, testing)"),
    }),
    examples: ["show files panel", "open testing panel"],
  },
  async ({ panel }) => {
    PanelService.showPrimarySidebar(panel as PrimarySidebarTabKey);
    return { success: true, message: `Showing ${panel} panel` };
  }
);

export const panelShowBottom = defineZodAction(
  {
    id: ACTION_ID.PANEL_SHOW_BOTTOM,
    category: "panel",
    description: "Show a specific bottom panel tab",
    params: z.object({
      panel: z
        .enum(bottomPanelTabs)
        .describe("Panel to show (problems, output, test-results)"),
    }),
    examples: ["open problems panel", "show output"],
  },
  async ({ panel }) => {
    PanelService.showBottomPanel(panel as BottomPanelTab);
    return { success: true, message: `Showing ${panel} panel` };
  }
);

export const panelTogglePrimary = defineZodAction(
  {
    id: ACTION_ID.PANEL_TOGGLE_PRIMARY,
    category: "panel",
    description: "Toggle the Workstation sidebar visibility",
    params: z.object({}),
    shortcut: getShortcutKeys("toggle_workstation_sidebar"),
    examples: [
      "toggle work station sidebar",
      "hide work station sidebar",
      "show work station sidebar",
    ],
  },
  async () => {
    PanelService.togglePrimarySidebar();
    return { success: true, message: "Toggled Workstation sidebar" };
  }
);

export const panelToggleBottom = defineZodAction(
  {
    id: ACTION_ID.PANEL_TOGGLE_BOTTOM,
    category: "panel",
    description: "Toggle the bottom panel visibility",
    params: z.object({}),
    shortcut: getShortcutKeys("toggle_bottom_panel"),
    examples: ["toggle bottom panel", "hide bottom panel"],
  },
  async () => {
    PanelService.toggleBottomPanel();
    return { success: true, message: "Toggled bottom panel" };
  }
);

export const panelZodActions = [
  panelShowPrimary,
  panelShowBottom,
  panelTogglePrimary,
  panelToggleBottom,
];
