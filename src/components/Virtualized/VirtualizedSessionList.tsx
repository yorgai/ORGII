/**
 * VirtualizedSessionList - High-performance virtualized list for sessions
 * Uses react-virtuoso for rendering only visible items
 */
import React from "react";
import { Virtuoso } from "react-virtuoso";

export interface SessionListItem {
  id: string;
  name: string;
  repoName?: string;
  updatedAt: string;
  status?: string;
}

interface VirtualizedSessionListProps {
  sessions: SessionListItem[];
  onSessionClick: (session: SessionListItem) => void;
  height: number;
  itemHeight?: number;
  emptyMessage?: string;
  className?: string;
}

export const VirtualizedSessionList: React.FC<VirtualizedSessionListProps> = ({
  sessions,
  onSessionClick,
  height,
  itemHeight = 60,
  emptyMessage = "No sessions found",
  className = "",
}) => {
  // Item renderer for react-virtuoso
  const itemContent = React.useCallback(
    (index: number) => {
      const session = sessions[index];

      return (
        <div
          className={`session-list-item ${className}`}
          onClick={() => onSessionClick(session)}
        >
          <div className="session-item-content">
            <div className="session-item-header">
              <span className="session-item-name">{session.name}</span>
              {session.status && (
                <span
                  className={`session-item-status status-${session.status}`}
                >
                  {session.status}
                </span>
              )}
            </div>
            {session.repoName && (
              <div className="session-item-project">{session.repoName}</div>
            )}
            <div className="session-item-time">
              {new Date(session.updatedAt).toLocaleString()}
            </div>
          </div>
        </div>
      );
    },
    [sessions, className, onSessionClick]
  );

  if (sessions.length === 0) {
    return (
      <div className="session-list-empty" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <Virtuoso
      style={{ height }}
      data={sessions}
      itemContent={itemContent}
      className={className}
      fixedItemHeight={itemHeight}
    />
  );
};

export default VirtualizedSessionList;
