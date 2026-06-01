/**
 * Layout Atom - Jotai State Management for IDE Layout
 *
 * Centralized state for all resizable panel sizes.
 * Uses localStorage persistence to remember user preferences.
 *
 * Key principles:
 * - Only update state on resize END (not during)
 * - All layout state in one place
 * - Persist to localStorage for user preference
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { LayoutState, PanelSizes, SplitSizes } from "../types";

// ============================================
// Default Values
// ============================================

export const DEFAULT_PANEL_SIZES: PanelSizes = {
  leftPanel: 280,
  rightPanel: 360,
  bottomPanel: 200,
};

export const DEFAULT_SPLIT_SIZES: SplitSizes = {
  editorSplit: 50, // percentage
  simulatorSplit: 50,
};

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  panels: DEFAULT_PANEL_SIZES,
  splits: DEFAULT_SPLIT_SIZES,
};

// ============================================
// Main Layout Atom (with persistence)
// ============================================

/**
 * Main layout state atom with localStorage persistence
 */
export const layoutAtom = atomWithStorage<LayoutState>(
  "ide-layout-v1",
  DEFAULT_LAYOUT_STATE
);

// ============================================
// Derived Atoms (for specific panels)
// ============================================

/**
 * Left panel width atom
 */
export const leftPanelWidthAtom = atom(
  (get) => get(layoutAtom).panels.leftPanel,
  (get, set, newWidth: number) => {
    const current = get(layoutAtom);
    set(layoutAtom, {
      ...current,
      panels: { ...current.panels, leftPanel: newWidth },
    });
  }
);

/**
 * Right panel width atom
 */
export const rightPanelWidthAtom = atom(
  (get) => get(layoutAtom).panels.rightPanel,
  (get, set, newWidth: number) => {
    const current = get(layoutAtom);
    set(layoutAtom, {
      ...current,
      panels: { ...current.panels, rightPanel: newWidth },
    });
  }
);

/**
 * Bottom panel height atom
 */
export const bottomPanelHeightAtom = atom(
  (get) => get(layoutAtom).panels.bottomPanel,
  (get, set, newHeight: number) => {
    const current = get(layoutAtom);
    set(layoutAtom, {
      ...current,
      panels: { ...current.panels, bottomPanel: newHeight },
    });
  }
);

// ============================================
// Split Atoms
// ============================================

/**
 * Generic split position atom factory
 */
export function createSplitAtom(key: string, defaultValue: number = 50) {
  return atom(
    (get) => get(layoutAtom).splits[key] ?? defaultValue,
    (get, set, newPosition: number) => {
      const current = get(layoutAtom);
      set(layoutAtom, {
        ...current,
        splits: { ...current.splits, [key]: newPosition },
      });
    }
  );
}

/**
 * Editor split position atom
 */
export const editorSplitAtom = createSplitAtom("editorSplit", 50);

/**
 * Simulator split position atom
 */
export const simulatorSplitAtom = createSplitAtom("simulatorSplit", 50);

// ============================================
// Utility Atoms
// ============================================

/**
 * Reset layout to defaults
 */
export const resetLayoutAtom = atom(null, (_get, set) => {
  set(layoutAtom, DEFAULT_LAYOUT_STATE);
});

/**
 * Panel visibility atoms (for collapse/expand)
 */
export interface PanelVisibility {
  leftPanel: boolean;
  rightPanel: boolean;
  bottomPanel: boolean;
}

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  leftPanel: true,
  rightPanel: true,
  bottomPanel: false,
};

export const panelVisibilityAtom = atomWithStorage<PanelVisibility>(
  "ide-panel-visibility-v1",
  DEFAULT_PANEL_VISIBILITY
);

/**
 * Toggle panel visibility
 */
export const toggleLeftPanelAtom = atom(null, (get, set) => {
  const current = get(panelVisibilityAtom);
  set(panelVisibilityAtom, { ...current, leftPanel: !current.leftPanel });
});

export const toggleRightPanelAtom = atom(null, (get, set) => {
  const current = get(panelVisibilityAtom);
  set(panelVisibilityAtom, { ...current, rightPanel: !current.rightPanel });
});

export const toggleBottomPanelAtom = atom(null, (get, set) => {
  const current = get(panelVisibilityAtom);
  set(panelVisibilityAtom, { ...current, bottomPanel: !current.bottomPanel });
});

// ============================================
// Panel Size Constraints
// ============================================

export const PANEL_CONSTRAINTS = {
  leftPanel: { min: 200, max: 500 },
  rightPanel: { min: 250, max: 600 },
  bottomPanel: { min: 100, max: 500 },
} as const;

export type PanelId = keyof typeof PANEL_CONSTRAINTS;

/**
 * Get panel constraints
 */
export function getPanelConstraints(panelId: PanelId) {
  return PANEL_CONSTRAINTS[panelId];
}
