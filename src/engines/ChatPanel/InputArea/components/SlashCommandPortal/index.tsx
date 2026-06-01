/**
 * SlashCommandPortal — public entry point.
 *
 * Thin wrapper that:
 *  - Returns null when not visible (avoids mounting overhead).
 *  - In inline mode, remounts SlashCommandMenu whenever the item list changes
 *    so the keyboard highlight resets cleanly without a setState-in-effect.
 *  - In header mode, keeps a stable mount so the search input retains focus
 *    and caret position between keystrokes.
 */
import React, { useMemo } from "react";

import SlashCommandMenu from "./SlashCommandMenu";
import type { SlashCommandPortalProps } from "./types";

export type { SlashCommandPortalProps, SlashCommandSearchMode } from "./types";

const SlashCommandPortal: React.FC<SlashCommandPortalProps> = (props) => {
  const { visible, items, searchMode = "inline" } = props;

  const listResetKey = useMemo(
    () => items.map((i) => `${i.source}:${i.category}:${i.name}`).join("\0"),
    [items]
  );

  if (!visible) return null;

  if (searchMode === "header") {
    return <SlashCommandMenu {...props} />;
  }

  return <SlashCommandMenu key={listResetKey} {...props} />;
};

SlashCommandPortal.displayName = "SlashCommandPortal";

export default SlashCommandPortal;
