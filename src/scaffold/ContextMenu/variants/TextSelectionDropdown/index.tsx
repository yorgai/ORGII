/**
 * TextSelectionDropdown Component
 *
 * A floating dropdown menu that appears when text is selected in terminal or browser views.
 * Provides options to "Ask Agent" or "Add to Session Context".
 *
 * Features:
 * - High z-index (99999) for visibility above all other elements
 * - Two-level menu: main options and session selector
 * - Keyboard navigation support
 * - Smooth animations
 *
 * @example
 * <TextSelectionDropdown
 *   visible={isVisible}
 *   position={{ x: 100, y: 200 }}
 *   selectedText="selected content"
 *   source="terminal"
 *   onClose={handleClose}
 *   onAskAgent={handleAskAgent}
 *   onAddToContext={handleAddToContext}
 * />
 */
import { useAtomValue } from "jotai";
import { MessageSquare, Plus } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { Session, recentSessionsAtom } from "@src/store/session";
import { stripPillReferences } from "@src/util/session/stripPillReferences";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import {
  DropdownAction,
  EDITOR_MENU_ITEMS,
  ICON_CONFIG,
  KEYBOARD_CONFIG,
  MENU_ITEMS,
  STYLE_CONFIG,
  SessionItem,
} from "./config";
import { TextSelectionDropdownProps } from "./types";

// ============================================
// Sub-components
// ============================================

interface MenuItemRowProps {
  icon: React.ReactNode;
  label: string;
  hasArrow?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const MenuItemRow: React.FC<MenuItemRowProps> = memo(
  ({
    icon,
    label,
    hasArrow = false,
    isActive = false,
    onClick,
    onMouseEnter,
    onMouseLeave,
  }) => (
    <div
      className={`${DROPDOWN_CLASSES.itemCompact} justify-between ${
        isActive ? "bg-fill-2" : DROPDOWN_CLASSES.itemHover
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      {hasArrow && (
        <ICON_CONFIG.arrow
          size={14}
          className="text-text-3"
          strokeWidth={1.75}
        />
      )}
    </div>
  )
);

MenuItemRow.displayName = "MenuItemRow";

interface SessionSelectorPanelProps {
  sessions: SessionItem[];
  activeIndex: number;
  onSelect: (sessionId: string | null) => void;
  onHover: (index: number) => void;
  onHoverEnd: () => void;
  onBack: () => void;
}

const SessionSelectorPanel: React.FC<SessionSelectorPanelProps> = memo(
  ({ sessions, activeIndex, onSelect, onHover, onHoverEnd, onBack }) => {
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    // Scroll active item into view
    useEffect(() => {
      if (itemRefs.current[activeIndex]) {
        itemRefs.current[activeIndex]?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }, [activeIndex]);

    return (
      <div
        className={DROPDOWN_CLASSES.panel}
        style={{ width: STYLE_CONFIG.secondLayerWidth }}
      >
        {/* Header with back button */}
        <div className="flex items-center gap-2 border-b border-solid border-border-2 px-2 py-2">
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={onBack}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-text-2 hover:bg-fill-1"
          >
            <ICON_CONFIG.arrowBack size={16} strokeWidth={1.75} />
          </button>
          <span className="text-[13px] font-medium text-text-1">
            Select Session
          </span>
        </div>

        {/* Session list */}
        <div
          className="overflow-y-auto px-1 py-1 scrollbar-hide"
          style={{ maxHeight: STYLE_CONFIG.maxHeight }}
        >
          {/* New Session option - always first */}
          <div
            ref={(element) => {
              itemRefs.current[0] = element;
            }}
            className={`${DROPDOWN_CLASSES.itemCompact} ${
              activeIndex === 0 ? "bg-fill-2" : DROPDOWN_CLASSES.itemHover
            }`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(null)}
            onMouseEnter={() => onHover(0)}
            onMouseLeave={onHoverEnd}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary-6/10">
              <Plus size={14} className="text-primary-6" />
            </div>
            <span className="text-[13px] font-medium text-primary-6">
              New Session
            </span>
          </div>

          {/* Divider */}
          {sessions.length > 0 && <div className="my-1 h-px bg-border-2" />}

          {/* Existing sessions */}
          {sessions.map((session, index) => {
            const itemIndex = index + 1; // +1 for New Session
            return (
              <div
                key={session.sessionId}
                ref={(element) => {
                  itemRefs.current[itemIndex] = element;
                }}
                className={`${DROPDOWN_CLASSES.itemCompact} ${
                  activeIndex === itemIndex
                    ? "bg-fill-2"
                    : DROPDOWN_CLASSES.itemHover
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(session.sessionId)}
                onMouseEnter={() => onHover(itemIndex)}
                onMouseLeave={onHoverEnd}
              >
                <MessageSquare
                  size={16}
                  className="flex-shrink-0 text-text-2"
                />
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate text-[12px] text-text-1">
                    {session.name}
                  </span>
                  {session.updatedAt && (
                    <span className="text-[10px] text-text-3">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {sessions.length === 0 && (
            <div className="px-3 py-2 text-center text-[12px] text-text-3">
              No recent sessions
            </div>
          )}
        </div>
      </div>
    );
  }
);

SessionSelectorPanel.displayName = "SessionSelectorPanel";

// ============================================
// Utility Functions
// ============================================

function mapSessionToItem(session: Session): SessionItem {
  return {
    sessionId: session.session_id,
    name: stripPillReferences(
      session.name || session.user_input?.slice(0, 50) || "Untitled Session"
    ),
    updatedAt: session.updated_at || session.created_at,
  };
}

// ============================================
// Main Component
// ============================================

const TextSelectionDropdown: React.FC<TextSelectionDropdownProps> = ({
  visible,
  position,
  selectedText,
  source,
  onClose,
  onAskAgent,
  onAddToContext,
  lineRange,
  className = "",
}) => {
  const { t } = useTranslation("common");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const calculatedPositionRef = useRef(position);

  // State
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [sessionActiveIndex, setSessionActiveIndex] = useState(0);
  const [safePosition, setSafePosition] = useState(position);

  const resetActiveIndex = useCallback(() => setActiveIndex(-1), []);
  const resetSessionActiveIndex = useCallback(
    () => setSessionActiveIndex(-1),
    []
  );

  // Get recent sessions from store
  const recentSessions = useAtomValue(recentSessionsAtom);
  const sessionItems: SessionItem[] = recentSessions.map(mapSessionToItem);

  // Select menu items based on source
  const menuItems = source === "editor" ? EDITOR_MENU_ITEMS : MENU_ITEMS;

  // Calculate safe position to keep dropdown within viewport
  // Use useLayoutEffect to calculate position after render but before paint
  useLayoutEffect(() => {
    if (!visible || !dropdownRef.current) {
      calculatedPositionRef.current = position;
      return;
    }

    const dropdownRect = dropdownRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 10;

    let safeX = position.x;
    let safeY = position.y;

    // Prevent overflow right
    if (safeX + dropdownRect.width + padding > viewportWidth) {
      safeX = viewportWidth - dropdownRect.width - padding;
    }

    // Prevent overflow bottom
    if (safeY + dropdownRect.height + padding > viewportHeight) {
      safeY = viewportHeight - dropdownRect.height - padding;
    }

    // Prevent overflow left/top
    safeX = Math.max(padding, safeX);
    safeY = Math.max(padding, safeY);

    calculatedPositionRef.current = { x: safeX, y: safeY };
  }, [visible, position]);

  // Sync calculated position to state (separate effect to avoid setState-in-effect warning)
  useEffect(() => {
    setSafePosition(calculatedPositionRef.current);
  }, [visible, position]);

  // Handle menu item click
  const handleMenuClick = useCallback(
    (action: DropdownAction) => {
      if (action === "ask-agent") {
        onAskAgent?.(selectedText);
        onClose();
      } else if (action === "add-to-chat") {
        // Direct insert into chat composer — no session picker
        onAddToContext?.(selectedText, null);
        onClose();
      } else if (action === "add-to-context") {
        setShowSessionSelector(true);
        setSessionActiveIndex(0);
      } else if (action === "add-file") {
        onAddToContext?.(selectedText, null);
        onClose();
      } else if (action === "add-lines") {
        onAskAgent?.(selectedText);
        onClose();
      }
    },
    [selectedText, onAskAgent, onAddToContext, onClose]
  );

  // Handle session selection
  const handleSessionSelect = useCallback(
    (sessionId: string | null) => {
      onAddToContext?.(selectedText, sessionId);
      onClose();
    },
    [selectedText, onAddToContext, onClose]
  );

  // Handle back button
  const handleBack = useCallback(() => {
    setShowSessionSelector(false);
    setActiveIndex(1); // Return to "Add to Session Context"
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!visible) return;

      const key = event.key;

      if (showSessionSelector) {
        // Session selector navigation
        const totalItems = sessionItems.length + 1; // +1 for New Session

        if (key === KEYBOARD_CONFIG.up) {
          event.preventDefault();
          setSessionActiveIndex(
            (previous) => (previous - 1 + totalItems) % totalItems
          );
        } else if (key === KEYBOARD_CONFIG.down) {
          event.preventDefault();
          setSessionActiveIndex((previous) => (previous + 1) % totalItems);
        } else if (key === KEYBOARD_CONFIG.enter) {
          event.preventDefault();
          if (sessionActiveIndex === 0) {
            handleSessionSelect(null);
          } else {
            const session = sessionItems[sessionActiveIndex - 1];
            handleSessionSelect(session.sessionId);
          }
        } else if (
          key === KEYBOARD_CONFIG.left ||
          key === KEYBOARD_CONFIG.escape
        ) {
          event.preventDefault();
          handleBack();
        }
      } else {
        // Main menu navigation
        if (key === KEYBOARD_CONFIG.up) {
          event.preventDefault();
          setActiveIndex((previous) => {
            // If no item is active, start from last item
            if (previous < 0) return menuItems.length - 1;
            return (previous - 1 + menuItems.length) % menuItems.length;
          });
        } else if (key === KEYBOARD_CONFIG.down) {
          event.preventDefault();
          setActiveIndex((previous) => {
            // If no item is active, start from first item
            if (previous < 0) return 0;
            return (previous + 1) % menuItems.length;
          });
        } else if (
          key === KEYBOARD_CONFIG.enter ||
          key === KEYBOARD_CONFIG.right
        ) {
          event.preventDefault();
          // If no item is active, default to first item (index 0)
          const indexToUse = activeIndex >= 0 ? activeIndex : 0;
          const item = menuItems[indexToUse];
          handleMenuClick(item.id);
        } else if (key === KEYBOARD_CONFIG.escape) {
          event.preventDefault();
          onClose();
        }
      }
    },
    [
      visible,
      showSessionSelector,
      sessionItems,
      sessionActiveIndex,
      activeIndex,
      menuItems,
      handleMenuClick,
      handleSessionSelect,
      handleBack,
      onClose,
    ]
  );

  // Reset state when visibility changes to false
  const previousVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;

    if (wasVisible && !visible) {
      // Only reset when transitioning from visible to hidden
      // Schedule state updates in next tick to avoid setState-in-effect warning
      Promise.resolve().then(() => {
        setActiveIndex(-1);
        setShowSessionSelector(false);
        setSessionActiveIndex(0);
      });
    }
  }, [visible]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className={`text-selection-dropdown fixed ${className}`}
      style={{
        left: safePosition.x,
        top: safePosition.y,
        zIndex: STYLE_CONFIG.zIndex,
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
    >
      {showSessionSelector ? (
        <SessionSelectorPanel
          sessions={sessionItems}
          activeIndex={sessionActiveIndex}
          onSelect={handleSessionSelect}
          onHover={setSessionActiveIndex}
          onHoverEnd={resetSessionActiveIndex}
          onBack={handleBack}
        />
      ) : (
        <div
          className={DROPDOWN_CLASSES.panel}
          style={{ width: STYLE_CONFIG.dropdownWidth }}
        >
          {source === "editor" && (
            <div className={DROPDOWN_CLASSES.sectionLabel}>
              {t("selectionMenu.title")}
            </div>
          )}
          <div
            className={
              source === "editor"
                ? DROPDOWN_PANEL.paddingBelowHeaderClass
                : DROPDOWN_PANEL.paddingClass
            }
          >
            {menuItems.map((item, index) => {
              const IconComponent = item.icon;
              let label: string;
              if (item.id === "add-to-chat") {
                label = t("selectionMenu.addToChat");
              } else if (item.id === "add-file") {
                label = t("selectionMenu.addThisFile");
              } else if (item.id === "add-lines") {
                label = t("selectionMenu.addLines", {
                  from: lineRange?.fromLine ?? 0,
                  to: lineRange?.toLine ?? 0,
                });
              } else {
                label = item.label;
              }

              return (
                <MenuItemRow
                  key={item.id}
                  icon={
                    <IconComponent
                      size={16}
                      className="text-text-2"
                      strokeWidth={1.75}
                    />
                  }
                  label={label}
                  hasArrow={item.hasSecondLayer}
                  isActive={activeIndex === index}
                  onClick={() => handleMenuClick(item.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={resetActiveIndex}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // Render in portal to ensure highest z-index
  return createPortal(dropdownContent, document.body);
};

export default memo(TextSelectionDropdown);
