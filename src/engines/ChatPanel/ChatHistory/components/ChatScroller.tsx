import React, { forwardRef } from "react";
import type { Components } from "react-virtuoso";

type ChatScrollerComponent = NonNullable<Components["Scroller"]>;

interface ChatScrollerProps {
  virtuosoScrollerRef: React.MutableRefObject<HTMLElement | null>;
}

/**
 * Custom Virtuoso Scroller component. Hides the native scrollbar and wires
 * an external ref so scroll-pin logic can attach event listeners directly.
 */
export function createChatScroller(
  virtuosoScrollerRef: React.MutableRefObject<HTMLElement | null>
): ChatScrollerComponent {
  const Component = forwardRef<
    HTMLDivElement,
    React.ComponentProps<ChatScrollerComponent>
  >(function ChatScrollerInstance(props, forwardedRef) {
    const { context: _context, ...restProps } = props;
    return (
      <div
        {...restProps}
        className="scrollbar-hide"
        ref={(node) => {
          virtuosoScrollerRef.current = node;
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef) {
            forwardedRef.current = node;
          }
        }}
      />
    );
  });
  Component.displayName = "ChatScroller";
  return Component;
}

export type { ChatScrollerProps };
