/**
 * TerminalTab Configuration Hook
 *
 * Returns tab configuration for the Terminal panel.
 * Uses ActionSystem dispatch for terminal operations.
 */
import {
  TERMINAL_SESSION_LIST_OUTER_CLASS,
  TERMINAL_SESSION_LIST_OUTER_RESIZING_LINE_CLASS,
  TERMINAL_SESSION_LIST_RESIZE_HANDLE_LINE_CLASS,
  type TerminalCoreProps,
  type UseTerminalStateReturn,
  getTerminalDisplayTitle,
} from "@/src/engines/TerminalCore/exports";
import { Bot, Terminal, Trash2 } from "lucide-react";
import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useActionSystem } from "@src/ActionSystem";
import { TreeRowBase } from "@src/components/TreeRow";
import { useResizeHandle } from "@src/hooks/ui/useResizeHandle";
import { HEADER_BUTTON } from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { VerticalResizeHandle } from "@src/scaffold/Resize";

import { ICON_CONFIG } from "../config";
import type { TabAction, TabConfig } from "../types";

// Lazy-load TerminalCore to keep xterm (~300KB) out of the WorkStation initial chunk.
// Only downloaded when the Terminal tab is actually rendered.
const TerminalCore = React.lazy(
  () =>
    import(
      /* webpackChunkName: "terminal-core" */ "@/src/engines/TerminalCore/exports"
    )
);

export interface TerminalTabOptions {
  terminalState: UseTerminalStateReturn;
  repoPath?: string;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onFileLinkOpen?: (filePath: string, line?: number) => void;
  actions: TabAction[];
}

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed);
    } else {
      onCancel();
    }
  }, [value, initialValue, onCommit, onCancel]);

  return (
    <input
      ref={inputRef}
      autoFocus
      className="w-full rounded border border-solid border-primary-6 bg-pane-input px-1 py-0.5 text-[13px] text-text-1 outline-none"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export function useTerminalTabConfig({
  terminalState,
  repoPath,
  sidebarWidth,
  onSidebarWidthChange,
  onFileLinkOpen,
  actions,
}: TerminalTabOptions): TabConfig {
  const { dispatch } = useActionSystem();
  const { t } = useTranslation();
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null
  );

  const {
    handleMouseDown: handleSidebarMouseDown,
    isResizing: isSidebarResizing,
  } = useResizeHandle(sidebarWidth, onSidebarWidthChange, {
    direction: "horizontal",
    minSize: 120,
    maxSize: 300,
    isReversed: true,
  });

  const handleOpenFileLink = useCallback<
    NonNullable<TerminalCoreProps["onOpenFileLink"]>
  >(
    ({ path, line }) => {
      onFileLinkOpen?.(path, line);
    },
    [onFileLinkOpen]
  );

  const content = useMemo(
    () => (
      <div className="flex h-full w-full">
        {/* Terminal core wrapper */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            className="absolute inset-0 overflow-hidden"
            data-action="terminal.execute"
          >
            <Suspense
              fallback={
                <Placeholder
                  variant="loading"
                  placement="sidebar"
                  fillParentHeight
                />
              }
            >
              <TerminalCore
                terminalState={terminalState}
                repoPath={repoPath}
                backgroundColor="var(--cm-editor-background)"
                onOpenFileLink={handleOpenFileLink}
              />
            </Suspense>
          </div>
        </div>

        {/* Terminal sidebar - only show when multiple sessions */}
        {terminalState.sessions.length > 1 && (
          <div
            className={`${TERMINAL_SESSION_LIST_OUTER_CLASS}${
              isSidebarResizing
                ? ` ${TERMINAL_SESSION_LIST_OUTER_RESIZING_LINE_CLASS}`
                : ""
            }`}
          >
            <VerticalResizeHandle
              onMouseDown={handleSidebarMouseDown}
              variant="transparent"
              isResizing={isSidebarResizing}
              className={TERMINAL_SESSION_LIST_RESIZE_HANDLE_LINE_CLASS}
            />
            <div
              className="relative shrink-0"
              style={{ width: `${sidebarWidth}px` }}
            >
              <div className="flex h-full flex-col overflow-auto py-1">
                {terminalState.sessions.map((session) => {
                  const isAgent = !!session.readOnly;
                  const IconComponent = isAgent ? Bot : Terminal;
                  const displayTitle = getTerminalDisplayTitle(session);
                  const isRenaming = renamingSessionId === session.id;

                  return (
                    <div
                      key={session.id}
                      onDoubleClick={() => {
                        if (!isAgent && !isRenaming) {
                          setRenamingSessionId(session.id);
                        }
                      }}
                    >
                      <TreeRowBase
                        node={{
                          id: session.id,
                          name: isRenaming ? "" : displayTitle,
                          path: session.id,
                          type: "file",
                          icon: (
                            <IconComponent
                              size={16}
                              className={
                                session.id === terminalState.activeSessionId
                                  ? "text-text-1"
                                  : "text-text-3"
                              }
                            />
                          ),
                        }}
                        depth={0}
                        isSelected={
                          session.id === terminalState.activeSessionId
                        }
                        onClick={() => {
                          dispatch(
                            "terminal.setActive",
                            { sessionId: session.id },
                            "user"
                          );
                        }}
                        rounded={false}
                      >
                        {isRenaming ? (
                          <InlineRenameInput
                            initialValue={displayTitle}
                            onCommit={(newTitle) => {
                              dispatch(
                                "terminal.rename",
                                {
                                  sessionId: session.id,
                                  title: newTitle,
                                },
                                "user"
                              );
                              setRenamingSessionId(null);
                            }}
                            onCancel={() => setRenamingSessionId(null)}
                          />
                        ) : (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatch(
                                "terminal.close",
                                { sessionId: session.id },
                                "user"
                              );
                            }}
                            className={`${HEADER_BUTTON.danger} hidden shrink-0 group-focus-within/item:flex group-hover/item:flex`}
                            title={t("tooltips.killTerminal")}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </TreeRowBase>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    ),
    [
      terminalState,
      repoPath,
      handleOpenFileLink,
      sidebarWidth,
      handleSidebarMouseDown,
      isSidebarResizing,
      dispatch,
      t,
      renamingSessionId,
    ]
  );

  return {
    key: "terminal",
    icon: ICON_CONFIG.terminal,
    title: "Terminal",
    content,
    actions,
  };
}
