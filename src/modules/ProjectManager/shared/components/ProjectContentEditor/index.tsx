/**
 * ProjectContentEditor Component
 *
 * Shared title + summary + rich text description editor for projects.
 * Used in both:
 *   - CreateProjectView (create mode)
 *   - WorkItemsOverview (edit mode)
 *
 * Uses RichTextEditor (full-featured tiptap with floating toolbar)
 * for the description field.
 */
import type { JSONContent } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import RichTextEditor from "@src/components/RichTextEditor";
import type { RichTextEditorRef } from "@src/components/RichTextEditor";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";

// ============================================
// Types
// ============================================

export interface ProjectContentEditorRef {
  /** Get the plain text of the description */
  getDescriptionText: () => string;
  /** Get the HTML of the description */
  getDescriptionHTML: () => string;
  /** Get the JSON of the description */
  getDescriptionJSON: () => JSONContent | undefined;
  /** Get the markdown of the description */
  getMarkdown: () => string;
  /** Insert an image node at the cursor */
  insertImage: (src: string, alt?: string) => void;
  /** Focus the title input */
  focusTitle: () => void;
  /** Focus the description editor */
  focusDescription: () => void;
}

export interface ProjectContentEditorProps {
  /** Project title */
  title: string;
  /** Title change handler */
  onTitleChange: (title: string) => void;
  /** Project summary (one-liner below title) */
  summary?: string;
  /** Summary change handler */
  onSummaryChange?: (summary: string) => void;
  /** Initial description content (string or JSON) */
  initialDescription?: string | JSONContent;
  /** Description change handler (called on every edit) */
  onDescriptionChange?: (html: string, text: string) => void;
  /** Callback when images are pasted/dropped into the editor */
  onImageInsert?: (files: File[]) => void;
  /** Title placeholder */
  titlePlaceholder?: string;
  /** Summary placeholder */
  summaryPlaceholder?: string;
  /** Description placeholder */
  descriptionPlaceholder?: string;
  /** Whether title should auto-focus */
  autoFocusTitle?: boolean;
  /** Whether all fields are editable */
  editable?: boolean;
  /** Additional className for the container */
  className?: string;
  /** Additional className for the description editor */
  descriptionClassName?: string;
  /** Max height for the description editor scroll area */
  descriptionMaxHeight?: number | string;
}

// ============================================
// Component
// ============================================

const ProjectContentEditor = forwardRef<
  ProjectContentEditorRef,
  ProjectContentEditorProps
>(
  (
    {
      title,
      onTitleChange,
      summary,
      onSummaryChange,
      initialDescription,
      onDescriptionChange,
      onImageInsert,
      titlePlaceholder: titlePlaceholderProp,
      summaryPlaceholder: summaryPlaceholderProp,
      descriptionPlaceholder: descriptionPlaceholderProp,
      autoFocusTitle = false,
      editable = true,
      className = "",
      descriptionClassName = "",
      descriptionMaxHeight,
    },
    ref
  ) => {
    const { t } = useTranslation("projects");
    const titlePlaceholder =
      titlePlaceholderProp ?? t("projects.editor.titlePlaceholder");
    const summaryPlaceholder =
      summaryPlaceholderProp ?? t("projects.editor.summaryPlaceholder");
    const descriptionPlaceholder =
      descriptionPlaceholderProp ?? t("projects.editor.descriptionPlaceholder");
    const titleRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<RichTextEditorRef>(null);

    useImperativeHandle(ref, () => ({
      getDescriptionText: () => editorRef.current?.getText() ?? "",
      getDescriptionHTML: () => editorRef.current?.getHTML() ?? "",
      getDescriptionJSON: () => editorRef.current?.getJSON(),
      getMarkdown: () => editorRef.current?.getMarkdown() ?? "",
      insertImage: (src: string, alt?: string) =>
        editorRef.current?.insertImage(src, alt),
      focusTitle: () => titleRef.current?.focus(),
      focusDescription: () => editorRef.current?.focus(),
    }));

    const handleDescriptionChange = (
      html: string,
      text: string,
      _json: JSONContent
    ) => {
      onDescriptionChange?.(html, text);
    };

    // Sync editor content only on mount or when explicitly reset (e.g. cancel).
    // We track the previous value to avoid resetting while the user is typing.
    const prevDescRef = useRef(initialDescription);
    useEffect(() => {
      if (editorRef.current && initialDescription !== undefined) {
        // Only reset if the value changed externally (not from user typing)
        // Detect external reset: value changed but editor content doesn't match
        const currentText = editorRef.current.getText();
        const incomingText =
          typeof initialDescription === "string"
            ? initialDescription.replace(/<[^>]*>/g, "")
            : "";
        // If the editor already has this content (user just typed it), skip
        if (
          prevDescRef.current !== initialDescription &&
          currentText !== incomingText
        ) {
          editorRef.current.setContent(initialDescription);
        }
        prevDescRef.current = initialDescription;
      }
    }, [initialDescription]);

    // Show summary if handler is provided OR if summary has a value
    const showSummary =
      onSummaryChange !== undefined || (summary && summary.length > 0);

    return (
      <div className={className}>
        {/* Title */}
        <Input
          ref={titleRef}
          type="text"
          value={title}
          onChange={onTitleChange}
          placeholder={titlePlaceholder}
          autoFocus={autoFocusTitle}
          readOnly={!editable}
          borderless
          bgless
          autoHeight
          className="mb-1"
          inputClassName={`text-[22px] font-semibold text-text-1 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
        />

        {/* Summary */}
        {showSummary && (
          <Input
            type="text"
            value={summary ?? ""}
            onChange={(nextSummary) => onSummaryChange?.(nextSummary)}
            placeholder={summaryPlaceholder}
            readOnly={!editable && !onSummaryChange}
            borderless
            bgless
            autoHeight
            className="mb-5"
            inputClassName={`text-[13px] text-text-2 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
          />
        )}

        {/* Divider */}
        <div className="mb-4 border-t border-border-2" />

        {/* Description - RichTextEditor */}
        <div
          className={`${descriptionMaxHeight ? "min-h-0 flex-1" : "min-h-[200px]"} cursor-text`}
          onClick={() => editorRef.current?.focus()}
        >
          <RichTextEditor
            ref={editorRef}
            placeholder={descriptionPlaceholder}
            initialContent={initialDescription ?? ""}
            onContentChange={handleDescriptionChange}
            onImageInsert={onImageInsert}
            minHeight={200}
            maxHeight={descriptionMaxHeight}
            editable={editable}
            className={`text-[13px] ${descriptionClassName}`.trim()}
          />
        </div>
      </div>
    );
  }
);

ProjectContentEditor.displayName = "ProjectContentEditor";

export default ProjectContentEditor;
