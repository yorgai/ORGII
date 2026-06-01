/**
 * Native Spinner Component
 *
 * Native spinner with native implementation.
 *
 *
 * Features:
 * - Full API compatibility
 * - Multiple sizes
 * - Custom colors
 * - Loading overlay
 * - Tip text
 * - Delay support
 *
 * @example
 * ```tsx
 * import Spinner from "@src/components/Spinner";
 *
 * // Simple spinner
 * <Spinner />
 *
 * // With loading overlay
 * <Spinner loading={loading}>
 *   <div>Content</div>
 * </Spinner>
 *
 * // With tip text
 * <Spinner loading tip="Loading...">
 *   <div>Content</div>
 * </Spinner>
 * ```
 */
import { Loader2 } from "lucide-react";
import React, { forwardRef, useEffect, useState } from "react";

import { SPINNER_TOKENS } from "@src/config/spinnerTokens";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./index.scss";

export interface SpinnerProps {
  /**
   * Loading state
   * @default true
   */
  loading?: boolean;

  /**
   * Spinner size
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Custom icon
   */
  icon?: React.ReactNode;

  /**
   * Tip text
   */
  tip?: React.ReactNode;

  /**
   * Delay showing spinner (ms)
   * @default 0
   */
  delay?: number;

  /**
   * Dot style (alternative spinner style)
   */
  dot?: boolean;

  /**
   * Children content (will be wrapped with loading overlay)
   */
  children?: React.ReactNode;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Block mode (full width)
   */
  block?: boolean;
}

const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  (
    {
      loading = true,
      size = "default",
      icon,
      tip,
      delay = 0,
      dot = false,
      children,
      className = "",
      style,
      block = false,
    },
    ref
  ) => {
    const { isDark } = useCurrentTheme();

    // Track delayed show state - only used when delay > 0
    const [delayedShow, setDelayedShow] = useState(false);

    useEffect(() => {
      // Only handle delayed showing
      if (delay > 0 && loading) {
        const timer = setTimeout(() => {
          setDelayedShow(true);
        }, delay);

        return () => {
          clearTimeout(timer);
          setDelayedShow(false);
        };
      }
      // Reset when loading stops (in cleanup, not synchronously)
      return () => {
        setDelayedShow(false);
      };
    }, [loading, delay]);

    // Compute visibility during render (no synchronous setState needed)
    // If no delay, show immediately when loading
    // If delay, wait for delayedShow to be true
    const shouldShow = delay > 0 ? delayedShow : true;
    const isLoading = loading && shouldShow;

    const spinnerClasses = [
      "spinner",
      `spinner-${size}`,
      dot && "spinner-dot",
      isDark && "spinner-dark",
    ]
      .filter(Boolean)
      .join(" ");

    const renderSpinner = () => {
      if (icon) {
        return <div className="spinner-icon">{icon}</div>;
      }

      if (dot) {
        return (
          <div className="spinner-dot-container">
            <span className="spinner-dot-item" />
            <span className="spinner-dot-item" />
            <span className="spinner-dot-item" />
          </div>
        );
      }

      return (
        <Loader2
          className="spinner-icon animate-spin"
          size={SPINNER_TOKENS.default}
        />
      );
    };

    const spinnerElement = (
      <div className={spinnerClasses}>
        {renderSpinner()}
        {tip && <div className="spinner-tip">{tip}</div>}
      </div>
    );

    // If no children, just return the spinner
    if (!children) {
      return (
        <div
          ref={ref}
          className={`spinner-wrapper ${block ? "spinner-block" : ""} ${className}`}
          style={style}
        >
          {isLoading && spinnerElement}
        </div>
      );
    }

    // With children, wrap content with loading overlay
    const containerClasses = [
      "spinner-container",
      isLoading && "spinner-container-loading",
      block && "spinner-block",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div ref={ref} className={containerClasses} style={style}>
        {isLoading && <div className="spinner-overlay">{spinnerElement}</div>}
        <div className={isLoading ? "spinner-content-blur" : ""}>
          {children}
        </div>
      </div>
    );
  }
);

Spinner.displayName = "Spinner";

export default Spinner;

export { Spinner as Spin };
