/**
 * Workspace UI Atoms
 *
 * UI-related state for workspace pages.
 * Migrated from contexts/workspace/UIContext.tsx
 */
import { atom } from "jotai";

import type { ContextAddMap } from "@src/types/session/steps";

// ============================================
// Tab State
// ============================================

/** Selected center tab */
export const selectedTabAtom = atom<string>("1");
selectedTabAtom.debugLabel = "workspace/selectedTab";

/** Current planner view tab */
export const plannerViewTabAtom = atom<string>("1");
plannerViewTabAtom.debugLabel = "workspace/plannerViewTab";

// ============================================
// Menu State
// ============================================

/** Active view (left menu selection) */
export const activeViewAtom = atom<string>("simulator");
activeViewAtom.debugLabel = "workspace/activeView";

// ============================================
// Display State
// ============================================

/** Show diff panel */
export const diffShowAtom = atom<boolean>(false);
diffShowAtom.debugLabel = "workspace/diffShow";

/** Show final message */
export const showFinalMessageAtom = atom<boolean>(false);
showFinalMessageAtom.debugLabel = "workspace/showFinalMessage";

/** Overview panel active */
export const isOverviewActiveAtom = atom<boolean>(false);
isOverviewActiveAtom.debugLabel = "workspace/isOverviewActive";

// ============================================
// Loading State
// ============================================

/** Focus file page loading */
export const focusFileLoadingAtom = atom<boolean>(false);
focusFileLoadingAtom.debugLabel = "workspace/focusFileLoading";

/** Plan page loading */
export const planPageLoadingAtom = atom<boolean>(false);
planPageLoadingAtom.debugLabel = "workspace/planPageLoading";

/** Diff page loading */
export const diffPageLoadingAtom = atom<boolean>(false);
diffPageLoadingAtom.debugLabel = "workspace/diffPageLoading";

// ============================================
// Context Add Modal
// ============================================

/** Context add modal state */
export const contextAddMapAtom = atom<ContextAddMap>({
  init_tab: "add",
  follow_tab_add: "",
  follow_tab_load: "",
});
contextAddMapAtom.debugLabel = "workspace/contextAddMap";

// ============================================
// Mode State
// ============================================

// isPlannerLiteAtom is in sessionAtoms.ts (single source of truth)

/** Current approval type */
export const approvalTypeAtom = atom<string>("");
approvalTypeAtom.debugLabel = "workspace/approvalType";

// ============================================
// Other UI State
// ============================================

/** Should execute feature flag */
export const shouldExecuteFeatureAtom = atom<boolean>(false);
shouldExecuteFeatureAtom.debugLabel = "workspace/shouldExecuteFeature";

/** Is exploring */
export const isExploringAtom = atom<boolean>(false);
isExploringAtom.debugLabel = "workspace/isExploring";

/** Countdown minutes */
export const countDownMinAtom = atom<number>(-1);
countDownMinAtom.debugLabel = "workspace/countDownMin";
