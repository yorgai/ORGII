/**
 * AnimatedTitle Component
 *
 * Displays a large centered title that optionally fades out
 * and reveals a smaller header at top.
 */
import React from "react";

import type { AnimatedTitleProps } from "../types";

export const AnimatedTitle: React.FC<AnimatedTitleProps> = ({
  title,
  subtitle,
  persistent = false,
  hideSmallTitle = false,
}) => {
  const [showBigTitle, setShowBigTitle] = React.useState(true);

  React.useEffect(() => {
    if (!persistent) {
      const timer = setTimeout(() => {
        setShowBigTitle(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [persistent]);

  return (
    <>
      {/* Small title at top - shows after big title fades (unless hideSmallTitle is true) */}
      {!hideSmallTitle && (
        <div
          className={`absolute left-6 right-6 top-6 z-10 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold uppercase tracking-wider text-text-2 transition-opacity duration-[600ms] ${
            showBigTitle ? "opacity-0" : "opacity-100"
          }`}
        >
          {title}
        </div>
      )}

      {/* Big animated title - fades out after 2s (unless persistent) */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 z-[100] w-[90%] max-w-[600px] -translate-x-1/2 -translate-y-1/2 text-center transition-opacity duration-[600ms] ${
          showBigTitle || persistent ? "opacity-100" : "opacity-0"
        }`}
      >
        <h1 className="mb-3 whitespace-normal text-3xl font-semibold leading-tight tracking-tight text-text-1">
          {title}
        </h1>
        {subtitle && (
          <p className="whitespace-normal text-base font-normal leading-relaxed text-text-2">
            {subtitle}
          </p>
        )}
      </div>
    </>
  );
};
