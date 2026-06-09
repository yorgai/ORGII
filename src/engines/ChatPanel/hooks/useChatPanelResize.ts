/**
 * useChatPanelResize Hook
 *
 * Ultra-optimized resize logic using RAF (requestAnimationFrame).
 * - Only updates once per frame
 * - Only changes panel width, NOT CSS variable during drag
 * - CSS variable only updates on mouseup
 * - Ignores clicks without actual drag to prevent accidental resize
 *
 * INVARIANT: drag minimizes, never closes. The handle clamps to MIN_WIDTH
 * on both the live drag and the final commit — no combination of window
 * size, NaN delta, or stale pending width can persist a width below
 * MIN_WIDTH. Closing the chat panel is an explicit toolbar action, not a
 * resize outcome.
 *
 * OPTIMIZED: Uses useSetAtom to avoid subscribing to chatWidth changes
 * Width is read from CSS variable, not React state
 */
import { useSetAtom } from "jotai";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DEFAULT_CHAT_WIDTH, chatWidthAtom } from "@src/store/ui/chatPanelAtom";

import {
  CHAT_WIDTH_CSS_VAR,
  LEFT_PANEL_WIDTH,
  MAX_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_WIDTH,
  RAPID_CLICK_THRESHOLD_MS,
} from "../config";

// Clamp a width value to [0, MAX_WIDTH] (0 is the valid "hidden" sentinel).
const clampChatWidth = (value: number): number =>
  value > 0 ? Math.min(value, MAX_WIDTH) : value;

export interface UseChatPanelResizeOptions {
  /** Whether using external width control */
  useExternalWidth?: boolean;
  /** Whether in embedded mode */
  embedded?: boolean;
  /** Panel position: left or right */
  position?: "left" | "right";
}

export interface UseChatPanelResizeResult {
  /** Whether currently dragging */
  isDragging: boolean;
  /** Ref to attach to the panel element */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Mouse down handler for drag handle */
  handleMouseDown: (event: ReactMouseEvent) => void;
}

// Helper to get current width from CSS variable, clamped to MAX_WIDTH.
const getChatWidthFromCSS = (): number => {
  if (typeof document === "undefined") return DEFAULT_CHAT_WIDTH;
  const cssValue =
    document.documentElement.style.getPropertyValue(CHAT_WIDTH_CSS_VAR);
  if (cssValue) {
    const parsed = parseInt(cssValue, 10);
    if (!isNaN(parsed)) return clampChatWidth(parsed);
  }
  return DEFAULT_CHAT_WIDTH;
};

/**
 * Hook for managing ChatPanel resize behavior
 */
export function useChatPanelResize(
  options: UseChatPanelResizeOptions = {}
): UseChatPanelResizeResult {
  const {
    useExternalWidth = false,
    embedded = false,
    position = "right",
  } = options;
  const isLeftPosition = position === "left";

  // OPTIMIZED: Only use setter, don't subscribe to value changes
  // Width is read from CSS variable when needed
  const setChatWidth = useSetAtom(chatWidthAtom);
  const [isDragging, setIsDragging] = useState(false);

  // Refs for pure DOM resize (no React renders during drag)
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const pendingWidthRef = useRef<number>(0);
  const hasDraggedRef = useRef<boolean>(false);
  const lastClickTimeRef = useRef<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  /**
   * Handle mouse down on drag handle
   */
  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (useExternalWidth) return;

      event.preventDefault();
      event.stopPropagation();

      // Ignore double-click (detail >= 2)
      if (event.detail >= 2) {
        return;
      }

      // Ignore clicks within threshold of last click (rapid click prevention)
      const now = Date.now();
      if (now - lastClickTimeRef.current < RAPID_CLICK_THRESHOLD_MS) {
        return;
      }
      lastClickTimeRef.current = now;

      // OPTIMIZED: Read current width from CSS variable instead of React state
      const currentWidth = getChatWidthFromCSS();
      const startX = event.clientX;
      const startWidth = currentWidth;
      pendingWidthRef.current = currentWidth;
      hasDraggedRef.current = false;

      // Cache element references at drag start for better performance.
      // Use data-attribute queries instead of brittle parentElement traversal
      // so the lookup is resilient to DOM depth differences across layouts.
      const cachedMainContent = !embedded
        ? (document.querySelector("[data-main-content]") as HTMLElement | null)
        : null;

      // Inset overlay wrapper: the direct parent of the ChatPanel root that
      // sits inside [data-main-content]. We find it by walking up from panelRef
      // until we hit [data-main-content]'s direct child.
      let cachedInsetOverlay: HTMLElement | null = null;
      if (!embedded && panelRef.current && cachedMainContent) {
        let node: HTMLElement | null = panelRef.current;
        while (node && node.parentElement !== cachedMainContent) {
          node = node.parentElement;
        }
        cachedInsetOverlay = node;
      }

      // For embedded (full) mode, find the chat wrapper by data attribute.
      let cachedChatWrapper: HTMLElement | null = null;
      if (embedded && panelRef.current) {
        cachedChatWrapper = panelRef.current.closest(
          "[data-fullmode-chat-wrapper]"
        ) as HTMLElement | null;
      }

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        // Only start "dragging" mode after first actual movement
        if (!hasDraggedRef.current) {
          hasDraggedRef.current = true;
          setIsDragging(true);

          // Set cursor globally - only when actually dragging
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }

        // Calculate dynamic max width based on available space. Guard
        // against undersized viewports where `availableWidth - MIN_CENTER_WIDTH`
        // would fall below MIN_WIDTH and make the `Math.min` below try to
        // shrink the panel past its minimum — we always want a valid
        // non-collapsing range.
        const availableWidth = window.innerWidth - LEFT_PANEL_WIDTH - 20;
        const dynamicMaxWidth = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, availableWidth - MIN_CENTER_WIDTH)
        );

        // Calculate new width with constraints. Minimum is enforced as the
        // LAST step so nothing (negative delta, NaN, subzero dynamicMax, …)
        // can produce a width below MIN_WIDTH — drag minimizes, never closes.
        const delta = isLeftPosition
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
        const proposed = startWidth + delta;
        const clampedToMax = Math.min(dynamicMaxWidth, proposed);
        const newWidth = Math.max(MIN_WIDTH, clampedToMax);
        pendingWidthRef.current = newWidth;

        // Cancel previous RAF if pending
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }

        // Schedule DOM update for next frame
        rafRef.current = requestAnimationFrame(() => {
          if (panelRef.current) {
            panelRef.current.style.width = `${newWidth}px`;
          }

          if (embedded) {
            if (cachedChatWrapper) {
              cachedChatWrapper.style.width = `${newWidth}px`;
            }
          } else {
            if (cachedInsetOverlay) {
              cachedInsetOverlay.style.width = `${newWidth}px`;
            }

            if (cachedMainContent) {
              const paddingProp = isLeftPosition
                ? "paddingLeft"
                : "paddingRight";
              cachedMainContent.style[paddingProp] = `${newWidth + 12}px`;
            }
          }
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        // Only do cleanup if we actually started dragging
        if (hasDraggedRef.current) {
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
          }

          document.body.style.cursor = "";
          document.body.style.userSelect = "";

          // Final clamp on commit: the drag handle can only minimize the
          // panel, never close it. If pendingWidthRef somehow holds a
          // sub-minimum value (NaN, stale from a previous drag, etc.) we
          // coerce it up to MIN_WIDTH here so the persisted width never
          // collapses the panel.
          const rawFinal = pendingWidthRef.current;
          const finalWidth = clampChatWidth(
            Number.isFinite(rawFinal) && rawFinal >= MIN_WIDTH
              ? rawFinal
              : MIN_WIDTH
          );

          if (embedded) {
            if (panelRef.current) {
              panelRef.current.style.width = "";
            }
            if (cachedChatWrapper) {
              cachedChatWrapper.style.width = "";
            }

            document.documentElement.style.setProperty(
              CHAT_WIDTH_CSS_VAR,
              `${finalWidth}px`
            );
            setChatWidth(finalWidth);
          } else {
            if (panelRef.current) {
              panelRef.current.style.width = "";
            }
            if (cachedInsetOverlay) {
              cachedInsetOverlay.style.width = "";
            }

            if (cachedMainContent) {
              if (isLeftPosition) {
                cachedMainContent.style.paddingLeft = "";
              } else {
                cachedMainContent.style.paddingRight = "";
              }
            }

            document.documentElement.style.setProperty(
              CHAT_WIDTH_CSS_VAR,
              `${finalWidth}px`
            );
            setChatWidth(finalWidth);
          }

          setIsDragging(false);
          hasDraggedRef.current = false;
        }
      };

      // Store cleanup functions for unmount safety
      // Also reset body styles to prevent stuck user-select: none if unmount happens mid-drag
      dragCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (panelRef.current) {
          panelRef.current.style.width = "";
        }
        if (cachedInsetOverlay) {
          cachedInsetOverlay.style.width = "";
        }
        if (cachedChatWrapper) {
          cachedChatWrapper.style.width = "";
        }
        if (cachedMainContent) {
          if (isLeftPosition) {
            cachedMainContent.style.paddingLeft = "";
          } else {
            cachedMainContent.style.paddingRight = "";
          }
        }
        hasDraggedRef.current = false;
        setIsDragging(false);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [embedded, isLeftPosition, setChatWidth, useExternalWidth]
  );

  // Cleanup drag listeners on unmount
  useEffect(() => {
    const handleWindowBlur = () => {
      if (!hasDraggedRef.current) return;
      dragCleanupRef.current?.();
    };

    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      dragCleanupRef.current?.();
    };
  }, []);

  return {
    isDragging,
    panelRef,
    handleMouseDown,
  };
}
