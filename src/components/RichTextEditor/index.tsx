/**
 * RichTextEditor Component
 *
 * A TipTap-based rich text editor with:
 * - Floating toolbar for inline formatting (appears on text selection)
 * - Support for headings, lists, code blocks, blockquotes
 * - Task lists with checkboxes
 * - Syntax-highlighted code blocks
 * - Keyboard shortcuts (Cmd+B, Cmd+I, etc.)
 * - @ mention support with file pills
 *
 * Used as the heavyweight rich-text input across SessionCreator, ProjectManager
 * description fields, and other long-form text surfaces. Pair with the lighter
 * `TiptapInput` for chat-style single-line / pill-only inputs.
 */
import { EditorContent } from "@tiptap/react";
import {
  type ChangeEvent,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import { FloatingToolbar } from "./FloatingToolbar";
import "./index.scss";
import type { RichTextEditorProps, RichTextEditorRef } from "./types";
import { useRichTextEditor } from "./useRichTextEditor";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  (
    {
      className = "",
      toolbarClassName = "",
      minHeight = 120,
      maxHeight,
      onImageInsert,
      ...hookProps
    },
    ref
  ) => {
    const { t } = useTranslation("sessions");
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
      editor,
      isDark,
      showToolbar,
      toolbarPosition,
      handleCloseToolbar,
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
    } = useRichTextEditor({ ...hookProps, onImageInsert });

    useImperativeHandle(ref, () => ({
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
    }));

    const handleImagePickerOpen = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((file) =>
          file.type.startsWith("image/")
        );
        if (imageFiles.length > 0) {
          onImageInsert?.(imageFiles);
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      },
      [onImageInsert]
    );

    if (!editor) {
      return (
        <div
          className={`rich-text-editor loading ${className}`}
          style={{ minHeight }}
        >
          <div className="loading-placeholder">{t("editor.loading")}</div>
        </div>
      );
    }

    return (
      <div
        ref={editorContainerRef}
        className={`rich-text-editor ${isDark ? "dark" : "light"} ${className}`}
        style={{
          minHeight,
          maxHeight,
          overflowY: maxHeight ? "auto" : undefined,
        }}
      >
        {showToolbar && (
          <FloatingToolbar
            editor={editor}
            position={toolbarPosition}
            onClose={handleCloseToolbar}
            onImagePickerOpen={
              onImageInsert ? handleImagePickerOpen : undefined
            }
            className={toolbarClassName}
          />
        )}

        <EditorContent editor={editor} className="rich-text-editor-wrapper" />

        {onImageInsert && (
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />
        )}
      </div>
    );
  }
);

RichTextEditor.displayName = "RichTextEditor";

export default RichTextEditor;
export type { RichTextEditorProps, RichTextEditorRef } from "./types";
