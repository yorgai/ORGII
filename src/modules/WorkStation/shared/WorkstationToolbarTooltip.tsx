import type { ReactNode } from "react";
import React, { memo } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip, { type TooltipProps } from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

export interface WorkstationToolbarTooltipProps {
  label: ReactNode;
  shortcutId?: string;
  position?: TooltipProps["position"];
  disabled?: boolean;
  children: ReactNode;
}

export const WorkstationToolbarTooltip: React.FC<WorkstationToolbarTooltipProps> =
  memo(
    ({
      label,
      shortcutId,
      position = "bottom",
      disabled = false,
      children,
    }) => {
      const shortcut = shortcutId ? getShortcutKeys(shortcutId) : "";
      const content = shortcut ? (
        <KeyboardShortcutTooltipContent label={label} shortcut={shortcut} />
      ) : (
        label
      );

      return (
        <Tooltip
          content={content}
          position={position}
          mouseEnterDelay={200}
          framedPanel={!!shortcut}
          disabled={disabled}
          smartPlacement
        >
          <span className="inline-flex">{children}</span>
        </Tooltip>
      );
    }
  );

WorkstationToolbarTooltip.displayName = "WorkstationToolbarTooltip";
