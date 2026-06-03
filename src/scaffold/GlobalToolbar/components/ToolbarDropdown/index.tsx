/**
 * ToolbarDropdown Component
 *
 * Shared dropdown base for GlobalToolbar menus (ellipsis, plus, etc.).
 * Handles positioning, liquid glass material, animation, click-outside,
 * keyboard (Escape), and item rendering.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useSetAtom } from "jotai";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getMaterialConfig } from "@src/components/LiquidGlass/config";
import { POPUP_SHADOW } from "@src/scaffold/shared/popupTokens";
import { toolbarDropdownOpenAtom } from "@src/store/ui/overlayAtom";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import type { ToolbarDropdownProps } from "./types";

export type {
  ToolbarDropdownIcon,
  ToolbarDropdownItem,
  ToolbarDropdownProps,
} from "./types";

// ============================================
// Styles
// ============================================

const DROPDOWN_HOVER_STYLES = `
  .toolbar-dropdown-item:hover {
    background: var(--color-fill-2);
  }
  .toolbar-dropdown-item--danger:hover {
    background: color-mix(in srgb, var(--color-danger-6) 15%, transparent);
  }
`;

// ============================================
// Component
// ============================================

export const ToolbarDropdown: React.FC<ToolbarDropdownProps> = ({
  isOpen,
  onClose,
  triggerRef,
  items,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useCurrentTheme();
  const [position, setPosition] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  const setToolbarDropdownOpen = useSetAtom(toolbarDropdownOpenAtom);
  useEffect(() => {
    setToolbarDropdownOpen(isOpen);
  }, [isOpen, setToolbarDropdownOpen]);

  useEffect(() => {
    if (isOpen && triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const right = window.innerWidth - rect.right;
      setPosition({ top: rect.bottom + 7, right });
    }
  }, [isOpen, triggerRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        isOpen &&
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!triggerRef?.current || !triggerRef.current.contains(target))
      ) {
        onClose();
      }
    };

    if (isOpen) {
      const timeoutId = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen, onClose, triggerRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOpen && event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
      return () => document.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [isOpen, onClose]);

  const visibleItems = useMemo(
    () => items.filter((item) => item.show !== false),
    [items]
  );

  const containerMaterial = useMemo(
    () => getMaterialConfig(isDark, "thick"),
    [isDark]
  );

  const containerGlassStyle = useMemo(() => {
    const borderColor = isDark
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(255, 255, 255, 0.18)";
    return {
      backdropFilter: `blur(${containerMaterial.blur}px)`,
      WebkitBackdropFilter: `blur(${containerMaterial.blur}px)`,
      background: containerMaterial.background,
      border: `1px solid ${borderColor}`,
      boxShadow: POPUP_SHADOW,
    };
  }, [isDark, containerMaterial]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <style>{DROPDOWN_HOVER_STYLES}</style>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={onClose}
            style={{ background: "transparent" }}
          />
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-[12px]"
            style={{
              top: position.top,
              right: position.right,
              ...containerGlassStyle,
            }}
          >
            <div className="w-full p-2">
              {visibleItems.map((item) => {
                if (item.id === "divider") {
                  return (
                    <div key={item.id} className="my-1 h-px bg-border-1" />
                  );
                }
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    data-testid={`toolbar-dropdown-item-${item.id}`}
                    onClick={() => {
                      onClose();
                      item.onClick();
                    }}
                    className={`toolbar-dropdown-item flex w-full items-center gap-3 rounded-[8px] px-4 py-2.5 text-left text-[14px] transition-colors ${
                      item.isDanger
                        ? "toolbar-dropdown-item--danger text-danger-6"
                        : "text-text-1"
                    }`}
                  >
                    <IconComponent
                      size={14}
                      strokeWidth={1.75}
                      className={
                        item.isDanger ? "text-danger-6" : "text-text-1"
                      }
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ToolbarDropdown;
