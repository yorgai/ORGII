/**
 * SubagentChatPane
 *
 * Drop-in replacement for `SubagentEventPane` inside subagent grid cells.
 * Instead of routing a single replay-cursor event to CodePanel /
 * CompactEventView, this pane renders the chat stream for the subagent
 * session using the same `ChatHistory` component the main chat panel
 * uses — wrapped in a `ChatSessionContext.Provider` so the chat events
 * atom is scoped to this subagent (not the globally-active session).
 *
 * Replay semantics
 *
 * When the cell's replay slider is anywhere except the live tail, the
 * pane must show ONLY events that already happened up to that point. We
 * achieve that by reading the session-scoped chat events here, slicing
 * them at `cursorMs`, and pushing the slice through
 * `ChatHistoryOverrideContext`. `useChatHistory()` reads the override
 * first, so ChatHistory renders exactly the sliced array. When the
 * cursor is at the live tail (or absent), we pass no override and
 * ChatHistory follows streaming normally.
 *
 * Per-turn user prompt card ("pinned message")
 *
 * Per-turn collapse — disabled
 *
 * In turn-pagination mode every page is exactly one turn, which means
 * the currently-rendered group is always the "tail" group. The main
 * ChatPanel collapses tail groups once the session idles (the "Agent
 * worked for X" pin bar), which is the wrong default for a subagent
 * cell: the whole point of the cell is to show the latest events for
 * that subagent, not to hide them behind a collapse pin. We opt out
 * via `disableTailCollapse` so the active round always renders
 * expanded with the new-event divider visible.
 *
 * Every turn group is rendered with a sticky user-message header at the
 * top (the "Task assigned by Coordinator: …" card in the screenshot —
 * actually `GroupHeaderRenderer` → `<UserChatItem>`). For subagent
 * cells that card is noise — the user already knows what was
 * assigned. We hide it by default by passing `hideGroupUserMessage`
 * through to ChatHistory; the "Agent worked for X" collapse pin
 * (`TurnCollapsePinBar`, same renderer, separate branch) stays visible
 * because it's the only "where am I in this turn" affordance left.
 *
 * A trailing message-icon button injected into `TurnPaginationControls`
 * (via `paginationTrailingSlot`) flips local `showGroupUserMessage`
 * state on so the user can re-surface the prompt without leaving the
 * cell. A second collapse-all button next to it calls the same global
 * atom the main ChatPanel header uses.
 * `PlanTodoPinBar` stays permanently hidden via `hidePinnedBars`
 * — it's the parent session's affordance, not the subagent cell's.
 *
 * "New event" divider
 *
 * The newest event in each surviving turn is signposted with a
 * `---- New event ----` divider via `newEventDividerLabel`, mirroring
 * the Communication > messages "new message" affordance. No tail
 * windowing — `useChatGroups`' force-collapse + turn pagination
 * already cap each cell's rendered items per round, so an extra
 * windowing layer here would add complexity without meaningful RAM
 * savings (the event store atom holds the same set either way).
 *
 * The pane never renders an `InputArea` — composing replies to subagents
 * is a separate, deferred concern. The cell stays read-only.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Info, ListChevronsDownUp } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { ChatProvider } from "@src/contexts/workspace/ChatContext";
import ChatHistory from "@src/engines/ChatPanel/ChatHistory";
import { ChatHistoryOverrideContext } from "@src/engines/ChatPanel/ChatHistoryOverrideContext";
import { ChatSessionContext } from "@src/engines/ChatPanel/ChatSessionContext";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import { setAllBlocksCollapsedAtom } from "@src/store/ui/collapseStateAtom";

interface SubagentChatPaneProps {
  /** Subagent session id — passed to ChatSessionContext so the chat events
   *  atom routes to `chatEventsForSessionAtomFamily(sessionId)`. */
  sessionId: string;
  /** Replay cursor timestamp in epoch ms. When set, chat events are
   *  sliced to only include events with `createdAt <= cursorMs`. When
   *  `null`, no slicing is applied (live tail). */
  cursorMs?: number | null;
}

const SubagentChatPaneComponent: React.FC<SubagentChatPaneProps> = ({
  sessionId,
  cursorMs = null,
}) => {
  const { t } = useTranslation("sessions");
  // Top per-turn user-message header (the "Task assigned by
  // Coordinator: …" card). Hidden by default so the cell focuses on
  // the subagent's narration. The toggle lives in the pagination row
  // (injected via `paginationTrailingSlot`) so it sits with the round
  // controls rather than the replay footer.
  const [showGroupUserMessage, setShowGroupUserMessage] = useState(false);
  // Subscribe at this layer so we can slice before passing into ChatHistory.
  // ChatHistory re-reads via `useChatHistory()` and picks up our override.
  const allEvents = useAtomValue(chatEventsForSessionAtomFamily(sessionId));

  const setAllBlocksCollapsed = useSetAtom(setAllBlocksCollapsedAtom);
  const handleCollapseAll = useCallback(() => {
    setAllBlocksCollapsed(true);
  }, [setAllBlocksCollapsed]);

  // Slice events to the replay cursor. When `cursorMs` is null OR the
  // cursor is at/past the last event, we pass `undefined` so the
  // ChatHistory pipeline reads the full array directly from the atom
  // (live-tail mode, no override allocation).
  const slicedEvents = useMemo(() => {
    if (cursorMs == null) return undefined;
    if (allEvents.length === 0) return undefined;
    // Fast path: if the cursor is at or past the last event, no slice
    // needed. Comparing createdAt strings lexicographically is safe for
    // ISO-8601 timestamps.
    const lastCreatedAt = allEvents[allEvents.length - 1].createdAt;
    const lastMs = Date.parse(lastCreatedAt);
    if (Number.isFinite(lastMs) && cursorMs >= lastMs) return undefined;

    // Binary-search for the largest index whose createdAt <= cursorMs.
    let lo = 0;
    let hi = allEvents.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = Date.parse(allEvents[mid].createdAt);
      if (Number.isFinite(t) && t <= cursorMs) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) {
      // Cursor is before any chat event — render an empty list.
      return [];
    }
    return allEvents.slice(0, best + 1);
  }, [allEvents, cursorMs]);

  // When the session has no events at all (yet), render a minimal static
  // placeholder instead of routing into ChatHistory. ChatHistory's empty
  // path surfaces a "Session data may not have loaded — Reload" prompt
  // which is the wrong affordance for a subagent cell that simply hasn't
  // produced any output yet (or whose owner hasn't been delegated a
  // task). The cell still re-renders automatically once the first event
  // streams in.
  if (allEvents.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-chat-pane px-4 text-center">
        <span className="text-[12px] text-text-3">
          {t("simulator.subagentPane.waitingForActivity", {
            defaultValue: "Waiting for activity…",
          })}
        </span>
      </div>
    );
  }

  // Subagent cells default to *paginated* turn view: a single turn per
  // page with prev/next/page-list controls along the top. This is the
  // dense overview the user wants — instead of force-collapsing every
  // turn and stacking dozens of "show messages" rows, the pagination
  // bar IS the affordance for moving between turns. The agent / member
  // pills inside `TurnPaginationControls` self-hide when no
  // `agentOrgMembers` / `agentName` / overview panel is supplied (none
  // are here), so the row collapses down to just the turn pager.
  //
  // Trailing slot: an info-icon button placed immediately to the right
  // of the round-select trigger (the TurnPaginationControls renders a
  // `|` separator between them). Pressed = each turn's user-message
  // header ("Task assigned by Coordinator: …") is visible. We tag it
  // "active" with `bg-surface-hover text-primary-6` so the toggle state
  // is glanceable even when the card is scrolled offscreen.
  const groupUserMessageToggle = (
    <>
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        data-testid="subagent-group-user-message-toggle"
        aria-pressed={showGroupUserMessage}
        className={
          showGroupUserMessage ? "!bg-surface-hover !text-primary-6" : ""
        }
        onClick={() => setShowGroupUserMessage((prev) => !prev)}
        title={
          showGroupUserMessage
            ? t("simulator.subagentPane.hideTurnPrompt", {
                defaultValue: "Hide turn prompt",
              })
            : t("simulator.subagentPane.showTurnPrompt", {
                defaultValue: "Show turn prompt",
              })
        }
        icon={<Info size={16} strokeWidth={1.75} />}
      />
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        data-testid="subagent-collapse-all"
        onClick={handleCollapseAll}
        title={t("chat.collapseAll")}
        aria-label={t("chat.collapseAll")}
        icon={<ListChevronsDownUp size={16} strokeWidth={2} />}
      />
    </>
  );

  const newEventDividerLabel = t("simulator.subagentPane.newEventDivider", {
    defaultValue: "New event",
  });

  return (
    <ChatSessionContext.Provider value={sessionId}>
      <ChatHistoryOverrideContext.Provider value={slicedEvents}>
        <ChatProvider>
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <ChatHistory
                surfaceBgClass="bg-chat-pane"
                turnPaginationEnabled
                hidePinnedBars
                disableTailCollapse
                hideGroupUserMessage={!showGroupUserMessage}
                paginationTrailingSlot={groupUserMessageToggle}
                newEventDividerLabel={newEventDividerLabel}
              />
            </div>
          </div>
        </ChatProvider>
      </ChatHistoryOverrideContext.Provider>
    </ChatSessionContext.Provider>
  );
};

export const SubagentChatPane = memo(SubagentChatPaneComponent);
SubagentChatPane.displayName = "SubagentChatPane";
