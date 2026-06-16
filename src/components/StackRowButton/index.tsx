import { forwardRef, memo } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import {
  COMPOSER_STACK_ROW_BASE,
  COMPOSER_STACK_ROW_HOVER,
} from "@src/config/composerStackTokens";

export interface StackRowButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  children: ReactNode;
}

const BASE_CLASSES = `${COMPOSER_STACK_ROW_BASE} ${COMPOSER_STACK_ROW_HOVER} w-full cursor-pointer border-0 bg-transparent text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30 disabled:cursor-not-allowed disabled:opacity-50`;

const StackRowButton = memo(
  forwardRef<HTMLButtonElement, StackRowButtonProps>(
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

StackRowButton.displayName = "StackRowButton";

export default StackRowButton;
