/**
 * Native Textarea Component
 *
 * Native textarea with native implementation.
 * TextArea.
 *
 * Features:
 * - Full API compatibility
 * - Auto-resize support
 * - Max length with word count
 * - Error states
 * - Resize control
 *
 * @example
 * ```tsx
 * import Textarea from "@src/components/Textarea";
 *
 * <Textarea placeholder="Enter description" />
 * <Textarea autoSize maxLength={500} showWordLimit />
 * ```
 */
import { XCircle } from "lucide-react";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./index.scss";

export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange"
> {
  /**
   * Textarea value (controlled)
   */
  value?: string;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: string;

  /**
   * Change handler (style - receives string directly)
   */
  onChange?: (value: string, e: React.ChangeEvent<HTMLTextAreaElement>) => void;

  /**
   * Textarea size
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Error state
   */
  error?: boolean;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Readonly state
   */
  readOnly?: boolean;

  /**
   * Allow clear button
   */
  allowClear?: boolean;

  /**
   * Max length
   */
  maxLength?: number;

  /**
   * Show word count
   */
  showWordLimit?: boolean;

  /**
   * Auto resize
   * Can be boolean or { minRows, maxRows }
   */
  autoSize?: boolean | { minRows?: number; maxRows?: number };

  /**
   * Resize behavior
   * @default 'vertical'
   */
  resize?: "none" | "vertical" | "horizontal" | "both";

  /**
   * Additional class name for textarea element
   */
  textareaClassName?: string;

  /**
   * Additional style for textarea element
   */
  textareaStyle?: React.CSSProperties;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      value,
      defaultValue,
      onChange,
      size = "default",
      error = false,
      disabled = false,
      readOnly = false,
      allowClear = false,
      maxLength,
      showWordLimit = false,
      autoSize = false,
      resize = "vertical",
      className = "",
      style,
      textareaClassName = "",
      textareaStyle,
      placeholder,
      rows = 3,
      onFocus,
      onBlur,
      onKeyDown,
      ...rest
    },
    ref
  ) => {
    const { isDark } = useCurrentTheme();
    const [internalValue, setInternalValue] = useState(defaultValue || "");
    const [isFocused, setIsFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const isControlled = value !== undefined;
    const currentValue = isControlled ? value : internalValue;

    // Handle ref forwarding
    const setRef = useCallback(
      (element: HTMLTextAreaElement | null) => {
        textareaRef.current = element;
        if (typeof ref === "function") {
          ref(element);
        } else if (ref) {
          ref.current = element;
        }
      },
      [ref]
    );

    // Auto-resize logic
    useEffect(() => {
      if (!autoSize || !textareaRef.current) return;

      const textarea = textareaRef.current;
      textarea.style.height = "auto";

      const config =
        typeof autoSize === "object"
          ? autoSize
          : { minRows: undefined, maxRows: undefined };

      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 20;
      const paddingTop = parseInt(getComputedStyle(textarea).paddingTop) || 0;
      const paddingBottom =
        parseInt(getComputedStyle(textarea).paddingBottom) || 0;

      let newHeight = textarea.scrollHeight;

      if (config.minRows) {
        const minHeight =
          lineHeight * config.minRows + paddingTop + paddingBottom;
        newHeight = Math.max(newHeight, minHeight);
      }

      if (config.maxRows) {
        const maxHeight =
          lineHeight * config.maxRows + paddingTop + paddingBottom;
        newHeight = Math.min(newHeight, maxHeight);
      }

      textarea.style.height = `${newHeight}px`;
    }, [currentValue, autoSize]);

    const wrapperClasses = [
      "textarea-wrapper",
      `textarea-size-${size}`,
      error && "textarea-error",
      disabled && "textarea-disabled",
      isFocused && "textarea-focused",
      readOnly && "textarea-readonly",
      isDark && "textarea-dark",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const textareaClasses = ["textarea", textareaClassName]
      .filter(Boolean)
      .join(" ");

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;

        if (!isControlled) {
          setInternalValue(newValue);
        }

        onChange?.(newValue, e);
      },
      [isControlled, onChange]
    );

    const handleClear = useCallback(() => {
      const syntheticEvent = {
        target: { value: "" },
        currentTarget: { value: "" },
      } as React.ChangeEvent<HTMLTextAreaElement>;

      if (!isControlled) {
        setInternalValue("");
      }

      onChange?.("", syntheticEvent);
    }, [isControlled, onChange]);

    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLTextAreaElement>) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus]
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLTextAreaElement>) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur]
    );

    const tauriSelectAll = useTauriSelectAllShortcut();

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        tauriSelectAll(event);
      },
      [onKeyDown, tauriSelectAll]
    );

    const showClearButton =
      allowClear && currentValue && !disabled && !readOnly;

    const resizeStyle: React.CSSProperties = {
      resize: autoSize ? "none" : resize,
    };

    return (
      <div className={wrapperClasses} style={style}>
        <div className="textarea-inner rounded-lg border border-solid border-border-2 bg-bg-2">
          <textarea
            ref={setRef}
            value={currentValue}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={rows}
            className={textareaClasses}
            style={{ ...resizeStyle, ...textareaStyle }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            {...rest}
          />

          {/* Footer with clear button and word limit */}
          {(showClearButton || (showWordLimit && maxLength)) && (
            <div className="textarea-footer">
              {showClearButton && (
                <button
                  type="button"
                  className="textarea-clear"
                  onClick={handleClear}
                  tabIndex={-1}
                >
                  <XCircle size={16} />
                </button>
              )}

              {showWordLimit && maxLength && (
                <span className="textarea-word-limit">
                  {currentValue?.length || 0}/{maxLength}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export default Textarea;
