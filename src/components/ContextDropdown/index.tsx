/**
 * ContextDropdown Component
 *
 * Simple dropdown for context options (upload, manager).
 * Uses centralized dropdown tokens for consistent styling.
 */
import { Archive, ArrowRight, ImagePlus, Upload } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";

interface ContextDropdownProps {
  onSelect: (option: string) => void;
  onClose: () => void;
}

const ContextDropdown: React.FC<ContextDropdownProps> = ({
  onSelect,
  onClose,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.panelWidthClass} ${DROPDOWN_PANEL.paddingClass}`}
    >
      <div className={DROPDOWN_CLASSES.itemsColumn}>
        <div
          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} justify-between`}
          onClick={() => onSelect("image")}
          onMouseEnter={() => setHoveredItem("image")}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <div className="flex items-center gap-3">
            <ImagePlus size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
            <span>Upload Image</span>
          </div>
          {hoveredItem === "image" && (
            <ArrowRight size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
          )}
        </div>
        <div
          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} justify-between`}
          onClick={() => onSelect("upload")}
          onMouseEnter={() => setHoveredItem("upload")}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <div className="flex items-center gap-3">
            <Upload size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
            <span>Quick upload</span>
          </div>
          {hoveredItem === "upload" && (
            <ArrowRight size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
          )}
        </div>
        <div
          className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} justify-between`}
          onClick={() => onSelect("manager")}
          onMouseEnter={() => setHoveredItem("manager")}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <div className="flex items-center gap-3">
            <Archive size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
            <span>Use Context Manager</span>
          </div>
          {hoveredItem === "manager" && (
            <ArrowRight size={DROPDOWN_ITEM.iconSize} className="text-text-2" />
          )}
        </div>
      </div>
    </div>
  );
};

export default ContextDropdown;
