import { JSONContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PillIconType } from "@src/components/ComposerInput";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import { createEditorExtensions } from "./config";
import type { AtMentionState, RichTextEditorProps } from "./types";

const DROPDOWN_KEYS = ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"];
const TOOLBAR_WIDTH = 380;

export function useRichTextEditor({
  placeholder = "Type something...",
  initialContent = "",
  onContentChange,
  onImageInsert,
  onAtMention,
  onAtMentionClose,
  autoFocus = false,
  editable = true,
  onKeyDownForDropdown,
}: Omit<RichTextEditorProps, "className" | "minHeight" | "maxHeight">) {
  const { isDark } = useCurrentTheme();
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 });

  const atMentionRef = useRef<AtMentionState>({ active: false, startPos: 0 });

  // Keep callbacks in refs to avoid stale closures
  const onContentChangeRef = useRef(onContentChange);
  const onImageInsertRef = useRef(onImageInsert);
  const onAtMentionRef = useRef(onAtMention);
  const onAtMentionCloseRef = useRef(onAtMentionClose);
  const onKeyDownForDropdownRef = useRef(onKeyDownForDropdown);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    onImageInsertRef.current = onImageInsert;
  }, [onImageInsert]);

  useEffect(() => {
    onAtMentionRef.current = onAtMention;
  }, [onAtMention]);

  useEffect(() => {
    onAtMentionCloseRef.current = onAtMentionClose;
  }, [onAtMentionClose]);

  useEffect(() => {
    onKeyDownForDropdownRef.current = onKeyDownForDropdown;
  }, [onKeyDownForDropdown]);

  const editor = useEditor({
    extensions: createEditorExtensions(placeholder),
    content: initialContent,
    editable,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: `rich-text-editor-content ${isDark ? "dark" : "light"}`,
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
      },
      handleKeyDown: (view, event) => {
        // Handle @ mention dropdown navigation
        if (atMentionRef.current.active && onKeyDownForDropdownRef.current) {
          if (DROPDOWN_KEYS.includes(event.key)) {
            const handled = onKeyDownForDropdownRef.current(event);
            if (handled) {
              event.preventDefault();
              return true;
            }
          }
        }

        // Handle @ mention detection — let the "@" character land in the
        // editor (visible to the user, mirrors slash-command behavior).
        // After ProseMirror inserts it, mark the mention as active with
        // startPos pointing to the position *after* the "@".
        if (event.key === "@") {
          setTimeout(() => {
            const { from } = view.state.selection;
            atMentionRef.current = {
              active: true,
              startPos: from,
              hasAtChar: true,
            };

            const coords = view.coordsAtPos(from);
            onAtMentionRef.current?.("", {
              x: coords.left,
              y: coords.bottom,
            });
          }, 0);
        }

        // Handle Escape to close @ dropdown
        if (event.key === "Escape" && atMentionRef.current.active) {
          atMentionRef.current.active = false;
          onAtMentionCloseRef.current?.();
          return true;
        }

        return false;
      },
      handlePaste: (_view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const imageFiles: File[] = [];
        for (let idx = 0; idx < clipboardData.items.length; idx++) {
          const item = clipboardData.items[idx];
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }

        if (imageFiles.length > 0 && onImageInsertRef.current) {
          event.preventDefault();
          onImageInsertRef.current(imageFiles);
          return true;
        }

        return false;
      },
      handleDrop: (_view, event) => {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return false;

        const imageFiles: File[] = [];
        for (let idx = 0; idx < dataTransfer.files.length; idx++) {
          const file = dataTransfer.files[idx];
          if (file.type.startsWith("image/")) {
            imageFiles.push(file);
          }
        }

        if (imageFiles.length > 0 && onImageInsertRef.current) {
          event.preventDefault();
          onImageInsertRef.current(imageFiles);
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      const html = editorInstance.getHTML();
      const text = editorInstance.getText();
      const json = editorInstance.getJSON();
      onContentChangeRef.current?.(html, text, json);

      // Update @ mention query
      if (atMentionRef.current.active) {
        const { from } = editorInstance.state.selection;
        const textBeforeCursor = editorInstance.state.doc.textBetween(
          atMentionRef.current.startPos,
          from,
          ""
        );

        if (
          textBeforeCursor.includes(" ") ||
          textBeforeCursor.includes("\n") ||
          from < atMentionRef.current.startPos
        ) {
          atMentionRef.current.active = false;
          onAtMentionCloseRef.current?.();
        } else {
          const coords = editorInstance.view.coordsAtPos(from);
          onAtMentionRef.current?.(textBeforeCursor, {
            x: coords.left,
            y: coords.bottom,
          });
        }
      }
    },
    onSelectionUpdate: ({ editor: editorInstance }) => {
      const { from, to } = editorInstance.state.selection;
      const hasSelection = from !== to;

      if (hasSelection && !editorInstance.isActive("codeBlock")) {
        const { view } = editorInstance;
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        const top = Math.min(start.top, end.top) - 50;

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const selectionCenter = rect.left + rect.width / 2;
          const left = selectionCenter - TOOLBAR_WIDTH / 2;

          setToolbarPosition({
            top: Math.max(10, top),
            left: Math.max(
              10,
              Math.min(left, window.innerWidth - TOOLBAR_WIDTH - 10)
            ),
          });
        } else {
          const selectionCenter = (start.left + end.left) / 2;
          setToolbarPosition({
            top: Math.max(10, top),
            left: Math.max(10, selectionCenter - TOOLBAR_WIDTH / 2),
          });
        }
        setShowToolbar(true);
      } else {
        setShowToolbar(false);
      }
    },
    onBlur: () => {
      setTimeout(() => {
        if (!document.querySelector(".rich-text-editor-toolbar:hover")) {
          setShowToolbar(false);
        }
      }, 150);
    },
  });

  const handleCloseToolbar = useCallback(() => {
    setShowToolbar(false);
  }, []);

  // Build imperative methods
  const getText = useCallback(() => editor?.getText() || "", [editor]);
  const getHTML = useCallback(() => editor?.getHTML() || "", [editor]);
  const getJSON = useCallback(
    () => editor?.getJSON() as JSONContent | undefined,
    [editor]
  );
  const getMarkdown = useCallback(() => {
    if (!editor) return "";
    const editorStorage = editor.storage as unknown as Record<string, unknown>;
    const storage = editorStorage.markdown as
      | { getMarkdown: () => string }
      | undefined;
    return storage?.getMarkdown?.() ?? editor.getText();
  }, [editor]);
  const setContent = useCallback(
    (content: string | JSONContent) => {
      editor?.commands.setContent(content);
    },
    [editor]
  );
  const clear = useCallback(() => {
    editor?.commands.clearContent();
  }, [editor]);
  const focus = useCallback(() => {
    editor?.commands.focus();
  }, [editor]);
  const isEmpty = useCallback(() => editor?.isEmpty ?? true, [editor]);

  const insertImage = useCallback(
    (src: string, alt?: string) => {
      editor
        ?.chain()
        .focus()
        .setImage({ src, alt: alt ?? "" })
        .run();
    },
    [editor]
  );

  const insertFilePill = useCallback(
    (
      filePath: string,
      isFolder = false,
      iconType?: PillIconType,
      displayName?: string
    ) => {
      const fileName = displayName || filePath.split("/").pop() || filePath;

      if (atMentionRef.current.active && editor) {
        const { from } = editor.state.selection;
        // When the user typed "@", that character lives at startPos - 1 —
        // delete it together with the query. Programmatic triggers leave
        // no "@" behind and start at startPos.
        const deleteFrom = atMentionRef.current.hasAtChar
          ? Math.max(0, atMentionRef.current.startPos - 1)
          : atMentionRef.current.startPos;
        editor
          .chain()
          .focus()
          .deleteRange({
            from: deleteFrom,
            to: from,
          })
          .insertFilePill({ filePath, fileName, isFolder, iconType })
          .insertContent(" ")
          .run();

        atMentionRef.current.active = false;
        onAtMentionCloseRef.current?.();
      } else {
        editor
          ?.chain()
          .focus()
          .insertFilePill({ filePath, fileName, isFolder, iconType })
          .insertContent(" ")
          .run();
      }
    },
    [editor]
  );

  const removeFilePill = useCallback(
    (filePath: string) => {
      editor?.commands.removeFilePill(filePath);
    },
    [editor]
  );

  const getFilePills = useCallback(() => {
    const pills: Array<{ filePath: string; fileName: string }> = [];
    editor?.state.doc.descendants((node) => {
      if (node.type.name === "filePill") {
        pills.push({
          filePath: node.attrs.filePath,
          fileName: node.attrs.fileName,
        });
      }
    });
    return pills;
  }, [editor]);

  const triggerAtMention = useCallback(() => {
    if (!editor) return;

    const { from } = editor.state.selection;
    atMentionRef.current = { active: true, startPos: from, hasAtChar: false };

    const coords = editor.view.coordsAtPos(from);
    onAtMentionRef.current?.("", { x: coords.left, y: coords.bottom });
  }, [editor]);

  return {
    editor,
    isDark,
    showToolbar,
    toolbarPosition,
    handleCloseToolbar,
    // Imperative methods
    getText,
    getHTML,
    getJSON,
    getMarkdown,
    setContent,
    clear,
    focus,
    isEmpty,
    insertImage,
    insertFilePill,
    removeFilePill,
    getFilePills,
    triggerAtMention,
  };
}
