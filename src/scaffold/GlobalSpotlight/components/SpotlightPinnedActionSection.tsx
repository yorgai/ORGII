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
}) => {
  const { isKeyboardMode, handleMouseMove, dataKeyboardMode } =
    useKeyboardMouseMode();

  if (items.length === 0) return null;

  return (
    <div
      className="border-t border-border-2 py-1"
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
