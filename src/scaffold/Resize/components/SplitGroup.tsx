/**
 * SplitGroup Component
 *
 * Container for multiple resizable panes with coordinated resize behavior.
 * Supports both horizontal (side-by-side) and vertical (stacked) layouts.
 *
 * Usage:
 * ```tsx
 * <SplitGroup
 *   axis="x"
 *   sizes={[300, 1, 400]}  // pixels or flex values
 *   sizeUnit="pixels"
 *   onSizesChange={setSizes}
 * >
 *   <Pane id="explorer">
 *     <ExplorerPanel />
 *   </Pane>
 *   <Pane id="editor" flex>
 *     <EditorPanel />
 *   </Pane>
 *   <Pane id="terminal">
 *     <TerminalPanel />
 *   </Pane>
 * </SplitGroup>
 * ```
 */
import React, {
  Children,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useResizeManager } from "../ResizeManager";
import type { ResizeAxis, ResizeSession, SplitGroupProps } from "../types";
import { GhostLayer } from "./GhostLayer";
import { ResizeHandle } from "./ResizeHandle";

// ============================================
// Pane Component
// ============================================

export interface PaneProps {
  /** Unique identifier for the pane */
  id: string;
  /** Whether this pane should flex to fill remaining space */
  flex?: boolean;
  /** Content */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Minimum size */
  minSize?: number;
  /** Maximum size */
  maxSize?: number;
}

/**
 * Individual pane within a SplitGroup
 */
export const Pane: React.FC<PaneProps> = memo(
  ({ children, className = "" }) => {
    return (
      <div className={`split-pane h-full w-full overflow-hidden ${className}`}>
        {children}
      </div>
    );
  }
);

Pane.displayName = "Pane";

// ============================================
// SplitHandle Component (internal)
// ============================================

interface SplitHandleProps {
  axis: ResizeAxis;
  index: number;
  onMouseDown: (event: React.MouseEvent, index: number) => void;
  isResizing: boolean;
}

const SplitHandle: React.FC<SplitHandleProps> = memo(
  ({ axis, index, onMouseDown, isResizing }) => {
    const handleMouseDown = useCallback(
      (event: React.MouseEvent) => {
        onMouseDown(event, index);
      },
      [onMouseDown, index]
    );

    return (
      <ResizeHandle
        axis={axis}
        isResizing={isResizing}
        onMouseDown={handleMouseDown}
      />
    );
  }
);

SplitHandle.displayName = "SplitHandle";

// ============================================
// SplitGroup Component
// ============================================

export const SplitGroup: React.FC<SplitGroupProps> = memo(
  ({
    axis,
    children,
    sizes,
    sizeUnit = "pixels",
    onSizesChange,
    panes = [],
    className = "",
  }) => {
    const groupId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const { lock, unlock, isResizing: globalIsResizing } = useResizeManager();

    // Track resize state (ref for event handlers, state for rendering)
    const resizeIndexRef = useRef<number | null>(null);
    const startSizesRef = useRef<number[]>([]);
    const startPosRef = useRef(0);
    const [activeResizeIndex, setActiveResizeIndex] = useState<number | null>(
      null
    );

    // Cleanup drag listeners on unmount
    useEffect(() => {
      return () => {
        dragCleanupRef.current?.();
      };
    }, []);

    // Convert children to array
    const childArray = useMemo(() => Children.toArray(children), [children]);

    /**
     * Get pane config by index
     */
    const getPaneConfig = useCallback(
      (index: number) => {
        return (
          panes[index] || {
            id: `pane-${index}`,
            min: 50,
            max: Infinity,
          }
        );
      },
      [panes]
    );

    /**
     * Handle resize start
     */
    const handleMouseDown = useCallback(
      (event: React.MouseEvent, index: number) => {
        if (globalIsResizing) return;

        event.preventDefault();
        event.stopPropagation();

        resizeIndexRef.current = index;
        setActiveResizeIndex(index);
        startSizesRef.current = [...sizes];
        startPosRef.current = axis === "x" ? event.clientX : event.clientY;

        // Create session
        const session: ResizeSession = {
          id: `${groupId}-split-${index}`,
          startPos: startPosRef.current,
          startSize: sizes[index],
          axis,
          startTime: Date.now(),
        };

        lock(session);

        // Show ghost
        if (ghostRef.current) {
          ghostRef.current.style.display = "block";
        }

        /**
         * Handle mouse move
         */
        const handleMove = (moveEvent: MouseEvent) => {
          if (resizeIndexRef.current === null) return;

          const currentPos =
            axis === "x" ? moveEvent.clientX : moveEvent.clientY;
          const delta = currentPos - startPosRef.current;
          const idx = resizeIndexRef.current;

          // Get pane configs
          const leftConfig = getPaneConfig(idx);
          const rightConfig = getPaneConfig(idx + 1);

          // Calculate new sizes
          const leftOriginal = startSizesRef.current[idx];
          const rightOriginal = startSizesRef.current[idx + 1];

          let leftNew = leftOriginal + delta;
          let rightNew = rightOriginal - delta;

          // Apply constraints
          const leftMin = leftConfig.min ?? 50;
          const leftMax = leftConfig.max ?? Infinity;
          const rightMin = rightConfig.min ?? 50;
          const rightMax = rightConfig.max ?? Infinity;

          // Clamp left
          if (leftNew < leftMin) {
            const diff = leftMin - leftNew;
            leftNew = leftMin;
            rightNew = rightNew + diff;
          }
          if (leftNew > leftMax) {
            const diff = leftNew - leftMax;
            leftNew = leftMax;
            rightNew = rightNew + diff;
          }

          // Clamp right
          if (rightNew < rightMin) {
            const diff = rightMin - rightNew;
            rightNew = rightMin;
            leftNew = leftNew - diff;
          }
          if (rightNew > rightMax) {
            const diff = rightNew - rightMax;
            rightNew = rightMax;
            leftNew = leftNew + diff;
          }

          // Final clamp
          leftNew = Math.max(leftMin, Math.min(leftMax, leftNew));
          rightNew = Math.max(rightMin, Math.min(rightMax, rightNew));

          // Update sizes
          const newSizes = [...startSizesRef.current];
          newSizes[idx] = leftNew;
          newSizes[idx + 1] = rightNew;

          // Update via callback (for real-time preview)
          onSizesChange(newSizes);
        };

        /**
         * Handle mouse up
         */
        const handleEnd = () => {
          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", handleEnd);
          dragCleanupRef.current = null;

          // Hide ghost
          if (ghostRef.current) {
            ghostRef.current.style.display = "none";
          }

          unlock();
          resizeIndexRef.current = null;
          setActiveResizeIndex(null);
        };

        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleEnd);

        dragCleanupRef.current = () => {
          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", handleEnd);
          if (ghostRef.current) {
            ghostRef.current.style.display = "none";
          }
          unlock();
          resizeIndexRef.current = null;
          setActiveResizeIndex(null);
        };
      },
      [
        axis,
        sizes,
        onSizesChange,
        globalIsResizing,
        lock,
        unlock,
        groupId,
        getPaneConfig,
      ]
    );

    /**
     * Calculate pane styles
     */
    const getPaneStyle = useCallback(
      (index: number): React.CSSProperties => {
        const size = sizes[index];

        if (sizeUnit === "flex") {
          return { flex: size };
        }

        return {
          [axis === "x" ? "width" : "height"]: size,
          flexShrink: 0,
        };
      },
      [axis, sizes, sizeUnit]
    );

    return (
      <div
        ref={containerRef}
        className={`split-group flex h-full w-full overflow-hidden ${
          axis === "x" ? "flex-row" : "flex-col"
        } ${className}`}
      >
        {/* Ghost overlay */}
        <GhostLayer ref={ghostRef} axis={axis} />

        {childArray.map((child, index) => (
          <React.Fragment key={index}>
            {/* Pane */}
            <div
              className="split-pane-wrapper overflow-hidden"
              style={getPaneStyle(index)}
            >
              {child}
            </div>

            {/* Handle (between panes) */}
            {index < childArray.length - 1 && (
              <SplitHandle
                axis={axis}
                index={index}
                onMouseDown={handleMouseDown}
                isResizing={activeResizeIndex === index}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }
);

SplitGroup.displayName = "SplitGroup";

export default SplitGroup;
