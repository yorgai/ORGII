import React, {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { SessionHoverCardContent } from "./SessionHoverCardContent";
import {
  allocateInstanceId,
  cancelPendingClose,
  isGroupWarm,
  openCard,
  scheduleClose,
  useHoverCardState,
} from "./singletonStore";

type HoverCardPosition = "bottom-start" | "right-start";

const DEFAULT_MOUSE_ENTER_DELAY_MS = 150;
const DEFAULT_MOUSE_LEAVE_DELAY_MS = 100;
const DEFAULT_POSITION: HoverCardPosition = "bottom-start";
const VIEWPORT_PADDING_PX = 8;
const TRIGGER_GAP_PX = 8;

interface SessionHoverCardProps {
  sessionId?: string | null;
  children: React.ReactElement;
  position?: HoverCardPosition;
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
}

interface SessionHoverCardTriggerProps {
  instanceId: number;
  sessionId: string;
  position: HoverCardPosition;
  mouseEnterDelay: number;
  mouseLeaveDelay: number;
  children: React.ReactElement;
}

interface SessionHoverCardPortalProps {
  instanceId: number;
  sessionId: string;
  position: HoverCardPosition;
}

type ElementProps = {
  ref?: React.Ref<HTMLElement>;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  [key: string]: unknown;
};

function applyRef(
  ref: React.Ref<HTMLElement> | undefined,
  node: HTMLElement | null
): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(node);
  } else {
    (ref as React.MutableRefObject<HTMLElement | null>).current = node;
  }
}

function computePortalStyle(
  rect: DOMRect,
  position: HoverCardPosition,
  cardWidth: number,
  cardHeight: number
): React.CSSProperties {
  let top = 0;
  let left = 0;

  if (position === "right-start") {
    top = rect.top;
    left = rect.right + TRIGGER_GAP_PX;

    if (
      cardWidth > 0 &&
      left + cardWidth > window.innerWidth - VIEWPORT_PADDING_PX
    ) {
      const leftSide = rect.left - cardWidth - TRIGGER_GAP_PX;
      if (leftSide >= VIEWPORT_PADDING_PX) {
        left = leftSide;
      }
    }
  } else {
    top = rect.bottom + TRIGGER_GAP_PX;
    left = rect.left;
  }

  if (cardWidth > 0) {
    left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(left, window.innerWidth - cardWidth - VIEWPORT_PADDING_PX)
    );
  }
  if (cardHeight > 0) {
    top = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(top, window.innerHeight - cardHeight - VIEWPORT_PADDING_PX)
    );
  }

  return { position: "fixed", top, left, zIndex: 1000 };
}

const SessionHoverCardTrigger: React.FC<SessionHoverCardTriggerProps> = ({
  instanceId,
  sessionId,
  position,
  mouseEnterDelay,
  mouseLeaveDelay,
  children,
}) => {
  const triggerRef = useRef<HTMLElement | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEnterTimer = useCallback(() => {
    if (enterTimerRef.current !== null) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearEnterTimer();
      cancelPendingClose();
      scheduleClose(instanceId, 0);
    };
  }, [clearEnterTimer, instanceId]);

  const openWithDelay = useCallback(() => {
    clearEnterTimer();
    const node = triggerRef.current;
    if (!node) return;
    const warm = isGroupWarm();
    const delay = warm ? 0 : mouseEnterDelay;
    const run = () => {
      enterTimerRef.current = null;
      const current = triggerRef.current;
      if (!current) return;
      openCard(
        instanceId,
        sessionId,
        current.getBoundingClientRect(),
        position
      );
    };
    if (delay <= 0) {
      run();
    } else {
      enterTimerRef.current = setTimeout(run, delay);
    }
  }, [clearEnterTimer, instanceId, mouseEnterDelay, position, sessionId]);

  const handleLeave = useCallback(() => {
    clearEnterTimer();
    scheduleClose(instanceId, mouseLeaveDelay);
  }, [clearEnterTimer, instanceId, mouseLeaveDelay]);

  const originalProps =
    (children.props as ElementProps | undefined) ?? ({} as ElementProps);
  const originalRef = (children as unknown as { ref?: React.Ref<HTMLElement> })
    .ref;

  const composedRef = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      applyRef(originalRef, node);
    },
    [originalRef]
  );

  // eslint-disable-next-line react-hooks/refs
  return cloneElement(children, {
    ref: composedRef,
    onMouseEnter: (e: React.MouseEvent) => {
      openWithDelay();
      originalProps.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleLeave();
      originalProps.onMouseLeave?.(e);
    },
  } as ElementProps);
};

const CARD_LEAVE_DELAY_MS = 80;

const SessionHoverCardPortal: React.FC<SessionHoverCardPortalProps> = ({
  instanceId,
  sessionId,
  position,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const { triggerRect } = useHoverCardState();

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width !== cardSize.width || rect.height !== cardSize.height) {
      setCardSize({ width: rect.width, height: rect.height });
    }
  }, [sessionId, triggerRect, cardSize.height, cardSize.width]);

  if (!triggerRect) return null;

  const style = computePortalStyle(
    triggerRect,
    position,
    cardSize.width,
    cardSize.height
  );

  return createPortal(
    <div
      ref={cardRef}
      data-session-hover-card="true"
      style={style}
      onMouseEnter={cancelPendingClose}
      onMouseLeave={() => scheduleClose(instanceId, CARD_LEAVE_DELAY_MS)}
    >
      <SessionHoverCardContent sessionId={sessionId} />
    </div>,
    document.body
  );
};

const SessionHoverCard: React.FC<SessionHoverCardProps> = ({
  sessionId,
  children,
  position = DEFAULT_POSITION,
  mouseEnterDelay = DEFAULT_MOUSE_ENTER_DELAY_MS,
  mouseLeaveDelay = DEFAULT_MOUSE_LEAVE_DELAY_MS,
}) => {
  const [instanceId] = useState(allocateInstanceId);
  const { activeInstanceId } = useHoverCardState();

  if (!sessionId || !isValidElement(children)) return children;

  const isActiveOwner = activeInstanceId === instanceId;

  return (
    <>
      <SessionHoverCardTrigger
        instanceId={instanceId}
        sessionId={sessionId}
        position={position}
        mouseEnterDelay={mouseEnterDelay}
        mouseLeaveDelay={mouseLeaveDelay}
      >
        {children}
      </SessionHoverCardTrigger>
      {isActiveOwner && (
        <SessionHoverCardPortal
          instanceId={instanceId}
          sessionId={sessionId}
          position={position}
        />
      )}
    </>
  );
};

export default SessionHoverCard;
