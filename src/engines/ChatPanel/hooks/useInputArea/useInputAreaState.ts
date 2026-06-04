/**
 * useInputAreaState
 *
 * Manages local state for the InputArea component
 */
import type { RecentFile } from "@/src/scaffold/ContextMenu/config";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";

import { mainPaneStateAtom } from "@src/store/workstation/tabs/atoms";

import type { InputAreaState } from "./types";

export function useInputAreaState(): InputAreaState {
  const [isInputFocused, setIsInputFocused] = useState(false);

  // @ Mention state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [atSearchQuery, setAtSearchQuery] = useState("");

  const mainPaneState = useAtomValue(mainPaneStateAtom);
  const recentFiles = useMemo<RecentFile[]>(() => {
    return mainPaneState.tabs
      .filter(
        (tab) => tab.type === "file" && typeof tab.data.filePath === "string"
      )
      .map((tab) => ({
        path: tab.data.filePath as string,
        name: tab.title,
        type: "file" as const,
      }));
  }, [mainPaneState.tabs]);

  // Slash command state
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");

  return {
    // Input focus
    isInputFocused,
    setIsInputFocused,

    // @ Mention
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    recentFiles,

    // Slash command
    showSlashMenu,
    setShowSlashMenu,
    slashQuery,
    setSlashQuery,
  };
}
