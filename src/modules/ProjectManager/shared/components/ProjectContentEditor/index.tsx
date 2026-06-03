import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import ComposerInputSurface from "@src/components/ComposerInput/ComposerInputSurface";
import Input from "@src/components/Input";
import ContextMenuPortal from "@src/engines/ChatPanel/InputArea/components/ContextMenuPortal";
import SlashCommandPortal from "@src/engines/ChatPanel/InputArea/components/SlashCommandPortal";
import { useTiptapInput } from "@src/hooks/input";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
import type { SlashItem } from "@src/types/extensions";

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
  titleVisible?: boolean;
  separatorVisible?: boolean;
  descriptionVisible?: boolean;
  titleActions?: ReactNode;
  metaContent?: ReactNode;
  descriptionClassName?: string;
  descriptionMaxHeight?: number | string;
  repoPath?: string | null;
  dataTestId?: string;
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
      titleVisible = true,
      separatorVisible = true,
      descriptionVisible = true,
      titleActions,
      metaContent,
      descriptionClassName = "",
      descriptionMaxHeight,
      repoPath,
      dataTestId,
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
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const descriptionValueRef = useRef(initialDescription);
    const contextMenuKeyboardHandlerRef = useRef<
      ((event: ReactKeyboardEvent) => boolean) | null
    >(null);

    const {
      tiptapRef: editorRef,
      showContextMenu,
      atSearchQuery,
      handleAtMention,
      handleAtMentionClose,
      handleAtSelect,
      contextMenuKeyboardOpened,
      showSlashMenu,
      slashQuery,
      slashCommandKeyboardHandlerRef,
      handleSlashCommand,
      handleSlashCommandClose,
      handleSlashSelect,
      handleModeSelect,
      currentMode,
      filteredSlashItems,
      slashLoading,
    } = useTiptapInput();

    const skillSlashItems = useMemo<SlashItem[]>(
      () => filteredSlashItems.filter((item) => item.category === "skill"),
      [filteredSlashItems]
    );

    useEffect(() => {
      if (descriptionValueRef.current === initialDescription) return;
      descriptionValueRef.current = initialDescription;
      editorRef.current?.setContent(initialDescription);
    }, [editorRef, initialDescription]);

    const getSerializedDescription = useCallback(
      () =>
        editorRef.current?.getTextWithPills() ?? descriptionValueRef.current,
      [editorRef]
    );

    useImperativeHandle(ref, () => ({
      getDescriptionText: getSerializedDescription,
      getDescriptionHTML: getSerializedDescription,
      getDescriptionJSON: () => undefined,
      getMarkdown: getSerializedDescription,
      insertImage: (src: string, alt?: string) => {
        const label = alt?.trim() || "image";
        editorRef.current
          ?.getEditor()
          ?.chain()
          .focus()
          .insertContent(`\n![${label}](${src})\n`)
          .run();
      },
      focusTitle: () => titleRef.current?.focus(),
      focusDescription: () => editorRef.current?.focus(),
    }));

    const handleDescriptionChange = (text: string) => {
      const markdown = editorRef.current?.getTextWithPills() ?? text;
      descriptionValueRef.current = markdown;
      onDescriptionChange?.(markdown, text);
    };

    const handleProjectSlashSelect = useCallback(
      (item: SlashItem) => {
        if (item.category === "skill") {
          const skillToken = `/${item.skillName ?? item.name}`;
          editorRef.current?.insertFilePill(
            skillToken,
            false,
            "skill",
            item.name
          );
          editorRef.current?.focus();
          handleSlashCommandClose();
          return;
        }

        handleSlashSelect(item);
      },
      [editorRef, handleSlashCommandClose, handleSlashSelect]
    );

    const showSummary =
      titleVisible &&
      (onSummaryChange !== undefined || (summary && summary.length > 0));

    return (
      <div
        className={`w-full min-w-0 ${className}`.trim()}
        data-testid={dataTestId}
      >
        {titleVisible && (
          <div className="flex w-full min-w-0 items-start gap-3">
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
              className="mb-1 min-w-0 flex-1"
              inputClassName={`text-[22px] font-semibold text-text-1 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
            />
            {titleActions && (
              <div className="flex shrink-0 items-center gap-1 pt-0.5">
                {titleActions}
              </div>
            )}
          </div>
        )}

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
            className="mb-5 w-full"
            inputClassName={`text-[13px] text-text-2 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
          />
        )}

        {metaContent && <div className="mb-4 mt-3 w-full">{metaContent}</div>}

        {separatorVisible && (
          <div className="mb-4 mt-2 w-full border-t border-border-2" />
        )}

        {descriptionVisible && (
          <div
            ref={editorContainerRef}
            className={`${descriptionMaxHeight ? "min-h-0 flex-1" : "min-h-[200px]"} w-full min-w-0 cursor-text`}
            onClick={() => editorRef.current?.focus()}
          >
            <ComposerInputSurface
              ref={editorRef}
              wrapperClassName="relative w-full min-w-0"
              placeholder={descriptionPlaceholder}
              initialContent={initialDescription}
              onContentChange={handleDescriptionChange}
              onAtMention={editable ? handleAtMention : undefined}
              onAtMentionClose={editable ? handleAtMentionClose : undefined}
              onSlashCommand={editable ? handleSlashCommand : undefined}
              onSlashCommandClose={
                editable ? handleSlashCommandClose : undefined
              }
              contextMenuVisible={showContextMenu}
              contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
              slashMenuVisible={showSlashMenu}
              slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
              onImagePaste={editable ? onImageInsert : undefined}
              minHeight={200}
              maxHeight={descriptionMaxHeight}
              overflowY={descriptionMaxHeight ? "auto" : "visible"}
              editable={editable}
              requireCmdEnter
              slashTriggerMode="context"
              className={`project-content-composer noDrag w-full py-2 text-[13px] [&_.composer-input-content]:px-0 [&_.composer-input-content]:pb-0 [&_.composer-input-content]:text-[13px] [&_.composer-input-content]:leading-[1.6] ${descriptionClassName}`.trim()}
            />
            <ContextMenuPortal
              visible={showContextMenu}
              containerRef={editorContainerRef}
              onClose={handleAtMentionClose}
              onSelect={handleAtSelect}
              searchQuery={atSearchQuery}
              inlineSearchOnEmpty
              keyboardOpened={contextMenuKeyboardOpened}
              recentFiles={[]}
              repoPath={repoPath ?? undefined}
              keyboardHandlerRef={contextMenuKeyboardHandlerRef}
            />
            <SlashCommandPortal
              visible={showSlashMenu}
              containerRef={editorContainerRef}
              items={skillSlashItems}
              loading={slashLoading}
              currentMode={currentMode}
              searchQuery={slashQuery}
              onClose={handleSlashCommandClose}
              onSelect={handleProjectSlashSelect}
              onModeSelect={handleModeSelect}
              keyboardHandlerRef={slashCommandKeyboardHandlerRef}
              direction="down"
              showModeRows={false}
            />
          </div>
        )}
      </div>
    );
  }
);

ProjectContentEditor.displayName = "ProjectContentEditor";

export default ProjectContentEditor;
