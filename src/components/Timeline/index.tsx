/**
 * Timeline Component
 *
 * Vertical timeline for displaying chronological information.
 *
 *
 * Features:
 * - Vertical/horizontal modes
 * - Custom dot icons
 * - Multiple dot colors
 * - Pending state
 * - Reverse order
 *
 * @example
 * ```tsx
 * import Timeline from "@src/components/Timeline";
 *
 * <Timeline>
 *   <Timeline.Item>Create project</Timeline.Item>
 *   <Timeline.Item>Initial commit</Timeline.Item>
 *   <Timeline.Item dot={<i className="ri-check-line" />}>
 *     First release
 *   </Timeline.Item>
 * </Timeline>
 * ```
 */
import { Loader2 } from "lucide-react";
import React from "react";

import "./index.scss";

// Timeline Item Props
export interface TimelineItemProps {
  /**
   * Custom dot content
   */
  dot?: React.ReactNode;

  /**
   * Dot color
   * @default 'primary'
   */
  dotColor?: "primary" | "success" | "warning" | "danger" | "default" | string;

  /**
   * Dot type
   * @default 'default'
   */
  dotType?: "default" | "hollow";

  /**
   * Label (timestamp or metadata)
   */
  label?: React.ReactNode;

  /**
   * Line type
   * @default 'solid'
   */
  lineType?: "solid" | "dashed" | "dotted";

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children
   */
  children?: React.ReactNode;
}

// Timeline Props
export interface TimelineProps {
  /**
   * Timeline mode
   * @default 'left'
   */
  mode?: "left" | "right" | "alternate";

  /**
   * Pending state (show loading at end)
   * @default false
   */
  pending?: boolean;

  /**
   * Pending dot content
   */
  pendingDot?: React.ReactNode;

  /**
   * Reverse order
   * @default false
   */
  reverse?: boolean;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children (Timeline.Item components)
   */
  children?: React.ReactNode;
}

// Timeline Item Component
const TimelineItem: React.FC<TimelineItemProps> = ({
  dot,
  dotColor = "primary",
  dotType = "default",
  label,
  lineType = "solid",
  className = "",
  style,
  children,
}) => {
  const isPredefinedColor = [
    "primary",
    "success",
    "warning",
    "danger",
    "default",
  ].includes(dotColor);

  const itemClasses = [
    "timeline-item",
    `timeline-item-dot-${dotType}`,
    isPredefinedColor && `timeline-item-dot-${dotColor}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const dotStyle = !isPredefinedColor
    ? { backgroundColor: dotColor, borderColor: dotColor }
    : undefined;

  return (
    <div className={itemClasses} style={style}>
      <div className="timeline-item-tail" data-line-type={lineType} />
      <div className="timeline-item-dot" style={dotStyle}>
        {dot || <span className="timeline-item-dot-inner" />}
      </div>
      <div className="timeline-item-content">
        {label && <div className="timeline-item-label">{label}</div>}
        <div className="timeline-item-description">{children}</div>
      </div>
    </div>
  );
};

// Main Timeline Component
const Timeline: React.FC<TimelineProps> & {
  Item: typeof TimelineItem;
} = ({
  mode = "left",
  pending = false,
  pendingDot,
  reverse = false,
  className = "",
  style,
  children,
}) => {
  const timelineClasses = ["timeline", `timeline-mode-${mode}`, className]
    .filter(Boolean)
    .join(" ");

  const childrenArray = React.Children.toArray(children);
  const orderedChildren = reverse
    ? [...childrenArray].reverse()
    : childrenArray;

  return (
    <div className={timelineClasses} style={style}>
      {orderedChildren}
      {pending && (
        <div className="timeline-item timeline-item-pending">
          <div className="timeline-item-tail" />
          <div className="timeline-item-dot">
            {pendingDot || (
              <Loader2
                className="timeline-item-pending-icon animate-spin"
                size={16}
              />
            )}
          </div>
          <div className="timeline-item-content">
            <div className="timeline-item-description">Loading...</div>
          </div>
        </div>
      )}
    </div>
  );
};

Timeline.Item = TimelineItem;

export default Timeline;
