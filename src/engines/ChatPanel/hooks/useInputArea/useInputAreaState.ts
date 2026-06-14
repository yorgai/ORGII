/**
 * useInputAreaState
 *
 * Manages local state for the InputArea component
 */
import { useState } from "react";

import type { InputAreaState } from "./types";

export function useInputAreaState(): InputAreaState {
  const [isInputFocused, setIsInputFocused] = useState(false);

  // @ Mention state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [atSearchQuery, setAtSearchQuery] = useState("");

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

    // Slash command
    showSlashMenu,
    setShowSlashMenu,
    slashQuery,
    setSlashQuery,
  };
}
