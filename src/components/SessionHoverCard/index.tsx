import React, { useCallback } from "react";

import HoverCardBase, { type HoverCardPosition } from "./HoverCardBase";
import { SessionHoverCardContent } from "./SessionHoverCardContent";

interface SessionHoverCardProps {
  sessionId?: string | null;
  children: React.ReactElement;
  position?: HoverCardPosition;
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
}

const SessionHoverCard: React.FC<SessionHoverCardProps> = ({
  sessionId,
  children,
  position,
  mouseEnterDelay,
  mouseLeaveDelay,
}) => {
  const renderContent = useCallback(
    (cardId: string) => <SessionHoverCardContent sessionId={cardId} />,
    []
  );

  return (
    <HoverCardBase
      cardId={sessionId}
      position={position}
      mouseEnterDelay={mouseEnterDelay}
      mouseLeaveDelay={mouseLeaveDelay}
      renderContent={renderContent}
    >
      {children}
    </HoverCardBase>
  );
};

export default SessionHoverCard;
