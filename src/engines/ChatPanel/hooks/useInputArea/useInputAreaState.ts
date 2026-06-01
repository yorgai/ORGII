/**
 * useInputAreaState
 *
 * Manages local state for the InputArea component
 */
import type { RecentFile } from "@/src/scaffold/ContextMenu/config";
import { useState } from "react";

import type { InputAreaState } from "./types";

export function useInputAreaState(): InputAreaState {
  const [isInputFocused, setIsInputFocused] = useState(false);

  // @ Mention state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [atSearchQuery, setAtSearchQuery] = useState("");
  const [recentFiles] = useState<RecentFile[]>([]);

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
