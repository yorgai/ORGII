/**
 * ComposerBar — shared bottom toolbar for input areas
 *
 * Used by both ChatPanel InputArea and SessionCreator EditorArea
 * to ensure identical layout: [+ button | pills] ---- [context | submit]
 *
 * Chat panel can pass `editorSlot` + `inlineLayout` for a compact single row:
 * [ + ] [ editor … ] [ pills ] [ submit ].
 */
import { Plus } from "lucide-react";
import React, { memo } from "react";

import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import ContextInfoButton from "@src/engines/ChatPanel/InputArea/components/ContextInfoButton";
import AddActionsDropdown from "@src/features/SessionCreator/components/AddActionsDropdown";

// ============================================
// Types
// ============================================

export interface ComposerBarProps {
  /** + button: open add-content selector (@-mentions, files) */
  onAddContent: () => void;
  /** + button: open upload picker */
  onUpload: () => void;
  /** + button: open Skills & Tools slash menu */
  onOpenSkillsTools?: () => void;
  /** Direction the + menu opens */
  dropdownDirection?: "up" | "down";
  /** Content before the + button (e.g. cite-code badge, reply indicator) */
  leftPrefix?: React.ReactNode;
  /** Pills rendered after the + button (mode, model, source, settings…) */
  pills?: React.ReactNode;
  /** Repo path forwarded to ContextInfoButton */
  repoPath?: string;
  /** Submit / launch button on the far right */
  submitButton?: React.ReactNode;
  /**
   * Flex gap between toolbar controls on each side.
   * Session creator uses spacing; chat input keeps rows tight.
   * @default true
   */
  toolbarItemGap?: boolean;
  /**
   * When set with `editorSlot`, render the editor in one horizontal row with
   * the toolbar (compact chat capsule).
   */
  inlineLayout?: boolean;
  /**
   * Optional editor field above the toolbar (`inlineLayout` false) or between
   * left (+) and right (pills/submit) clusters (`inlineLayout` true).
   */
  editorSlot?: React.ReactNode;
  /**
   * When false, omits ContextInfoButton for compact rows.
   * @default true
   */
  showContextInfo?: boolean;
}

// ============================================
// Component
// ============================================

const ComposerBar: React.FC<ComposerBarProps> = memo(
  ({
    onAddContent,
    onUpload,
    onOpenSkillsTools,
    dropdownDirection = "up",
    leftPrefix,
    pills,
    repoPath,
    submitButton,
    toolbarItemGap = true,
    inlineLayout = false,
    editorSlot,
    showContextInfo = true,
  }) => {
    const rowClass =
      toolbarItemGap === false
        ? "flex items-center gap-0.5"
        : "flex items-center gap-1";

    const addButton = onOpenSkillsTools ? (
      <button
        type="button"
        onClick={onOpenSkillsTools}
        className={[
          "flex items-center justify-center rounded-full bg-fill-1 text-text-1 transition-colors duration-200 hover:bg-fill-2 focus:outline-none",
          INPUT_AREA_BUTTONS.iconButtonSizeClass,
        ].join(" ")}
        aria-label="Skills & Tools"
        data-testid="composer-skills-tools-button"
      >
        <Plus
          size={INPUT_AREA_BUTTONS.iconSize}
          strokeWidth={1.75}
          className="text-text-1"
        />
      </button>
    ) : (
      <AddActionsDropdown
        onAddContent={onAddContent}
        onUpload={onUpload}
        dropdownDirection={dropdownDirection}
      />
    );

    const toolbarRow = (
      <div
        className="flex h-9 min-h-9 w-full items-center justify-between px-1 text-text-2"
        style={{ transform: "translateZ(0)" }}
      >
        <div className={rowClass}>
          {leftPrefix}
          {addButton}
          {pills}
        </div>
        <div className={rowClass}>
          {showContextInfo && <ContextInfoButton repoPath={repoPath} />}
          {submitButton}
        </div>
      </div>
    );

    // When an editorSlot is provided we keep ONE stable DOM layout for both
    // the inline pill row and the full stacked composer. Switching
    // layouts is pure CSS (grid template areas) so the Tiptap editor is never
    // unmounted when `inlineLayout` flips — preserving focus, selection, and
    // document state across the transition.
    //
    // Four children, always in the same order:
    //   0. leftCluster  (leftPrefix + add button)
    //   1. editorWrap   (the TiptapInput)
    //   2. pillCluster  (mode/model/status pills)
    //   3. rightCluster (context + submit)
    //
    // Inline layout: single row, editor stretches between controls.
    // Stacked layout: editor on top spanning full width, controls below.
    if (editorSlot != null) {
      const leftCluster = (
        <div className={`${rowClass} shrink-0`} style={{ gridArea: "left" }}>
          {leftPrefix}
          {addButton}
        </div>
      );
      const editorWrap = (
        <div
          data-editor-slot="true"
          className="relative flex min-h-0 min-w-0 items-stretch self-stretch"
          style={{ gridArea: "editor" }}
        >
          {editorSlot}
        </div>
      );
      const pillCluster = (
        <div
          className="flex min-w-0 shrink-0 items-center"
          style={{ gridArea: "pills" }}
        >
          {pills}
        </div>
      );
      const rightCluster = (
        <div
          className={`flex min-w-0 shrink items-center justify-end ${toolbarItemGap === false ? "gap-0.5" : "gap-1"}`}
          style={{ gridArea: "right" }}
        >
          {showContextInfo && (
            <ContextInfoButton repoPath={repoPath} variant="corner" compact />
          )}
          {submitButton}
        </div>
      );

      const gridStyle: React.CSSProperties = inlineLayout
        ? {
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto",
            gridTemplateAreas: '"left editor pills right"',
            alignItems: "center",
            columnGap: 2,
          }
        : {
            display: "grid",
            gridTemplateColumns: "auto auto 1fr",
            gridTemplateAreas: '"editor editor editor" "left pills right"',
            rowGap: 4,
          };

      return (
        <div className="w-full text-text-2" style={gridStyle}>
          {leftCluster}
          {editorWrap}
          {pillCluster}
          {rightCluster}
        </div>
      );
    }

    return toolbarRow;
  }
);

ComposerBar.displayName = "ComposerBar";

export default ComposerBar;
