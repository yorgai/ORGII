/**
 * ComposerInput
 *
 * Drop-in replacement for `TiptapInput` that drops the ProseMirror/Tiptap
 * dependency. The editor surface is a single `contenteditable` host; pills
 * are mounted as `contenteditable="false"` spans with React Portals
 * rendering the `ComposerPill` UI inside each span. Selection, IME, and
 * caret behavior are delegated to the browser; the heavy logic lives in
 * `useEditorOperations`, `keyboard.ts`, `pasteHandlers.ts`, and
 * `imperativeApi.ts`.
 *
 * The component exposes the same `ComposerInputRef` contract as the old
 * `TiptapInputRef`, so every existing consumer (`useTiptapInput`,
 * `useSlashCommand`, `useDraftManagement`, `inputPreparation`, …) keeps
 * working without any signature changes.
 */
import { useAtomValue } from "jotai";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { installedSkillsAtom } from "@src/store/skills/installedSkillsAtom";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import ComposerPill from "./ComposerPill";
import { buildImperativeApi } from "./imperativeApi";
import "./index.scss";
import { type MentionState, createKeyDownHandler } from "./keyboard";
import { createPasteHandler } from "./pasteHandlers";
import { caretTextOffset, placeCaretAtEnd, rangeInsideHost } from "./selection";
import type { ComposerInputProps, ComposerInputRef } from "./types";
import { useEditorOperations } from "./useEditorOperations";
import { PILL_DATA_ATTR, extractPlainText, sanitizeText } from "./utils";

export type {
  ComposerInputProps,
  ComposerInputRef,
  PillIconType,
} from "./types";

const ComposerInput = forwardRef<ComposerInputRef, ComposerInputProps>(
  function ComposerInput(props, ref) {
    const {
      placeholder = "Type your message...",
      initialContent = "",
      onContentChange,
      onAtMention,
      onAtMentionClose,
      onSubmit,
      requireCmdEnter = true,
      autoFocus = false,
      className = "",
      minHeight = 60,
      maxHeight = 200,
      overflowY,
      editable = true,
      onKeyDownForDropdown,
      onSlashCommand,
      onSlashCommandClose,
      onKeyDownForSlashDropdown,
      onImagePaste,
      onBeforeNewline,
    } = props;

    const { isDark } = useCurrentTheme();
    const installedSkills = useAtomValue(installedSkillsAtom);
    const installedSkillsRef = useRef(installedSkills);
    installedSkillsRef.current = installedSkills;

    const ops = useEditorOperations();
    const { hostRef, pillEntries } = ops;

    // ===== Stale-closure-proof callback refs =====
    const onContentChangeRef = useRef(onContentChange);
    const onAtMentionRef = useRef(onAtMention);
    const onAtMentionCloseRef = useRef(onAtMentionClose);
    const onSubmitRef = useRef(onSubmit);
    const onKeyDownForDropdownRef = useRef(onKeyDownForDropdown);
    const onSlashCommandRef = useRef(onSlashCommand);
    const onSlashCommandCloseRef = useRef(onSlashCommandClose);
    const onKeyDownForSlashDropdownRef = useRef(onKeyDownForSlashDropdown);
    const onImagePasteRef = useRef(onImagePaste);
    const onBeforeNewlineRef = useRef(onBeforeNewline);
    useEffect(() => {
      onContentChangeRef.current = onContentChange;
      onAtMentionRef.current = onAtMention;
      onAtMentionCloseRef.current = onAtMentionClose;
      onSubmitRef.current = onSubmit;
      onKeyDownForDropdownRef.current = onKeyDownForDropdown;
      onSlashCommandRef.current = onSlashCommand;
      onSlashCommandCloseRef.current = onSlashCommandClose;
      onKeyDownForSlashDropdownRef.current = onKeyDownForSlashDropdown;
      onImagePasteRef.current = onImagePaste;
      onBeforeNewlineRef.current = onBeforeNewline;
    });

    // ===== Composition + mention state =====
    const isComposingRef = useRef(false);
    const atMentionRef = useRef<MentionState>({
      active: false,
      startOffset: 0,
    });
    const slashCommandRef = useRef<MentionState>({
      active: false,
      startOffset: 0,
    });

    // ===== Mention/slash reset helper =====
    const resetMentionState = useCallback(() => {
      atMentionRef.current = { active: false, startOffset: 0 };
      slashCommandRef.current = { active: false, startOffset: 0 };
      onAtMentionCloseRef.current?.();
      onSlashCommandCloseRef.current?.();
    }, []);

    // ===== Text/empty state cache =====
    const isEmptyRef = useRef(true);
    const [hostIsEmpty, setHostIsEmpty] = React.useState(true);

    const updateEmptyState = useCallback(() => {
      const empty = ops.isHostEmpty();
      if (empty !== isEmptyRef.current) {
        isEmptyRef.current = empty;
        setHostIsEmpty(empty);
      }
    }, [ops]);

    // ===== Mention-driven update handler =====
    const handleInput = useCallback(
      (nativeEvent?: Event) => {
        const host = hostRef.current;
        if (!host) return;
        ops.reconcilePillsFromDom();

        const text = extractPlainText(host);
        const hasPills = host.querySelector(`[${PILL_DATA_ATTR}]`) != null;
        const inputType =
          nativeEvent && "inputType" in nativeEvent
            ? String(nativeEvent.inputType)
            : undefined;
        const isDeletion = inputType?.startsWith("delete") ?? false;

        if (isDeletion && !hasPills && text.trim().length === 0) {
          ops.clearHost();
          updateEmptyState();
          onContentChangeRef.current?.("");
          atMentionRef.current = { active: false, startOffset: 0 };
          slashCommandRef.current = { active: false, startOffset: 0 };
          onAtMentionCloseRef.current?.();
          onSlashCommandCloseRef.current?.();
          return;
        }

        updateEmptyState();
        onContentChangeRef.current?.(text);

        if (atMentionRef.current.active) {
          const range = rangeInsideHost(host);
          const caretOffset = caretTextOffset(host, range);
          if (caretOffset < atMentionRef.current.startOffset) {
            atMentionRef.current = { active: false, startOffset: 0 };
            onAtMentionCloseRef.current?.();
          } else {
            const query = text
              .slice(atMentionRef.current.startOffset, caretOffset)
              .replace(/\u200B/g, "");
            if (/\s/.test(query)) {
              atMentionRef.current = { active: false, startOffset: 0 };
              onAtMentionCloseRef.current?.();
            } else {
              const rect = range.getBoundingClientRect();
              onAtMentionRef.current?.(query, { x: rect.left, y: rect.bottom });
            }
          }
        }

        if (slashCommandRef.current.active) {
          if (!text.startsWith("/")) {
            slashCommandRef.current = { active: false, startOffset: 0 };
            onSlashCommandCloseRef.current?.();
          } else {
            onSlashCommandRef.current?.(text.slice(1));
          }
        }
      },
      [hostRef, ops, updateEmptyState]
    );

    // ===== Stable handlers =====
    const handlePaste = useMemo(
      () =>
        createPasteHandler({
          insertPill: ops.insertPill,
          insertTextAtCaret: ops.insertTextAtCaret,
          getOnImagePaste: () => onImagePasteRef.current,
          getInstalledSkills: () => installedSkillsRef.current,
        }),
      [ops.insertPill, ops.insertTextAtCaret]
    );

    // Wrap `insertNewline` so a bare-Enter / Shift+Enter newline still
    // flows through the same notify-host path that native typing does.
    // The op mutates the DOM directly (no `beforeinput`/`input` event),
    // so without this the parent (e.g. `useEditorExpansion`) never sees
    // the new `\n` and the compact pill row would refuse to expand.
    const insertNewlineAndNotify = useCallback(() => {
      ops.insertNewline();
      handleInput();
    }, [ops, handleInput]);

    const handleKeyDown = useMemo(
      () =>
        createKeyDownHandler({
          host: () => hostRef.current,
          isComposing: () => isComposingRef.current,
          getAtMention: () => atMentionRef.current,
          setAtMention: (state) => {
            atMentionRef.current = state;
          },
          getSlashCommand: () => slashCommandRef.current,
          setSlashCommand: (state) => {
            slashCommandRef.current = state;
          },
          getOnKeyDownForDropdown: () => onKeyDownForDropdownRef.current,
          getOnKeyDownForSlashDropdown: () =>
            onKeyDownForSlashDropdownRef.current,
          getOnAtMention: () => onAtMentionRef.current,
          getOnAtMentionClose: () => onAtMentionCloseRef.current,
          getOnSlashCommand: () => onSlashCommandRef.current,
          getOnSlashCommandClose: () => onSlashCommandCloseRef.current,
          getOnSubmit: () => onSubmitRef.current,
          getOnBeforeNewline: () => onBeforeNewlineRef.current,
          getText: () => {
            const host = hostRef.current;
            return host ? extractPlainText(host) : "";
          },
          insertNewline: insertNewlineAndNotify,
          requireCmdEnter,
        }),
      [hostRef, insertNewlineAndNotify, requireCmdEnter]
    );

    // ===== Native event wiring =====
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const handleCompositionStart = () => {
        isComposingRef.current = true;
      };
      const handleCompositionEnd = () => {
        isComposingRef.current = false;
      };
      const handleBeforeInput = (event: InputEvent) => {
        if (isComposingRef.current) return;
        if (event.inputType === "insertText" && event.data) {
          const sanitized = sanitizeText(event.data);
          if (sanitized !== event.data) {
            event.preventDefault();
            if (sanitized) ops.insertTextAtCaret(sanitized);
          }
        }
      };
      const handlePasteEvent = (event: ClipboardEvent) => {
        handlePaste(event);
        handleInput();
      };
      host.addEventListener("compositionstart", handleCompositionStart);
      host.addEventListener("compositionend", handleCompositionEnd);
      host.addEventListener("beforeinput", handleBeforeInput);
      host.addEventListener("paste", handlePasteEvent);
      host.addEventListener("keydown", handleKeyDown);
      return () => {
        host.removeEventListener("compositionstart", handleCompositionStart);
        host.removeEventListener("compositionend", handleCompositionEnd);
        host.removeEventListener("beforeinput", handleBeforeInput);
        host.removeEventListener("paste", handlePasteEvent);
        host.removeEventListener("keydown", handleKeyDown);
      };
      // ops is stable (object from useEditorOperations never changes identity).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      hostRef,
      ops.insertTextAtCaret,
      handlePaste,
      handleKeyDown,
      handleInput,
    ]);

    // ===== Initial content + autoFocus =====
    useEffect(() => {
      if (!initialContent) return;
      ops.setHostContent(initialContent);
      updateEmptyState();
      onContentChangeRef.current?.(initialContent);
      if (autoFocus) {
        const host = hostRef.current;
        if (host) placeCaretAtEnd(host);
      }
      // Only on mount — `setContent` covers later programmatic updates.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (!autoFocus) return;
      const host = hostRef.current;
      if (host) placeCaretAtEnd(host);
      // hostRef is a stable React ref — listing it would cause spurious re-runs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoFocus]);

    // ===== Imperative handle =====
    useImperativeHandle(
      ref,
      () =>
        buildImperativeApi({
          host: () => hostRef.current,
          insertPill: (attrs) => {
            ops.insertPill(attrs);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          insertTextAtCaret: (text) => {
            ops.insertTextAtCaret(text);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          setHostContent: (content) => {
            resetMentionState();
            ops.setHostContent(content);
            updateEmptyState();
            onContentChangeRef.current?.(content);
          },
          restoreSnapshot: (snapshot) => {
            resetMentionState();
            ops.restoreSnapshot(snapshot);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          captureSnapshot: () => ops.captureSnapshot(),
          clearHost: () => {
            resetMentionState();
            ops.clearHost();
            updateEmptyState();
            onContentChangeRef.current?.("");
          },
          focusHost: ops.focusHost,
          removePillByPath: (filePath) => {
            ops.removePillByPath(filePath);
            updateEmptyState();
            const host = hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          },
          isHostEmpty: ops.isHostEmpty,
          triggerAtMention: () => {
            const host = hostRef.current;
            if (!host) return;
            host.focus();
            const range = rangeInsideHost(host);
            const caretOffset = caretTextOffset(host, range);
            atMentionRef.current = {
              active: true,
              startOffset: caretOffset,
              hasAtChar: false,
            };
            const rect = range.getBoundingClientRect();
            onAtMentionRef.current?.("", {
              x: rect.left,
              y: rect.bottom,
            });
          },
          getAtMentionState: () => ({
            active: atMentionRef.current.active,
            hasAtChar: atMentionRef.current.hasAtChar,
          }),
          closeAtMention: () => {
            atMentionRef.current = { active: false, startOffset: 0 };
            onAtMentionCloseRef.current?.();
          },
          consumeMentionQuery: () => {
            const host = hostRef.current;
            if (!host) return;
            const mention = atMentionRef.current;
            if (!mention.active) return;
            const range = rangeInsideHost(host);
            const caretOffset = caretTextOffset(host, range);
            const deleteCount =
              caretOffset - mention.startOffset + (mention.hasAtChar ? 1 : 0);
            for (let index = 0; index < deleteCount; index += 1) {
              document.execCommand("delete", false);
            }
          },
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [ops, updateEmptyState]
    );

    // ===== Pill portal targets =====
    const pillPortals = pillEntries.map((entry) => {
      const target = ops.hostRef.current?.querySelector(
        `[data-pill-id="${entry.id}"]`
      ) as HTMLSpanElement | null;
      if (!target) return null;
      ops.registerPillHost(entry.id, target);
      return createPortal(
        <ComposerPill
          attrs={entry.attrs}
          onDelete={() => {
            target.parentNode?.removeChild(target);
            ops.reconcilePillsFromDom();
            updateEmptyState();
            const host = ops.hostRef.current;
            if (host) onContentChangeRef.current?.(extractPlainText(host));
          }}
        />,
        target,
        entry.id
      );
    });

    return (
      <div
        className={`composer-input ${isDark ? "dark" : "light"} ${className}`}
        style={{
          minHeight,
          maxHeight,
          overflowY: overflowY ?? "auto",
        }}
      >
        <div className="composer-input-wrapper">
          <div
            ref={hostRef}
            className={`composer-input-content ${isDark ? "dark" : "light"} ${
              hostIsEmpty ? "is-empty" : ""
            }`}
            contentEditable={editable}
            suppressContentEditableWarning
            data-placeholder={placeholder}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onInput={(event) => handleInput(event.nativeEvent)}
          />
        </div>
        {pillPortals}
      </div>
    );
  }
);

ComposerInput.displayName = "ComposerInput";

export default ComposerInput;
