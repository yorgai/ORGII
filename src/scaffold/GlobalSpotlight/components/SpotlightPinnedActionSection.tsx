import React from "react";

import { useKeyboardMouseMode } from "@src/hooks/keyboard";

import type { SpotlightItem } from "../types";
import { SpotlightItemRow } from "./SpotlightItemRow";

export interface SpotlightPinnedActionSectionProps {
  items: SpotlightItem[];
  startIndex: number;
  selectedIndex: number;
  onItemSelect: (item: SpotlightItem) => void;
  onItemHover: (index: number) => void;
  searchQuery: string;
  layout?: "list" | "twoColumn";
}

export const SpotlightPinnedActionSection: React.FC<
  SpotlightPinnedActionSectionProps
> = ({
  items,
  startIndex,
  selectedIndex,
  onItemSelect,
  onItemHover,
  searchQuery,
  layout = "list",
}) => {
  const { isKeyboardMode, handleMouseMove, dataKeyboardMode } =
    useKeyboardMouseMode();

  if (items.length === 0) return null;

  const layoutClassName =
    layout === "twoColumn"
      ? "grid grid-flow-col grid-rows-2 grid-cols-2 gap-x-2 gap-y-0"
      : "flex flex-col";

  return (
    <div
      className={`border-t border-border-2 py-1 ${layoutClassName}`}
      onMouseMove={handleMouseMove}
      data-keyboard-mode={dataKeyboardMode}
    >
      {items.map((item, localIndex) => {
        const index = startIndex + localIndex;
        return (
          <SpotlightItemRow
            key={item.id}
            item={item}
            index={index}
            isSelected={selectedIndex === index}
            isKeyboardMode={isKeyboardMode}
            onSelect={onItemSelect}
            onHover={onItemHover}
            searchQuery={searchQuery}
          />
        );
      })}
    </div>
  );
};

export default SpotlightPinnedActionSection;
