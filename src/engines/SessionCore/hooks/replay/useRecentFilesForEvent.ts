/**
 * useRecentFilesForEvent Hook
 *
 * Description: Manages recent files state for event components in simulation mode.
 * Eliminates duplicated code across FileDiffFull, FileDiffIncremental, FileEdit, and CodeFileView.
 *
 * Features:
 * - Automatically registers current file in recent files
 * - Provides tab selection state
 * - Filters files by category and timeline
 * - Safe context access (doesn't throw if not in provider)
 */
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { default as RecentFilesContext } from "@src/contexts/session/RecentFilesContext";

import {
  FileCategory,
  RecentFile,
  UseRecentFilesReturn,
  getFileCategoryFromEventType,
} from "./useRecentFiles";

// ============================================
// Types
// ============================================

/** File tab data for tab bar display */
export interface FileTabData {
  /** File path */
  path: string;
  /** Display name (filename only) */
  name: string;
  /** Is this tab active */
  isActive: boolean;
  /** Event ID associated with this file */
  eventId: string;
}

export interface UseRecentFilesForEventOptions {
  /** Event ID */
  eventId: string;
  /** Event function type (e.g., 'file_diff', 'read_file') */
  eventType: string;
  /** File path */
  filePath: string;
  /** File name (optional, extracted from path if not provided) */
  fileName?: string;
  /** Old content (for diff events) */
  oldContent?: string;
  /** New content */
  newContent?: string;
  /** Event creation timestamp */
  createdTime: number | string | Date;
  /** Component mode */
  mode: "interactive" | "simulation";
}

export interface UseRecentFilesForEventReturn {
  /** Recent files context (null if not in simulation mode or provider not available) */
  recentFilesContext: UseRecentFilesReturn | null;
  /** Currently selected file path (null means current event's file) */
  selectedFilePath: string | null;
  /** Set selected file path */
  setSelectedFilePath: (path: string | null) => void;
  /** Prepared tabs for FileTabBar */
  tabs: FileTabData[];
  /** Handler for tab clicks */
  handleTabClick: (path: string) => void;
  /** Get display data for current/selected file */
  getDisplayData: () => {
    path: string;
    name: string;
    oldContent: string;
    newContent: string;
  };
  /** File category (edit or read) */
  category: FileCategory;
  /** Whether context is available */
  hasContext: boolean;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for managing recent files state in event components.
 * Safe to call unconditionally - handles context availability internally.
 */
export function useRecentFilesForEvent(
  options: UseRecentFilesForEventOptions
): UseRecentFilesForEventReturn {
  const {
    eventId,
    eventType,
    filePath,
    fileName: providedFileName,
    oldContent = "",
    newContent = "",
    createdTime,
    mode,
  } = options;

  // Derive file name from path if not provided
  const fileName = useMemo(() => {
    if (providedFileName) return providedFileName;
    if (!filePath) return "file";
    const parts = filePath.split("/");
    return parts[parts.length - 1] || filePath;
  }, [providedFileName, filePath]);

  // Get category from event type
  const category = useMemo(
    () => getFileCategoryFromEventType(eventType),
    [eventType]
  );

  // Normalize creation time to number
  const createdTimeNum = useMemo(() => {
    if (typeof createdTime === "number") return createdTime;
    if (createdTime instanceof Date) return createdTime.getTime();
    if (typeof createdTime === "string") return new Date(createdTime).getTime();
    return 0; // Safe fallback - createdTime should always be provided
  }, [createdTime]);

  // Safe context access - doesn't throw if not in provider
  const contextValue = useContext(RecentFilesContext);
  const isSimulation = mode === "simulation";
  const recentFilesContext = isSimulation ? contextValue : null;

  // Local state for selected file in tab bar
  // State is keyed by eventId to auto-reset when event changes
  const [selectedState, setSelectedState] = useState<{
    eventId: string;
    filePath: string | null;
  }>({ eventId, filePath: null });

  // Auto-reset selection when eventId changes
  const selectedFilePath =
    selectedState.eventId === eventId ? selectedState.filePath : null;

  // Register current file in recent files (simulation mode only)
  useEffect(() => {
    if (!isSimulation || !recentFilesContext || !filePath) return;

    recentFilesContext.addRecentFile({
      path: filePath,
      name: fileName,
      eventId,
      eventType,
      category,
      oldContent,
      newContent,
      createdTime: createdTimeNum,
    });
  }, [
    isSimulation,
    recentFilesContext,
    filePath,
    fileName,
    eventId,
    eventType,
    category,
    oldContent,
    newContent,
    createdTimeNum,
  ]);

  // Build current file object for getFilesByCategory
  const currentFile: RecentFile = useMemo(
    () => ({
      path: filePath,
      name: fileName,
      eventId,
      eventType,
      category,
      oldContent,
      newContent,
      createdTime: createdTimeNum,
    }),
    [
      filePath,
      fileName,
      eventId,
      eventType,
      category,
      oldContent,
      newContent,
      createdTimeNum,
    ]
  );

  // Get category files filtered by timeline
  const categoryFiles = useMemo(() => {
    if (!recentFilesContext) return [];
    return recentFilesContext.getFilesByCategory(
      category,
      currentFile,
      createdTimeNum
    );
  }, [recentFilesContext, category, currentFile, createdTimeNum]);

  // Prepare tabs for FileTabBar
  const displayFilePath = selectedFilePath || filePath;
  const tabs: FileTabData[] = useMemo(
    () =>
      categoryFiles.map((file) => ({
        path: file.path,
        name: file.name,
        isActive: file.path === displayFilePath,
        eventId: file.eventId,
      })),
    [categoryFiles, displayFilePath]
  );

  // Tab click handler
  const handleTabClick = useCallback(
    (path: string) => {
      // Clicking current file resets to null (shows current event's file)
      setSelectedState({
        eventId,
        filePath: path === filePath ? null : path,
      });
    },
    [eventId, filePath]
  );

  // Get display data for rendering
  const getDisplayData = useCallback(() => {
    const selectedFile = selectedFilePath
      ? recentFilesContext?.getFileByPath(selectedFilePath)
      : null;

    if (selectedFile) {
      return {
        path: selectedFile.path,
        name: selectedFile.name,
        oldContent: selectedFile.oldContent || "",
        newContent: selectedFile.newContent || "",
      };
    }

    return {
      path: filePath,
      name: fileName,
      oldContent,
      newContent,
    };
  }, [
    selectedFilePath,
    recentFilesContext,
    filePath,
    fileName,
    oldContent,
    newContent,
  ]);

  return {
    recentFilesContext,
    selectedFilePath,
    setSelectedFilePath: (path: string | null) =>
      setSelectedState({ eventId, filePath: path }),
    tabs,
    handleTabClick,
    getDisplayData,
    category,
    hasContext: !!recentFilesContext,
  };
}

export default useRecentFilesForEvent;
