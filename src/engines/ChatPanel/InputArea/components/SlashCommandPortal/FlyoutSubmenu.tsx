import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import type { SlashItem, SlashItemCategory } from "@src/types/extensions";

import { categoryIcon } from "./constants";

interface FlyoutSubmenuProps {
  items: SlashItem[];
  category: SlashItemCategory;
  /** Top of the anchor row in viewport coordinates. */
  anchorTop: number;
  /** Right edge of the main panel in viewport coordinates. */
  panelRight: number;
  onSelect: (item: SlashItem) => void;
  onClose: () => void;
}

/**
 * Right-side child panel for flyout categories (Skills, MCP Servers).
 * Items are grouped by source/serverName when more than one group exists.
 * Positioned to the right of the main panel, vertically aligned to the trigger row.
 */
const FlyoutSubmenu: React.FC<FlyoutSubmenuProps> = ({
  items,
  anchorTop,
  panelRight,
  onSelect,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const groups = useMemo(() => {
    const map = new Map<string, SlashItem[]>();
    for (const item of items) {
      const key = item.serverName ?? item.source ?? "default";
      const existing = map.get(key) ?? [];
      existing.push(item);
      map.set(key, existing);
    }
    return map;
  }, [items]);

  const groupKeys = useMemo(() => [...groups.keys()], [groups]);

  // Close on click outside the flyout panel
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={`${DROPDOWN_CLASSES.panel} flex flex-col overflow-hidden`}
      style={{
        position: "fixed",
        top: anchorTop,
        left: panelRight + 4,
        minWidth: 200,
        maxWidth: 280,
        zIndex: 99999,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className={`max-h-[320px] overflow-y-auto ${DROPDOWN_PANEL.paddingClass} scrollbar-hide`}
      >
        {groupKeys.map((groupKey) => {
          const groupItems = groups.get(groupKey) ?? [];
          return (
            <div key={groupKey}>
              <div className={`${DROPDOWN_CLASSES.sectionLabel} first:pt-1`}>
                {groupKey}
              </div>
              {groupItems.map((item) => {
                const idx = items.indexOf(item);
                const Icon = categoryIcon(item.category);
                const desc =
                  item.description && item.description !== "---"
                    ? item.description
                    : undefined;
                return (
                  <div
                    key={`${item.source}-${item.name}`}
                    data-slash-flat
                    className={`${DROPDOWN_CLASSES.itemCompact} group cursor-pointer justify-between ${
                      idx === highlightIndex
                        ? "bg-fill-2 text-primary-6"
                        : "hover:bg-fill-2"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelect(item);
                    }}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {React.createElement(Icon, {
                        size: 14,
                        strokeWidth: 1.75,
                        className:
                          idx === highlightIndex
                            ? "shrink-0 text-primary-6"
                            : "shrink-0 text-text-2 group-hover:text-primary-6",
                      })}
                      <span
                        className={`truncate text-[13px] ${
                          idx === highlightIndex
                            ? "text-primary-6"
                            : "text-text-1 group-hover:text-primary-6"
                        }`}
                      >
                        {item.name}
                      </span>
                      {desc && (
                        <span
                          className={`truncate text-[11px] ${
                            idx === highlightIndex
                              ? "text-primary-6/70"
                              : "text-text-3 group-hover:text-primary-6/70"
                          }`}
                          style={{ maxWidth: 110 }}
                        >
                          {desc}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
};

FlyoutSubmenu.displayName = "FlyoutSubmenu";

export default FlyoutSubmenu;
