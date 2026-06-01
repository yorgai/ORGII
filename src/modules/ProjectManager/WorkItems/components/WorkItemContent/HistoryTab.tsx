import {
  ArrowRightLeft,
  ArrowUp,
  Bot,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { WORK_ITEM_HISTORY_ACTION } from "@src/api/http/project/types";
import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import Timeline from "@src/components/Timeline";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

import type { HistoryTabProps, TimelineEntry } from "./types";

const OS_AGENT_USERNAME = "os-agent";
const DELEGATION_PREFIX = "Delegation";

const TIMELINE_ICONS: Record<TimelineEntry["type"], React.ReactNode> = {
  [WORK_ITEM_HISTORY_ACTION.CREATED]: <Plus size={12} />,
  [WORK_ITEM_HISTORY_ACTION.UPDATED]: <Pencil size={12} />,
  [WORK_ITEM_HISTORY_ACTION.COMMENTED]: <MessageSquare size={12} />,
  [WORK_ITEM_HISTORY_ACTION.DELETED]: <Trash2 size={12} />,
  [WORK_ITEM_HISTORY_ACTION.RESTORED]: <RotateCcw size={12} />,
  [WORK_ITEM_HISTORY_ACTION.MOVED]: <ArrowRightLeft size={12} />,
};

const HistoryTab: React.FC<HistoryTabProps> = ({
  timelineEntries,
  currentUser,
  isSubscribed,
  onToggleSubscribe,
  commentText,
  onCommentTextChange,
  onCommentSubmit,
  isSubmittingComment,
  formatRelativeTime,
}) => {
  const { t } = useTranslation("projects");

  return (
    <div className="flex flex-1 flex-col">
      <div
        className={`${DETAIL_PANEL_TOKENS.sectionGap} flex items-center justify-between`}
      >
        <div className="flex items-center gap-3">
          <Button variant="tertiary" size="small" onClick={onToggleSubscribe}>
            {isSubscribed
              ? t("workItems.activity.unsubscribe")
              : t("workItems.activity.subscribe")}
          </Button>
          <Avatar
            size={24}
            style={{
              backgroundColor: currentUser.color || "var(--color-fill-3)",
              color: "var(--color-text-white)",
            }}
          >
            {currentUser.name.charAt(0).toUpperCase()}
          </Avatar>
        </div>
      </div>

      {timelineEntries.length > 0 && (
        <div className={DETAIL_PANEL_TOKENS.sectionGap}>
          <Timeline>
            {timelineEntries.map((entry) => {
              const isDelegationComment =
                entry.type === WORK_ITEM_HISTORY_ACTION.COMMENTED &&
                entry.userName === OS_AGENT_USERNAME &&
                entry.descriptions[0]?.startsWith(DELEGATION_PREFIX);

              return (
                <Timeline.Item
                  key={entry.id}
                  dot={
                    isDelegationComment ? (
                      <Bot size={12} />
                    ) : (
                      TIMELINE_ICONS[entry.type]
                    )
                  }
                >
                  {isDelegationComment ? (
                    <div className="flex items-start gap-2 rounded-md bg-primary-1/30 p-2">
                      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary-6" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-primary-6">
                            {t("workItems.activity.agent")}
                          </span>
                          <span className="text-xs text-text-3">
                            {formatRelativeTime(entry.timestamp)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-text-2">
                          {entry.descriptions[0]}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[13px] leading-snug">
                        <span className="font-medium text-text-1">
                          {entry.userName}
                        </span>
                        {entry.descriptions.length === 1 ? (
                          <span className="ml-1 text-text-2">
                            {entry.descriptions[0]}
                          </span>
                        ) : (
                          <details className="mt-0.5">
                            <summary className="inline cursor-pointer text-text-2 marker:text-text-4 hover:text-text-1">
                              {t("workItems.activity.editedFields", {
                                count: entry.descriptions.length,
                              })}
                            </summary>
                            <ul className="m-0 mt-1 list-disc pl-4">
                              {entry.descriptions.map(
                                (description, descriptionIndex) => (
                                  <li
                                    key={`${entry.id}-${descriptionIndex}`}
                                    className="text-xs text-text-3"
                                  >
                                    {description}
                                  </li>
                                )
                              )}
                            </ul>
                          </details>
                        )}
                      </div>
                      <span className="mt-1 block text-xs text-text-3">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </>
                  )}
                </Timeline.Item>
              );
            })}
          </Timeline>
        </div>
      )}

      <div className="mt-auto flex flex-col rounded-xl border border-border-2 bg-fill-1 px-3 pb-2 pt-3">
        <textarea
          className="max-h-[120px] min-h-[60px] w-full resize-none border-none bg-transparent text-sm text-text-1 outline-none placeholder:text-text-4"
          placeholder={t("workItems.activity.commentPlaceholder")}
          value={commentText}
          rows={2}
          onChange={(event) => onCommentTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommentSubmit();
            }
          }}
        />
        <div className="flex items-center justify-end">
          <Button
            variant={commentText.trim() ? "primary" : "secondary"}
            shape="circle"
            size="small"
            iconOnly
            icon={<ArrowUp size={16} />}
            onClick={onCommentSubmit}
            disabled={!commentText.trim() || isSubmittingComment}
            loading={isSubmittingComment}
          />
        </div>
      </div>
    </div>
  );
};

export default HistoryTab;
