import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
import MarkdownEditor from "@src/modules/shared/components/MarkdownEditor";
import type { MarkdownEditorRef } from "@src/modules/shared/components/MarkdownEditor";

export interface ProjectContentEditorRef {
  getDescriptionText: () => string;
  getDescriptionHTML: () => string;
  getDescriptionJSON: () => undefined;
  getMarkdown: () => string;
  insertImage: (src: string, alt?: string) => void;
  focusTitle: () => void;
  focusDescription: () => void;
}

export interface ProjectContentEditorProps {
  title: string;
  onTitleChange: (title: string) => void;
  summary?: string;
  onSummaryChange?: (summary: string) => void;
  initialDescription?: string;
  onDescriptionChange?: (markdown: string, text: string) => void;
  onImageInsert?: (files: File[]) => void;
  titlePlaceholder?: string;
  summaryPlaceholder?: string;
  descriptionPlaceholder?: string;
  autoFocusTitle?: boolean;
  editable?: boolean;
  className?: string;
  descriptionClassName?: string;
  descriptionMaxHeight?: number | string;
}

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
      initialDescription = "",
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
    const editorRef = useRef<MarkdownEditorRef>(null);
    const [descriptionValue, setDescriptionValue] =
      useState(initialDescription);

    useEffect(() => {
      setDescriptionValue(initialDescription);
    }, [initialDescription]);

    useImperativeHandle(ref, () => ({
      getDescriptionText: () =>
        editorRef.current?.getText() ?? descriptionValue,
      getDescriptionHTML: () =>
        editorRef.current?.getHTML() ?? descriptionValue,
      getDescriptionJSON: () => undefined,
      getMarkdown: () => editorRef.current?.getMarkdown() ?? descriptionValue,
      insertImage: (src: string, alt?: string) =>
        editorRef.current?.insertImage(src, alt),
      focusTitle: () => titleRef.current?.focus(),
      focusDescription: () => editorRef.current?.focus(),
    }));

    const handleDescriptionChange = (markdown: string) => {
      setDescriptionValue(markdown);
      onDescriptionChange?.(markdown, markdown);
    };

    const showSummary =
      onSummaryChange !== undefined || (summary && summary.length > 0);

    return (
      <div className={className}>
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

        <div className="mb-4 border-t border-border-2" />

        <div
          className={`${descriptionMaxHeight ? "min-h-0 flex-1" : "min-h-[200px]"} cursor-text`}
          onClick={() => editorRef.current?.focus()}
        >
          <MarkdownEditor
            ref={editorRef}
            value={descriptionValue}
            onChange={handleDescriptionChange}
            placeholder={descriptionPlaceholder}
            onImageInsert={onImageInsert}
            minHeight={200}
            maxHeight={descriptionMaxHeight}
            readOnly={!editable}
            showTokenCount={false}
            hideHeader
            className={`project-markdown-editor text-[13px] ${descriptionClassName}`.trim()}
          />
        </div>
      </div>
    );
  }
);

ProjectContentEditor.displayName = "ProjectContentEditor";

export default ProjectContentEditor;
