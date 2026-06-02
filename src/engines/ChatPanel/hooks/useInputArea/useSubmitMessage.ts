/**
 * useSubmitMessage
 *
 * Extracts the message-submission logic from useInputArea so the parent hook
 * stays under the 600-line limit while keeping the full submit flow isolated
 * and independently testable.
 *
 * Responsibilities:
 *   - MCP slash-command resolution before dispatch
 *   - Question auto-respond / reject intercept
 *   - Context pill terminal-text collection
 *   - Optimistic editor clear + atomic snapshot/restore on failure
 *   - Image draft clear/restore
 *   - Draft text flush on success / restore on failure
 *   - Reply-target clear after successful send
 */
import { useAtomValue, useStore } from "jotai";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { rejectQuestion, respondQuestion } from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import { extractQuestionBatch } from "@src/engines/ChatPanel/InputArea/AskQuestionCard/extractQuestionBatch";
import { chatEventsAtom } from "@src/engines/SessionCore";
import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";
import { wpReadOnlyAtom } from "@src/store/ui/chatPanelAtom";

import { clearImageDraft } from "../../InputArea/utils/imageDraftCache";
import { resolveMcpSlashCommand } from "./mcpSlashCommand";
import type {
  CiteCodeSnapshot,
  InputAreaRefs,
  SubmitMessageOptions,
  SubmitOverrideInput,
} from "./types";

// ============================================================================
// Types
// ============================================================================

export interface UseSubmitMessageOptions {
  refs: InputAreaRefs;
  draftSessionId: string;
  replyTargetEventId: string | undefined;
  flushDraft: (text: string) => Promise<void>;
  clearReplyTarget: () => Promise<void>;
  imageAttachment: {
    hasImages: boolean;
    images: ChatImageAttachment[];
    clearImages: () => void;
    restoreImages: (images: ChatImageAttachment[]) => void;
  };
  citeCode: {
    isCiteCode: boolean;
    clearCiteCode: () => void;
    captureCiteCode: () => CiteCodeSnapshot;
    restoreCiteCode: (snapshot: CiteCodeSnapshot) => void;
  };
  handleSessChatSubmit: (
    event: React.FormEvent | undefined,
    displayText: string,
    agentContent?: string,
    imageDataUrls?: string[],
    options?: { forceDispatch?: boolean; forceSendNow?: boolean }
  ) => Promise<void>;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
}

// ============================================================================
// Hook
// ============================================================================

export function useSubmitMessage({
  refs,
  draftSessionId,
  replyTargetEventId,
  flushDraft,
  clearReplyTarget,
  imageAttachment,
  citeCode,
  handleSessChatSubmit,
  onSubmitOverride,
}: UseSubmitMessageOptions): (options?: SubmitMessageOptions) => Promise<void> {
  const { t } = useTranslation("sessions");
  const store = useStore();
  const wpReadOnly = useAtomValue(wpReadOnlyAtom);

  return useCallback(
    async (options: SubmitMessageOptions = {}) => {
      if (wpReadOnly) {
        Message.warning(t("chat.noActiveSession"));
        return;
      }

      if (!refs.tiptapRef.current) return;

      let displayText = refs.tiptapRef.current.getTextWithPills();
      const hasText = displayText.trim().length > 0;
      const hasAttachedImages = imageAttachment.hasImages;

      if (!hasText && !hasAttachedImages) return;

      // ── Question intercept ────────────────────────────────────────────────
      // When the agent asked a question and the user typed a reply in the main
      // input, forward the typed text as the question answer before dispatching.
      if (hasText && draftSessionId) {
        const events = store.get(chatEventsAtom);
        for (const event of events) {
          if (event.sessionId && event.sessionId !== draftSessionId) continue;
          const batch = extractQuestionBatch(event);
          if (!batch) continue;
          const isFreeText = batch.questions.every(
            (question) => question.options.length === 0
          );
          if (isFreeText) {
            void respondQuestion(batch.sessionId, batch.questionId, [
              [displayText.trim()],
            ]).catch((err: unknown) => {
              console.warn("[useSubmitMessage] respondQuestion failed:", err);
            });
          } else {
            void rejectQuestion(batch.sessionId, batch.questionId).catch(
              (err: unknown) => {
                console.warn("[useSubmitMessage] rejectQuestion failed:", err);
              }
            );
          }
        }
      }

      // ── MCP slash-command resolution ─────────────────────────────────────
      try {
        const rendered = await resolveMcpSlashCommand(displayText.trim());
        if (rendered !== null) {
          displayText = rendered;
        }
      } catch (err) {
        Message.error(
          `MCP prompt failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      // ── Skill pill expansion ──────────────────────────────────────────────
      // displayText keeps `name [skill:/<name>]` for rendering pills in
      // history. The Rust backend expects `/<name>` to expand skill content,
      // so we extract the path token (already starts with "/") directly.
      const skillExpanded = displayText.replace(
        /([^[]+?)\s*\[skill:([^\]]+)\]/g,
        (_match, _displayName, skillPath: string) => skillPath
      );
      const hasSkillPills = skillExpanded !== displayText;

      // ── Context pill async loads ──────────────────────────────────────────
      const { waitForPendingPills } =
        await import("@src/util/contextPillContent");
      await waitForPendingPills();

      // ── Terminal pill text collection ─────────────────────────────────────
      const terminalTexts = refs.tiptapRef.current.getTerminalPillTexts();
      const terminalEntries = Object.entries(terminalTexts);
      let agentContent: string | undefined;
      if (terminalEntries.length > 0) {
        const blocks = terminalEntries.map(
          ([, text]) => "```\n" + text + "\n```"
        );
        const base = hasSkillPills ? skillExpanded : displayText;
        agentContent = base + "\n\n" + blocks.join("\n\n");
      } else if (hasSkillPills) {
        agentContent = skillExpanded;
      }

      const imageDataUrls = imageAttachment.images.map((img) => img.dataUrl);

      // ── Snapshot before optimistic clear ─────────────────────────────────
      // Lets us restore the full composer state (text + images + cite-code)
      // if the outgoing request fails, preventing silent data loss.
      const editorSnapshot = refs.tiptapRef.current.getSnapshot();
      const imagesSnapshot: ChatImageAttachment[] =
        imageAttachment.images.slice();
      const citeSnapshot: CiteCodeSnapshot | null = citeCode.isCiteCode
        ? citeCode.captureCiteCode()
        : null;

      // ── Optimistic clear ──────────────────────────────────────────────────
      refs.tiptapRef.current.clear();
      refs.setHasContent(false);
      if (citeCode.isCiteCode) {
        citeCode.clearCiteCode();
      }
      imageAttachment.clearImages();
      clearImageDraft(draftSessionId);

      if (draftSessionId) {
        void flushDraft("").catch((err: unknown) => {
          console.warn("[useSubmitMessage] flushDraft(clear) failed:", err);
        });
      }

      // ── Dispatch ──────────────────────────────────────────────────────────
      let submitSucceeded = false;
      try {
        const dispatchImages =
          imageDataUrls.length > 0 ? imageDataUrls : undefined;
        const overrideHandled = onSubmitOverride
          ? await onSubmitOverride({
              displayText: displayText || "(image)",
              agentContent,
              imageDataUrls: dispatchImages,
            })
          : false;
        if (!overrideHandled) {
          await handleSessChatSubmit(
            undefined,
            displayText || "(image)",
            agentContent,
            dispatchImages,
            options.forceSendNow ? { forceSendNow: true } : undefined
          );
        }
        submitSucceeded = true;
      } catch (err) {
        // ── Restore on failure ────────────────────────────────────────────
        // Each restore branch is independent so one failure doesn't block others.
        try {
          const editor = refs.tiptapRef.current;
          if (editor && editorSnapshot) {
            editor.setContent(editorSnapshot);
            refs.setHasContent(true);
            if (draftSessionId) {
              const restoredText = editor.getTextWithPills();
              void flushDraft(restoredText).catch((err: unknown) => {
                console.warn(
                  "[useSubmitMessage] flushDraft(restore) failed:",
                  err
                );
              });
            }
          }
        } catch (restoreErr) {
          console.warn(
            "[useSubmitMessage] failed to restore editor content:",
            restoreErr
          );
        }

        if (imagesSnapshot.length > 0) {
          try {
            imageAttachment.restoreImages(imagesSnapshot);
          } catch (restoreErr) {
            console.warn(
              "[useSubmitMessage] failed to restore image attachments:",
              restoreErr
            );
          }
        }

        if (citeSnapshot) {
          try {
            citeCode.restoreCiteCode(citeSnapshot);
          } catch (restoreErr) {
            console.warn(
              "[useSubmitMessage] failed to restore cite-code state:",
              restoreErr
            );
          }
        }

        const reason = err instanceof Error ? err.message : String(err);
        const baseMsg = t("chat.failedToSendMessage");
        Message.error(reason ? `${baseMsg}: ${reason}` : baseMsg);
      }

      if (!submitSucceeded) return;

      // ── Post-send cleanup ─────────────────────────────────────────────────
      if (draftSessionId && replyTargetEventId) {
        void clearReplyTarget().catch((err: unknown) => {
          console.warn(
            "[useSubmitMessage] clearReplyTarget(post-send) failed:",
            err
          );
        });
      }
    },
    [
      wpReadOnly,
      store,
      handleSessChatSubmit,
      citeCode,
      refs,
      imageAttachment,
      t,
      draftSessionId,
      flushDraft,
      replyTargetEventId,
      clearReplyTarget,
      onSubmitOverride,
    ]
  );
}
