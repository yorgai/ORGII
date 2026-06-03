/**
 * useAtMention
 *
 * Handles @ mention dropdown logic for the InputArea
 */
import type { MenuItemId } from "@/src/scaffold/ContextMenu/config";
import { type MutableRefObject, type RefObject, useCallback } from "react";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import { getTerminalBuffer } from "@src/components/TerminalInteractive/bufferCache";
import { storePillText } from "@src/config/pillTokens";
import {
  loadBrowserPillContent,
  loadSessionPillContent,
  loadWorkItemPillContent,
} from "@src/util/contextPillContent";
import { toBackendPtySessionId } from "@src/util/ui/terminal/ptySessionId";

import type { AtMentionHandlers, CustomMentionOption } from "./types";

interface UseAtMentionOptions {
  tiptapRef: RefObject<TiptapInputRef>;
  hasContentRef: MutableRefObject<boolean>;
  setShowContextMenu: (show: boolean) => void;
  setAtSearchQuery: (query: string) => void;
  handleSelectFile: (file: string) => void;
}

export function useAtMention(options: UseAtMentionOptions): AtMentionHandlers {
  const {
    tiptapRef,
    hasContentRef,
    setShowContextMenu,
    setAtSearchQuery,
    handleSelectFile,
  } = options;

  /**
   * Handle @ mention from TiptapInput
   */
  const handleAtMention = useCallback(
    (query: string, _position: { x: number; y: number }) => {
      setShowContextMenu(true);
      setAtSearchQuery(query);
    },
    [setShowContextMenu, setAtSearchQuery]
  );

  /**
   * Handle @ mention close
   */
  const handleAtMentionClose = useCallback(() => {
    setShowContextMenu(false);
    setAtSearchQuery("");
  }, [setShowContextMenu, setAtSearchQuery]);

  /**
   * Handle @ select - insert appropriate pill based on type
   */
  const handleAtSelect = useCallback(
    (type: MenuItemId | string, value?: string, displayName?: string) => {
      if (!tiptapRef.current || !value) {
        console.warn("[handleAtSelect] Missing tiptapRef or value", {
          tiptapRef: !!tiptapRef.current,
          value,
        });
        setShowContextMenu(false);
        setAtSearchQuery("");
        return;
      }

      // Resolve display name from value if not provided
      const resolvedDisplayName =
        displayName || value.split("/").pop() || value;

      switch (type) {
        case "files":
          handleSelectFile(value);
          break;
        case "repo":
          // Insert repo pill (path = repo path, displayName = repo name)
          tiptapRef.current.insertFilePill(
            value,
            false,
            "repo",
            resolvedDisplayName
          );
          hasContentRef.current = true;
          break;
        case "branch":
          // Insert branch pill (path = repoPath|branchName for serialization)
          tiptapRef.current.insertFilePill(
            value,
            false,
            "branch",
            resolvedDisplayName
          );
          hasContentRef.current = true;
          break;
        case "folder":
          // Insert folder pill with folder icon
          tiptapRef.current.insertFilePill(
            value,
            true, // is a folder
            "folder",
            resolvedDisplayName
          );
          hasContentRef.current = true;
          break;
        case "terminals":
        case "terminal": {
          // Unify with paste flow: use terminal:// path + store buffer content
          // Ask all mounted TerminalView instances to snapshot their buffer to cache
          window.dispatchEvent(new Event("terminal-snapshot-request"));
          const ptySessionId = toBackendPtySessionId(value);
          const buffer = getTerminalBuffer(ptySessionId);
          if (buffer) {
            const lineCount = buffer.split("\n").length;
            const pillPath = `terminal://${value}/${Date.now()}`;
            const pillDisplayName =
              lineCount > 1
                ? `${resolvedDisplayName} (1-${lineCount})`
                : resolvedDisplayName;

            storePillText(pillPath, buffer);

            tiptapRef.current.insertFilePill(
              pillPath,
              false,
              "terminal",
              pillDisplayName
            );
          } else {
            tiptapRef.current.insertFilePill(
              value,
              false,
              "terminal",
              resolvedDisplayName
            );
          }
          hasContentRef.current = true;
          break;
        }
        case "sessions":
        case "session": {
          const sessionPillPath = `session://${value}/${Date.now()}`;
          tiptapRef.current.insertFilePill(
            sessionPillPath,
            false,
            "session",
            resolvedDisplayName
          );
          loadSessionPillContent(value, sessionPillPath);
          hasContentRef.current = true;
          break;
        }
        case "browser": {
          const browserPillPath = `browser://${value}/${Date.now()}`;
          tiptapRef.current.insertFilePill(
            browserPillPath,
            false,
            "browser",
            resolvedDisplayName
          );
          loadBrowserPillContent(value, browserPillPath);
          hasContentRef.current = true;
          break;
        }
        case "projects":
        case "project":
          tiptapRef.current.insertFilePill(
            value,
            false,
            "project",
            resolvedDisplayName
          );
          hasContentRef.current = true;
          break;
        case "workitem": {
          const workitemPillPath = `workitem://${value}/${Date.now()}`;
          tiptapRef.current.insertFilePill(
            workitemPillPath,
            false,
            "workitem",
            resolvedDisplayName
          );
          loadWorkItemPillContent(value, workitemPillPath);
          hasContentRef.current = true;
          break;
        }
        case "codebase": {
          // `value` is the full absolute path (repo_path/relative_path)
          // Insert as a regular file pill; the file path is what the agent needs
          tiptapRef.current.insertFilePill(
            value,
            false,
            "file",
            resolvedDisplayName
          );
          hasContentRef.current = true;
          break;
        }
        default:
          break;
      }

      setShowContextMenu(false);
      setAtSearchQuery("");
    },
    [
      tiptapRef,
      hasContentRef,
      handleSelectFile,
      setShowContextMenu,
      setAtSearchQuery,
    ]
  );

  const handleCustomMentionSelect = useCallback(
    (option: CustomMentionOption) => {
      if (!tiptapRef.current) {
        setShowContextMenu(false);
        setAtSearchQuery("");
        return;
      }
      tiptapRef.current.insertFilePill(
        `member://${option.id}`,
        false,
        "member",
        option.label
      );
      hasContentRef.current = true;
      setShowContextMenu(false);
      setAtSearchQuery("");
    },
    [tiptapRef, hasContentRef, setShowContextMenu, setAtSearchQuery]
  );

  return {
    handleAtMention,
    handleAtMentionClose,
    handleAtSelect,
    handleCustomMentionSelect,
  };
}
