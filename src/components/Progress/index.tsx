/**
 * Progress Component
 *
 * Native progress indicator with clean styling.
 *
 * Features:
 * - Linear and circular progress
 * - Percentage display
 * - Status colors (success, error, warning, normal)
 * - Multiple sizes
 * - Custom colors
 * - Animation support
 *
 * @example
 * ```tsx
 * import Progress from "@src/components/Progress";
 *
 * // Linear progress
 * <Progress percent={50} />
 *
 * // Circular progress
 * <Progress type="circle" percent={75} />
 *
 * // With status
 * <Progress percent={100} status="success" />
 * ```
 */
import React from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./index.scss";

export interface ProgressProps {
  /**
   * Progress percentage (0-100)
   */
  percent?: number;

  /**
   * Progress type
   * @default 'line'
   */
  type?: "line" | "circle";

  /**
   * Status
   */
  status?: "success" | "error" | "warning" | "normal";

  /**
   * Show percentage text
   * @default true
   */
  showText?: boolean;

  /**
   * Size
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Stroke color
   */
  strokeColor?: string;

  /**
   * Trail color (background)
   */
  trailColor?: string;

  /**
   * Stroke width (for line type)
   */
  strokeWidth?: number;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;
}

const Progress: React.FC<ProgressProps> = ({
  percent = 0,
  type = "line",
  status,
  showText = true,
  size = "default",
  strokeColor,
  trailColor,
  strokeWidth,
  className = "",
  style,
}) => {
  const { isDark } = useCurrentTheme();

  // Clamp percent between 0 and 100
  const clampedPercent = Math.max(0, Math.min(100, percent));

  // Determine status color
  const getStatusColor = (): string => {
    if (strokeColor) return strokeColor;
    if (status === "success") return "var(--color-success-6)";
    if (status === "error") return "var(--color-danger-6)";
    if (status === "warning") return "var(--color-warning-6)";
    return "var(--color-primary-6)";
  };

  const progressClasses = [
    "progress",
    `progress-${type}`,
    `progress-size-${size}`,
    status && `progress-${status}`,
    isDark && "progress-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const LINE_STROKE_WIDTH: Record<string, number> = {
    mini: 4,
    small: 6,
    large: 10,
    default: 8,
  };
  const CIRCLE_RADIUS: Record<string, number> = {
    mini: 20,
    small: 30,
    large: 50,
    default: 40,
  };
  const CIRCLE_STROKE_WIDTH: Record<string, number> = {
    mini: 4,
    small: 5,
    large: 8,
    default: 6,
  };

  // Render linear progress
  if (type === "line") {
    const defaultStrokeWidth =
      LINE_STROKE_WIDTH[size] ?? LINE_STROKE_WIDTH.default;
    const finalStrokeWidth = strokeWidth || defaultStrokeWidth;

    return (
      <div className={progressClasses} style={style}>
        <div
          className="progress-rail"
          style={{
            height: `${finalStrokeWidth}px`,
            backgroundColor:
              trailColor ||
              (isDark ? "var(--color-fill-4)" : "var(--color-fill-3)"),
          }}
        >
          <div
            className="progress-track"
            style={{
              width: `${clampedPercent}%`,
              backgroundColor: getStatusColor(),
              height: `${finalStrokeWidth}px`,
            }}
          />
        </div>
        {showText && <span className="progress-text">{clampedPercent}%</span>}
      </div>
    );
  }

  // Render circular progress
  const radius = CIRCLE_RADIUS[size] ?? CIRCLE_RADIUS.default;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (clampedPercent / 100) * circumference;
  const defaultStrokeWidth =
    CIRCLE_STROKE_WIDTH[size] ?? CIRCLE_STROKE_WIDTH.default;
  const finalStrokeWidth = strokeWidth || defaultStrokeWidth;

  return (
    <div className={progressClasses} style={style}>
      <svg
        className="progress-circle-svg"
        width={radius * 2 + finalStrokeWidth * 2}
        height={radius * 2 + finalStrokeWidth * 2}
      >
        <circle
          className="progress-circle-trail"
          cx={radius + finalStrokeWidth}
          cy={radius + finalStrokeWidth}
          r={radius}
          fill="none"
          stroke={
            trailColor ||
            (isDark ? "var(--color-fill-4)" : "var(--color-fill-3)")
          }
          strokeWidth={finalStrokeWidth}
        />
        <circle
          className="progress-circle-track"
          cx={radius + finalStrokeWidth}
          cy={radius + finalStrokeWidth}
          r={radius}
          fill="none"
          stroke={getStatusColor()}
          strokeWidth={finalStrokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${radius + finalStrokeWidth} ${radius + finalStrokeWidth})`}
        />
      </svg>
      {showText && (
        <span className="progress-circle-text">{clampedPercent}%</span>
      )}
    </div>
  );
};

export default Progress;
