/**
 * useWorkspaceUI Hook
 *
 * Full workspace UI state hook — replaces useUIContext.
 * Prefer fine-grained selector hooks (useCenterTab, usePageLoading,
 * useActiveView) for components that only need a subset of state.
 *
 * Usage:
 * ```tsx
 * import { useWorkspaceUI } from "@src/engines/SessionCore";
 * const { selectedTab, setSelectedTab, diffShow } = useWorkspaceUI();
 * ```
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";

import { isPlannerLiteAtom } from "../atoms/sessionAtoms";
import {
  activeViewAtom,
  approvalTypeAtom,
  contextAddMapAtom,
  countDownMinAtom,
  diffPageLoadingAtom,
  diffShowAtom,
  focusFileLoadingAtom,
  isExploringAtom,
  isOverviewActiveAtom,
  planPageLoadingAtom,
  plannerViewTabAtom,
  selectedTabAtom,
  shouldExecuteFeatureAtom,
  showFinalMessageAtom,
} from "../atoms/uiAtoms";

/**
 * Full workspace UI state hook
 * Replaces useUIContext
 */
export function useWorkspaceUI() {
  const [selectedTab, setSelectedTab] = useAtom(selectedTabAtom);
  const [plannerViewTab, setPlannerViewTab] = useAtom(plannerViewTabAtom);
  const [activeView, setActiveView] = useAtom(activeViewAtom);
  const [diffShow, setDiffShow] = useAtom(diffShowAtom);
  const [showFinalMessage, setShowFinalMessage] = useAtom(showFinalMessageAtom);
  const [isOverviewActive, setIsOverviewActive] = useAtom(isOverviewActiveAtom);
  const [focusFileLoading, setFocusFileLoading] = useAtom(focusFileLoadingAtom);
  const [planPageLoading, setPlanPageLoading] = useAtom(planPageLoadingAtom);
  const [diffPageLoading, setDiffPageLoading] = useAtom(diffPageLoadingAtom);
  const [contextAddMap, setContextAddMap] = useAtom(contextAddMapAtom);
  const [isPlannerLite, setIsPlannerLite] = useAtom(isPlannerLiteAtom);
  const [approvalType, setApprovalType] = useAtom(approvalTypeAtom);
  const [shouldExecuteFeature, setShouldExecuteFeature] = useAtom(
    shouldExecuteFeatureAtom
  );
  const [isExploring, setIsExploring] = useAtom(isExploringAtom);
  const [countDownMin, setCountDownMin] = useAtom(countDownMinAtom);

  return {
    // Tab state
    selectedTab,
    setSelectedTab,

    plannerViewTab,
    setPlannerViewTab,

    // Menu state
    activeView,
    setActiveView,

    // Display state
    diffShow,
    setDiffShow,
    showFinalMessage,
    setShowFinalMessage,
    isOverviewActive,
    setIsOverviewActive,

    // Loading state
    focusFileLoading,
    setFocusFileLoading,
    planPageLoading,
    setPlanPageLoading,
    diffPageLoading,
    setDiffPageLoading,

    // Context add modal
    contextAddMap,
    setContextAddMap,

    // Mode state
    isPlannerLite,
    setIsPlannerLite,
    approvalType,
    setApprovalType,

    // Other
    shouldExecuteFeature,
    setShouldExecuteFeature,
    isExploring,
    setIsExploring,
    countDownMin,
    setCountDownMin,
  };
}

// ============================================
// Selector Hooks (for fine-grained subscriptions)
// ============================================

/** Center tab state only */
export function useCenterTab() {
  const [selectedTab, setSelectedTab] = useAtom(selectedTabAtom);
  return { selectedTab, setSelectedTab };
}

/** Page loading states only */
export function usePageLoading() {
  const [focusFileLoading, setFocusFileLoading] = useAtom(focusFileLoadingAtom);
  const [planPageLoading, setPlanPageLoading] = useAtom(planPageLoadingAtom);
  const [diffPageLoading, setDiffPageLoading] = useAtom(diffPageLoadingAtom);

  return {
    focusFileLoading,
    setFocusFileLoading,
    planPageLoading,
    setPlanPageLoading,
    diffPageLoading,
    setDiffPageLoading,
  };
}

/** Active view only */
export function useActiveView() {
  const activeView = useAtomValue(activeViewAtom);
  const setActiveView = useSetAtom(activeViewAtom);
  return { activeView, setActiveView };
}
