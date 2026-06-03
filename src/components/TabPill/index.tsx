import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import LiquidGlass from "@src/components/LiquidGlass";
import { useGlassMaterial } from "@src/hooks/theme/useGlassMaterial";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { SidebarTabButton } from "./SidebarTabButton";
import { cn } from "./cn";
import { renderTabContent } from "./tabContent";
import type { TabPillItem, TabPillProps } from "./types";

export type { TabPillItem, TabPillProps } from "./types";

const TabPill: React.FC<TabPillProps> = ({
  tabs,
  activeTab: controlledActiveTab,
  defaultActiveTab,
  onChange,
  activeTabs,
  onMultiChange,
  variant = "sidebar",
  color = "default",
  className = "",
  iconOnly = false,
  region,
  fillWidth = true,
  wrap = false,
  size = "default",
  colorScheme = "default",
  onDropdownRef,
}) => {
  const { isDark } = useCurrentTheme();
  const isMulti = activeTabs !== undefined;
  const activeTabsSet = isMulti ? new Set(activeTabs) : null;

  const normalizedTabs: TabPillItem[] = tabs.map((tab) =>
    typeof tab === "string" ? { key: tab, label: tab } : tab
  );

  const [internalActiveTab, setInternalActiveTab] = useState<string>(
    defaultActiveTab || normalizedTabs[0]?.key || ""
  );
  const activeTab =
    controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;

  const { material: regionMaterial } = useGlassMaterial(region || "sidebar", {
    thickness: "thin",
    skip: !region || variant !== "sidebar",
  });
  const regionTintRGB = regionMaterial?.tintRGB;
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLSpanElement>(null);
  const hasSlider = variant === "pill" && !wrap && !isMulti;

  const handleTabClick = useCallback(
    (tab: TabPillItem) => {
      if (tab.disabled) return;

      if (isMulti && onMultiChange) {
        const current = new Set(activeTabs);
        if (current.has(tab.key)) {
          current.delete(tab.key);
        } else {
          current.add(tab.key);
        }
        onMultiChange(Array.from(current));
        return;
      }

      if (controlledActiveTab === undefined) {
        setInternalActiveTab(tab.key);
      }
      onChange?.(tab.key);
    },
    [activeTabs, controlledActiveTab, isMulti, onChange, onMultiChange]
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPositioned, setDropdownPositioned] = useState(false);
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const dropdownPanelRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  const dropdownTab = normalizedTabs.find((tab) => tab.dropdown);

  const syncSlider = useCallback(() => {
    const container = containerRef.current;
    const slider = sliderRef.current;
    if (!container || !slider) return;

    const buttons =
      container.querySelectorAll<HTMLButtonElement>("button[data-seg]");
    const tabKeys = tabs.map((tab) =>
      typeof tab === "string" ? tab : tab.key
    );
    const activeIndex = tabKeys.indexOf(activeTab);
    const activeButton = buttons[activeIndex];
    if (!activeButton) return;

    const firstButtonRect = buttons[0].getBoundingClientRect();
    const activeRect = activeButton.getBoundingClientRect();
    const offsetLeft = activeRect.left - firstButtonRect.left;
    const width = activeRect.width;

    slider.style.width = `${width}px`;
    slider.style.transform = `translateX(${offsetLeft}px)`;
  }, [tabs, activeTab]);

  useLayoutEffect(() => {
    if (!hasSlider) return;
    syncSlider();
  }, [syncSlider, hasSlider]);

  useEffect(() => {
    const container = containerRef.current;
    if (!hasSlider || !container) return;

    const observer = new ResizeObserver(() => syncSlider());
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasSlider, syncSlider]);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setDropdownPositioned(false);
  }, []);
  useEffect(() => {
    onDropdownRef?.(closeDropdown);
  }, [onDropdownRef, closeDropdown]);

  const updateDropdownPos = useCallback(() => {
    if (!dropdownTriggerRef.current) return;
    const rect = dropdownTriggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
    setDropdownPositioned(true);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        dropdownTriggerRef.current &&
        !dropdownTriggerRef.current.contains(target) &&
        dropdownPanelRef.current &&
        !dropdownPanelRef.current.contains(target)
      ) {
        setDropdownOpen(false);
        setDropdownPositioned(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDropdownOpen(false);
        setDropdownPositioned(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;
    window.addEventListener("scroll", updateDropdownPos, true);
    window.addEventListener("resize", updateDropdownPos);
    return () => {
      window.removeEventListener("scroll", updateDropdownPos, true);
      window.removeEventListener("resize", updateDropdownPos);
    };
  }, [dropdownOpen, updateDropdownPos]);

  const handleTabClickWithDropdown = useCallback(
    (tab: TabPillItem) => {
      if (tab.dropdown) {
        setDropdownOpen((prev) => {
          if (prev) {
            setDropdownPositioned(false);
            return false;
          }
          updateDropdownPos();
          return true;
        });
        if (tab.key !== activeTab) {
          handleTabClick(tab);
        }
        return;
      }
      setDropdownOpen(false);
      setDropdownPositioned(false);
      handleTabClick(tab);
    },
    [activeTab, handleTabClick, updateDropdownPos]
  );

  const [hoveredTabKey, setHoveredTabKey] = useState<string | null>(null);

  if (variant === "sidebar") {
    return (
      <div className={cn("flex w-full items-center", className)}>
        <LiquidGlass
          material="ultrathin"
          region={region}
          noBackdrop={!!region}
          radius={100}
          noShadow={false}
          enableRim={false}
          className="flex flex-1 items-center gap-0.5"
        >
          <div className="flex flex-1 items-stretch gap-1">
            {normalizedTabs.map((tab) => (
              <SidebarTabButton
                key={tab.key}
                tab={tab}
                isActive={
                  activeTabsSet
                    ? activeTabsSet.has(tab.key)
                    : tab.key === activeTab
                }
                onClick={() => handleTabClickWithDropdown(tab)}
                iconOnly={iconOnly}
                regionTintRGB={regionTintRGB}
                isDark={isDark}
              />
            ))}
          </div>
        </LiquidGlass>
      </div>
    );
  }

  const isSimple = variant === "simple";
  const isPill = variant === "pill";
  const isFill = color === "fill";
  /** Pill + wrap + fillWidth: use CSS grid so wrapped rows stay left-aligned (no orphan flex-1 stretching). */
  const usePillWrapGrid = wrap && isPill && fillWidth;

  const tabButtons = normalizedTabs.map((tab) => {
    const hasDropdown = !!tab.dropdown;
    const isDropdownOpen = hasDropdown && dropdownOpen;
    const isActive = activeTabsSet
      ? activeTabsSet.has(tab.key)
      : tab.key === activeTab;

    if (isSimple) {
      return (
        <button
          key={tab.key}
          ref={hasDropdown ? dropdownTriggerRef : undefined}
          data-active={isActive ? "true" : "false"}
          data-tab-key={tab.key}
          data-testid={tab.dataTestId}
          onClick={() => handleTabClickWithDropdown(tab)}
          disabled={tab.disabled}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className={cn(
            "group relative z-10 flex cursor-pointer select-none flex-col items-center justify-center",
            !fillWidth && "shrink-0",
            size === "mini"
              ? "h-full text-[12px]"
              : size === "small"
                ? "h-full text-[11px]"
                : size === "large"
                  ? "h-full text-[16px]"
                  : "h-full text-[13px]",
            "border-0 bg-transparent outline-none",
            isActive
              ? "font-semibold text-text-1"
              : "text-text-3 hover:text-text-2",
            tab.disabled && "cursor-not-allowed opacity-50",
            fillWidth && (wrap ? "min-w-[5rem] flex-1" : "flex-1")
          )}
        >
          {renderTabContent(tab, iconOnly, true, isActive)}
          <span
            className={cn(
              "mt-1 h-1 w-1 rounded-full",
              isActive ? "bg-primary-6" : "invisible"
            )}
          />
        </button>
      );
    }

    return (
      <button
        key={tab.key}
        ref={hasDropdown ? dropdownTriggerRef : undefined}
        data-active={isActive ? "true" : "false"}
        data-seg=""
        data-tab-key={tab.key}
        data-testid={tab.dataTestId}
        onClick={() => handleTabClickWithDropdown(tab)}
        onMouseEnter={() => setHoveredTabKey(tab.key)}
        onMouseLeave={() => setHoveredTabKey(null)}
        disabled={tab.disabled}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={cn(
          "relative z-[2] flex cursor-pointer select-none items-center justify-center",
          "whitespace-nowrap",
          !fillWidth && "shrink-0",
          "rounded-[100px]",
          size === "mini"
            ? "text-[12px]"
            : size === "small"
              ? "text-[11px]"
              : size === "large"
                ? "text-[16px]"
                : "text-xs",
          iconOnly
            ? size === "mini"
              ? "h-6 px-1 py-[2px]"
              : size === "small"
                ? "h-7 px-1 py-[2px]"
                : size === "large"
                  ? "h-9 px-2 py-1"
                  : "h-[28px] px-1.5 py-[3px]"
            : size === "mini"
              ? "h-6 px-2 py-[2px]"
              : size === "small"
                ? "h-7 px-2 py-[2px]"
                : size === "large"
                  ? "h-9 px-4 py-1"
                  : "h-[28px] px-3 py-[3px]",
          "border-0 outline-none",
          isFill
            ? isActive
              ? size === "large"
                ? "bg-fill-1 font-semibold text-text-1"
                : "bg-fill-1 font-semibold text-primary-6"
              : isDropdownOpen
                ? "bg-fill-1 text-text-1"
                : isMulti
                  ? "bg-fill-1 text-text-2"
                  : "bg-transparent text-text-1 hover:bg-surface-hover"
            : colorScheme === "layout"
              ? isActive
                ? size === "large"
                  ? "bg-fill-2 font-semibold text-text-1"
                  : "bg-fill-2 font-semibold text-primary-6"
                : isDropdownOpen
                  ? "bg-fill-1 text-text-1"
                  : isMulti
                    ? "bg-transparent text-text-2 hover:bg-fill-1"
                    : "bg-transparent text-text-1 hover:bg-fill-1"
              : colorScheme === "muted"
                ? isActive || isDropdownOpen
                  ? size === "large"
                    ? "bg-fill-2 font-semibold text-text-1"
                    : "bg-fill-2 font-semibold text-primary-6"
                  : "bg-fill-1 text-text-1"
                : colorScheme === "ghost"
                  ? isActive || isDropdownOpen
                    ? size === "large"
                      ? "bg-fill-1 font-semibold text-text-1"
                      : "bg-fill-1 font-semibold text-primary-6"
                    : isMulti
                      ? "bg-transparent text-text-2 hover:bg-surface-hover"
                      : "bg-transparent text-text-1 hover:bg-surface-hover"
                  : isActive
                    ? size === "large"
                      ? "bg-primary-1 font-semibold text-text-1"
                      : "bg-primary-1 font-semibold text-primary-6"
                    : isDropdownOpen
                      ? "bg-fill-2 text-text-1"
                      : isMulti
                        ? "bg-fill-3 text-text-2"
                        : "bg-transparent text-text-1 hover:bg-surface-hover",
          tab.disabled && "cursor-not-allowed opacity-50",
          fillWidth &&
            (usePillWrapGrid
              ? "w-full min-w-0"
              : wrap
                ? "min-w-[5rem] flex-1"
                : "flex-1")
        )}
      >
        {renderTabContent(
          tab,
          iconOnly,
          isPill,
          isActive || isDropdownOpen,
          isMulti ? hoveredTabKey === tab.key : undefined,
          !isMulti
        )}
      </button>
    );
  });

  const sliderElement = hasSlider ? (
    <span
      ref={sliderRef}
      className={`absolute bottom-0 left-0 top-0 z-[1] rounded-[100px] ${isFill ? "bg-fill-1" : colorScheme === "layout" ? "bg-fill-2" : colorScheme === "muted" ? "bg-fill-2" : colorScheme === "ghost" ? "bg-fill-1" : "bg-primary-1"}`}
    />
  ) : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative z-10 items-stretch",
        usePillWrapGrid
          ? "grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-1"
          : fillWidth
            ? "flex"
            : "inline-flex",
        !isSimple && !wrap && "overflow-hidden",
        isPill && !wrap && "rounded-[100px]",
        isPill && !usePillWrapGrid && "gap-px",
        isSimple && (size === "large" ? "h-full gap-4" : "h-full gap-2"),
        wrap &&
          !usePillWrapGrid &&
          "flex-wrap content-start justify-start gap-1",
        fillWidth && !wrap && "flex-1",
        className
      )}
    >
      {sliderElement}
      {tabButtons}
      {dropdownTab &&
        dropdownOpen &&
        dropdownPositioned &&
        createPortal(
          <div
            ref={dropdownPanelRef}
            className={`${DROPDOWN_CLASSES.panel} fixed`}
            style={{
              position: "fixed",
              top: dropdownPos.top,
              right: dropdownPos.right,
            }}
          >
            {dropdownTab.dropdown}
          </div>,
          document.body
        )}
    </div>
  );
};

export default memo(TabPill);
