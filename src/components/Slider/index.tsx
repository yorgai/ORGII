/**
 * Slider Component
 *
 * Native slider/range control with clean styling.
 *
 * Features:
 * - Single value and range (dual handles)
 * - Marks/steps support
 * - Vertical/horizontal orientation
 * - Tooltip on hover/drag
 * - Min/max values
 * - Disabled state
 * - Touch and mouse support
 * - Keyboard navigation
 *
 * @example
 * ```tsx
 * import Slider from "@src/components/Slider";
 *
 * // Single value
 * <Slider
 *   min={0}
 *   max={100}
 *   defaultValue={50}
 *   onChange={(value) => {}}
 * />
 *
 * // Range
 * <Slider
 *   range
 *   min={0}
 *   max={100}
 *   defaultValue={[20, 80]}
 *   onChange={(value) => {}}
 * />
 *
 * // With marks
 * <Slider
 *   marks={{ 0: '0°C', 25: '25°C', 50: '50°C', 75: '75°C', 100: '100°C' }}
 * />
 * ```
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./index.scss";

export interface SliderProps {
  /**
   * Current value (controlled)
   */
  value?: number | [number, number];

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: number | [number, number];

  /**
   * Minimum value
   * @default 0
   */
  min?: number;

  /**
   * Maximum value
   * @default 100
   */
  max?: number;

  /**
   * Step increment
   * @default 1
   */
  step?: number;

  /**
   * Marks to display
   */
  marks?: Record<number, React.ReactNode>;

  /**
   * Range mode (dual handles)
   * @default false
   */
  range?: boolean;

  /**
   * Vertical orientation
   * @default false
   */
  vertical?: boolean;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Show tooltip
   * @default true
   */
  showTooltip?: boolean;

  /**
   * Tooltip formatter
   */
  formatTooltip?: (value: number) => string;

  /**
   * Change callback
   */
  onChange?: (value: number | [number, number]) => void;

  /**
   * After change callback (on mouse up)
   */
  onAfterChange?: (value: number | [number, number]) => void;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Remove default padding
   * @default false
   */
  noPadding?: boolean;

  /**
   * Render the handle(s) with a visible 2px border. Useful when the handle
   * sits on a thin rail against a similarly-colored surface, where the
   * default near-white pill lacks contrast.
   * @default false
   */
  handleBordered?: boolean;
}

const Slider: React.FC<SliderProps> = ({
  value: controlledValue,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  marks,
  range = false,
  vertical = false,
  disabled = false,
  showTooltip = true,
  formatTooltip,
  onChange,
  onAfterChange,
  className = "",
  style,
  noPadding = false,
  handleBordered = false,
}) => {
  const { isDark } = useCurrentTheme();
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<number | null>(null);
  const [showTooltipFor, setShowTooltipFor] = useState<number | null>(null);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // Initialize value
  const getInitialValue = (): number | [number, number] => {
    if (defaultValue !== undefined) return defaultValue;
    return range ? [min, min] : min;
  };

  const [internalValue, setInternalValue] = useState<number | [number, number]>(
    getInitialValue
  );
  const value = controlledValue !== undefined ? controlledValue : internalValue;

  // Normalize value to array
  const normalizedValue = useMemo((): [number, number] => {
    if (Array.isArray(value)) {
      return value as [number, number];
    }
    return [value, value];
  }, [value]);

  // Calculate percentage from value
  const valueToPercent = useCallback(
    (val: number): number => {
      return ((val - min) / (max - min)) * 100;
    },
    [min, max]
  );

  // Calculate value from percentage
  const percentToValue = useCallback(
    (percent: number): number => {
      let val = min + (percent / 100) * (max - min);

      // Snap to step
      if (step > 0) {
        val = Math.round(val / step) * step;
      }

      // Clamp to min/max
      return Math.max(min, Math.min(max, val));
    },
    [min, max, step]
  );

  // Get position from mouse/touch event
  const getPositionFromEvent = useCallback(
    (event: MouseEvent | TouchEvent): number => {
      if (!sliderRef.current) return 0;

      const rect = sliderRef.current.getBoundingClientRect();
      let clientPos: number;

      if ("touches" in event) {
        clientPos = vertical
          ? event.touches[0].clientY
          : event.touches[0].clientX;
      } else {
        clientPos = vertical ? event.clientY : event.clientX;
      }

      const size = vertical ? rect.height : rect.width;
      const offset = vertical ? rect.bottom - clientPos : clientPos - rect.left;

      return Math.max(0, Math.min(100, (offset / size) * 100));
    },
    [vertical]
  );

  // Update value
  const handleValueChange = useCallback(
    (newValue: number | [number, number], final = false) => {
      if (controlledValue === undefined) {
        setInternalValue(newValue);
      }

      onChange?.(newValue);

      if (final) {
        onAfterChange?.(newValue);
      }
    },
    [controlledValue, onChange, onAfterChange]
  );

  // Handle drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, handleIndex: number) => {
      if (disabled) return;

      e.preventDefault();
      setDraggingHandle(handleIndex);
      setShowTooltipFor(handleIndex);

      // Track the current value during dragging to avoid closure issues
      let currentDragValue = value;

      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
        const percent = getPositionFromEvent(moveEvent);
        const newVal = percentToValue(percent);

        if (range) {
          const [val1, val2] = normalizedValue;
          if (handleIndex === 0) {
            currentDragValue = [Math.min(newVal, val2), val2];
            handleValueChange(currentDragValue);
          } else {
            currentDragValue = [val1, Math.max(newVal, val1)];
            handleValueChange(currentDragValue);
          }
        } else {
          currentDragValue = newVal;
          handleValueChange(newVal);
        }
      };

      const handleUp = () => {
        setDraggingHandle(null);
        setShowTooltipFor(null);
        // Use the tracked currentDragValue instead of closure value
        handleValueChange(currentDragValue, true);

        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("touchend", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
      document.addEventListener("touchmove", handleMove);
      document.addEventListener("touchend", handleUp);

      dragCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("touchend", handleUp);
      };
    },
    [
      disabled,
      range,
      normalizedValue,
      getPositionFromEvent,
      percentToValue,
      handleValueChange,
      value,
    ]
  );

  // Handle track click
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || draggingHandle !== null) return;

      const rect = sliderRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clientPos = vertical ? e.clientY : e.clientX;
      const size = vertical ? rect.height : rect.width;
      const offset = vertical ? rect.bottom - clientPos : clientPos - rect.left;
      const percent = (offset / size) * 100;
      const newVal = percentToValue(percent);

      if (range) {
        const [val1, val2] = normalizedValue;
        const mid = (val1 + val2) / 2;

        if (newVal < mid) {
          handleValueChange([newVal, val2], true);
        } else {
          handleValueChange([val1, newVal], true);
        }
      } else {
        handleValueChange(newVal, true);
      }
    },
    [
      disabled,
      draggingHandle,
      vertical,
      percentToValue,
      range,
      normalizedValue,
      handleValueChange,
    ]
  );

  const sliderClasses = [
    "slider",
    vertical && "slider-vertical",
    disabled && "slider-disabled",
    draggingHandle !== null && "slider-dragging",
    isDark && "slider-dark",
    noPadding && "slider-no-padding",
    handleBordered && "slider-handle-bordered",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderHandle = (handleValue: number, handleIndex: number) => {
    const percent = valueToPercent(handleValue);
    const positionStyle = vertical
      ? { bottom: `${percent}%` }
      : { left: `${percent}%` };

    const showTooltipNow =
      showTooltip &&
      (draggingHandle === handleIndex || showTooltipFor === handleIndex);

    return (
      <div
        key={handleIndex}
        className="slider-handle"
        style={positionStyle}
        onMouseDown={(event) => handleMouseDown(event, handleIndex)}
        onTouchStart={(event) => handleMouseDown(event, handleIndex)}
        onMouseEnter={() => setShowTooltipFor(handleIndex)}
        onMouseLeave={() => setShowTooltipFor(null)}
        role="slider"
        aria-valuenow={handleValue}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      >
        {showTooltipNow && (
          <div className="slider-tooltip">
            {formatTooltip ? formatTooltip(handleValue) : handleValue}
          </div>
        )}
      </div>
    );
  };

  const renderTrack = () => {
    if (range) {
      const [val1, val2] = normalizedValue;
      const percent1 = valueToPercent(val1);
      const percent2 = valueToPercent(val2);

      const trackStyle = vertical
        ? { bottom: `${percent1}%`, height: `${percent2 - percent1}%` }
        : { left: `${percent1}%`, width: `${percent2 - percent1}%` };

      return <div className="slider-track" style={trackStyle} />;
    } else {
      const percent = valueToPercent(normalizedValue[0]);
      const trackStyle = vertical
        ? { bottom: 0, height: `${percent}%` }
        : { left: 0, width: `${percent}%` };

      return <div className="slider-track" style={trackStyle} />;
    }
  };

  const renderMarks = () => {
    if (!marks) return null;

    return (
      <div className="slider-marks">
        {Object.entries(marks).map(([markValue, markLabel]) => {
          const val = Number(markValue);
          const percent = valueToPercent(val);
          const positionStyle = vertical
            ? { bottom: `${percent}%` }
            : { left: `${percent}%` };

          return (
            <div key={val} className="slider-mark" style={positionStyle}>
              <div className="slider-mark-dot" />
              <div className="slider-mark-label">{markLabel}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={sliderClasses} style={style}>
      <div ref={sliderRef} className="slider-rail" onClick={handleTrackClick}>
        {renderTrack()}
        {range ? (
          <>
            {renderHandle(normalizedValue[0], 0)}
            {renderHandle(normalizedValue[1], 1)}
          </>
        ) : (
          renderHandle(normalizedValue[0], 0)
        )}
        {renderMarks()}
      </div>
    </div>
  );
};

export default Slider;
