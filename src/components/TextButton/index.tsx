import { forwardRef, memo } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface TextButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  children: ReactNode;
}

const BASE_CLASSES =
  "cursor-pointer border-0 bg-transparent p-0 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30 disabled:cursor-not-allowed disabled:opacity-50";

const TextButton = memo(
  forwardRef<HTMLButtonElement, TextButtonProps>(
    ({ htmlType = "button", className = "", children, ...props }, ref) => (
      <button
        ref={ref}
        type={htmlType}
        className={`${BASE_CLASSES} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    )
  )
);

TextButton.displayName = "TextButton";

export default TextButton;
