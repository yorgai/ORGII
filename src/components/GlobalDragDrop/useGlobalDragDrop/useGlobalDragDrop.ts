/**
 * useGlobalDragDrop Hook
 *
 * Main orchestrating hook for GlobalDragDrop component.
 * Composes sub-hooks for different drag-drop scenarios.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";

import { spotlightOpenAtom } from "@src/store";
import { appGridEditModeAtom } from "@src/store/ui/appGridAtom";
import { addWorkspaceInitialStageAtom } from "@src/store/ui/overlayAtom";
import { workflowDragActiveAtom } from "@src/store/ui/workflowEditorAtom";

import type { DragDropBehavior, DroppedFolder } from "../types";
import type { UseGlobalDragDropReturn } from "./types";
import { useBrowserDragDrop } from "./useBrowserDragDrop";
import { useFileHandlers } from "./useFileHandlers";
import { useLayoutHelpers } from "./useLayoutHelpers";
import { useTauriDragDrop } from "./useTauriDragDrop";

export function useGlobalDragDrop(): UseGlobalDragDropReturn {
  // Core state
  const [isDragging, setIsDragging] = useState(false);
  const [behavior, setBehavior] = useState<DragDropBehavior | null>(null);
  const [droppedFolder, setDroppedFolder] = useState<DroppedFolder | null>(
    null
  );

  // Spotlight
  const [_, setSpotlightOpen] = useAtom(spotlightOpenAtom);
  const setAddWorkspaceInitialStage = useSetAtom(addWorkspaceInitialStageAtom);

  // Track app grid edit mode and workflow drag
  const appGridEditMode = useAtomValue(appGridEditModeAtom);
  const workflowDragActive = useAtomValue(workflowDragActiveAtom);

  // Shared refs
  const dragDepthRef = React.useRef(0);
  const appGridEditModeRef = React.useRef(false);
  const workflowDragActiveRef = React.useRef(false);
  const internalFileTreeDragRef = React.useRef(false);

  // Keep refs in sync with atom values
  React.useEffect(() => {
    appGridEditModeRef.current = appGridEditMode;
  }, [appGridEditMode]);

  React.useEffect(() => {
    workflowDragActiveRef.current = workflowDragActive;
  }, [workflowDragActive]);

  // Sub-hooks
  const { handleIdeFileDrop, handleBrowserFileDrop } = useFileHandlers();

  const { getContainerStyle } = useLayoutHelpers();

  useBrowserDragDrop({
    handleIdeFileDrop,
    handleBrowserFileDrop,
    setDroppedFolder,
    setIsDragging,
    setBehavior,
    dragDepthRef,
    appGridEditModeRef,
    workflowDragActiveRef,
    internalFileTreeDragRef,
  });

  // Tauri-native drag-drop (OS Finder → WebView, plus internal startDrag
  // reentrants). With `dragDropEnabled: true` in tauri.conf.json — the
  // default — the browser `drop` event never fires for OS drags; we must
  // subscribe to the Tauri WebviewWindow event to get real filesystem paths.
  useTauriDragDrop({
    handleIdeFileDrop,
    setDroppedFolder,
    setIsDragging,
    setBehavior,
  });

  const handleOpenSpotlight = useCallback(() => {
    if (!droppedFolder) return;

    sessionStorage.setItem(
      "dragDropData",
      JSON.stringify({
        initialPath: droppedFolder.path,
        initialName: droppedFolder.name,
      })
    );

    setAddWorkspaceInitialStage("add-workspace-existing");
    setSpotlightOpen(true);
    setDroppedFolder(null);
  }, [droppedFolder, setSpotlightOpen, setAddWorkspaceInitialStage]);

  return {
    isDragging,
    behavior,
    droppedFolder,

    handleOpenSpotlight,
    setDroppedFolder,

    getContainerStyle,
  };
}
