/**
 * PreContent - Pre-formatted (whitespace-pre-wrap) content wrapper.
 *
 * Thin styled wrapper used for error details, long text blocks, and other
 * pre-formatted output in both chat and simulator variant renderers.
 */
import { ReactNode, memo, useMemo } from "react";

export interface PreContentProps {
  children: ReactNode;
  className?: string;
}

export const PreContent = memo<PreContentProps>(
  ({ children, className = "text-text-2" }) => {
    const fullClassName = useMemo(
      () => `whitespace-pre-wrap ${className}`,
      [className]
    );

    return <pre className={fullClassName}>{children}</pre>;
  },
  (prev, next) => {
    if (prev.className !== next.className) return false;
    if (prev.children !== next.children) return false;
    return true;
  }
);
PreContent.displayName = "PreContent";

export default PreContent;
