/**
 * ForceVisibleContext
 *
 * Provides context to force sidebar visibility even when collapsed.
 * Used by HoverSidebar to render sidebar content in floating mode.
 */
import React, { createContext, useContext } from "react";

// ============================================
// Context
// ============================================

interface ForceVisibleSidebarContextValue {
  forceVisible: boolean;
}

const ForceVisibleSidebarContext =
  createContext<ForceVisibleSidebarContextValue>({
    forceVisible: false,
  });

// ============================================
// Hook
// ============================================

/**
 * Hook to check if sidebar should be forced visible
 */
export function useForceVisibleSidebar(): boolean {
  const context = useContext(ForceVisibleSidebarContext);
  return context.forceVisible;
}

// ============================================
// Provider
// ============================================

interface ForceVisibleSidebarProviderProps {
  children: React.ReactNode;
}

/**
 * Provider that forces nested sidebars to be visible
 */
export const ForceVisibleSidebarProvider: React.FC<
  ForceVisibleSidebarProviderProps
> = ({ children }) => {
  return (
    <ForceVisibleSidebarContext.Provider value={{ forceVisible: true }}>
      {children}
    </ForceVisibleSidebarContext.Provider>
  );
};
