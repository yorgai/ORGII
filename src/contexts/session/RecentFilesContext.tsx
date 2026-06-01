/**
 * RecentFilesContext
 *
 * Provides shared state for tracking recently viewed files across code editor components in the simulator.
 */
import React, { ReactNode, createContext, useContext } from "react";

import {
  UseRecentFilesReturn,
  useRecentFiles,
} from "@src/engines/SessionCore/hooks/replay/useRecentFiles";

// ============================================
// Context
// ============================================

const RecentFilesContext = createContext<UseRecentFilesReturn | null>(null);

// ============================================
// Provider
// ============================================

export interface RecentFilesProviderProps {
  children: ReactNode;
  /** Maximum number of recent files to track */
  maxFiles?: number;
}

export const RecentFilesProvider: React.FC<RecentFilesProviderProps> = ({
  children,
  maxFiles = 5,
}) => {
  const recentFilesState = useRecentFiles({ maxFiles });

  return (
    <RecentFilesContext.Provider value={recentFilesState}>
      {children}
    </RecentFilesContext.Provider>
  );
};

// ============================================
// Hook to use the context
// ============================================

export const useRecentFilesContext = (): UseRecentFilesReturn => {
  const context = useContext(RecentFilesContext);
  if (!context) {
    throw new Error(
      "useRecentFilesContext must be used within RecentFilesProvider"
    );
  }
  return context;
};

export default RecentFilesContext;
