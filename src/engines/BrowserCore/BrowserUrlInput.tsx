/**
 * BrowserUrlInput Component
 *
 * A liquid glass-styled URL input field for the browser toolbar.
 * Displays URL in center when not focused, expands to full input when focused.
 *
 * Features:
 * - Centered URL display with icon (unfocused state)
 * - Full-width input with left icon (focused state)
 * - Auto-select text on focus
 * - URL normalization (adds https://, or searches Google)
 * - Loading indicator
 */
import { Globe, Loader2 } from "lucide-react";
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";

import { LIQUID_GLASS_HOVER } from "@src/components/LiquidGlass/hoverConfig";
import { LiquidGlassToolbar } from "@src/components/LiquidGlassToolbar";
import { useSafeHoverCallbacks } from "@src/hooks/ui/useSafeHover";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";
import { normalizeBrowserInput } from "@src/util/url/browserUrl";

interface BrowserUrlInputProps {
  /** Current URL */
  url: string;
  /** Whether the browser is loading */
  isLoading?: boolean;
  /** Called when user navigates to a new URL */
  onNavigate: (url: string) => void;
  /** Custom className */
  className?: string;
}

const BrowserUrlInput: React.FC<BrowserUrlInputProps> = ({
  url,
  isLoading = false,
  onNavigate,
  className = "",
}) => {
  const { isDark } = useCurrentTheme();
  const [inputValue, setInputValue] = useState(url);
  const [isFocused, setIsFocused] = useState(false);
  const { isHovered, onMouseEnter, onMouseLeave } = useSafeHoverCallbacks();
  const [prevUrl, setPrevUrl] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input with external URL changes (only when not focused)
  // Using React's documented pattern: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (url !== prevUrl) {
    setPrevUrl(url);
    if (!isFocused) {
      setInputValue(url);
    }
  }

  // Track last navigated URL to update ref in callbacks
  const lastNavigatedUrlRef = useRef(url);
  useLayoutEffect(() => {
    lastNavigatedUrlRef.current = url;
  }, [url]);

  // Handle focus - select all text for easy replacement
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setTimeout(() => {
      inputRef.current?.select();
    }, 50);
  }, []);

  // Exit edit mode but keep the user's changes
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Keep the inputValue as-is (don't reset to original URL)
    // This allows users to edit and exit without losing their changes
  }, []);

  // Handle navigation
  const handleNavigate = useCallback(() => {
    const normalizedUrl = normalizeBrowserInput(inputValue);
    if (!normalizedUrl) return;

    setInputValue(normalizedUrl);
    setPrevUrl(normalizedUrl);
    onNavigate(normalizedUrl);

    // Blur the input to return to centered display
    inputRef.current?.blur();
    setIsFocused(false);
  }, [inputValue, onNavigate]);

  // Handle key press
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        handleNavigate();
      }
    },
    [handleNavigate]
  );

  return (
    <div className={`relative flex h-[36px] flex-1 items-center ${className}`}>
      <LiquidGlassToolbar
        height={36}
        radius={100}
        padding="0"
        gap={0}
        intensity="default"
        className="relative w-full cursor-text"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={() => {
          if (!isFocused) {
            inputRef.current?.focus();
          }
        }}
      >
        {/* Liquid Glass Hover Overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              isHovered && !isFocused
                ? isDark
                  ? LIQUID_GLASS_HOVER.dark
                  : LIQUID_GLASS_HOVER.light
                : "transparent",
            transition: "background 0.15s ease",
            pointerEvents: "none",
            borderRadius: "inherit",
          }}
        />

        {/* Centered display when not focused */}
        {!isFocused && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 px-3">
            {isLoading ? (
              <Loader2
                className="animate-spin text-[14px] text-text-3"
                size={14}
              />
            ) : (
              <Globe className="text-[14px] text-text-3" size={14} />
            )}
            <span
              className="max-w-[300px] truncate text-[13px] text-text-1"
              style={{ fontFamily: "var(--code-font-family)" }}
            >
              {inputValue || "Enter URL or search..."}
            </span>
          </div>
        )}

        {/* Icon on left when focused */}
        {isFocused && (
          <div className="absolute left-2 z-10 flex items-center">
            {isLoading ? (
              <Loader2
                className="animate-spin text-[14px] text-text-3"
                size={14}
              />
            ) : (
              <Globe className="text-[14px] text-text-3" size={14} />
            )}
          </div>
        )}

        {/* Native input - always rendered but hidden when not focused */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL or search..."
          className={`relative z-10 w-full border-none bg-transparent text-text-1 outline-none ${!isFocused ? "opacity-0" : ""}`}
          style={{
            height: "36px",
            paddingLeft: isFocused ? "32px" : "12px",
            paddingRight: "12px",
            fontFamily: "var(--code-font-family)",
            fontSize: "13px",
          }}
        />
      </LiquidGlassToolbar>
    </div>
  );
};

export default BrowserUrlInput;
