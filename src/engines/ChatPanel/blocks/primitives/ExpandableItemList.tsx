/**
 * ExpandableItemList — sliced list + ExpandOverlay show more/less.
 * Consumed only by `EventBlockExpandableStackList` in `EventBlock.tsx` (glob, ls flat, tools).
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import ExpandOverlay from "@src/components/ExpandOverlay";
import { CHAT_EXPANDABLE_STACK_LIST_BODY_CLASSES } from "@src/config/composerStackTokens";

import { EVENT_BLOCK_CONTENT_BG, EVENT_BLOCK_FADE_FROM } from "./config";

const DEFAULT_VISIBLE_COUNT = 6;

export interface ExpandableItemListProps<T> {
  items: T[];
  /** Render a single item. `displayed` is the currently visible slice (useful for isLast checks). */
  renderItem: (item: T, index: number, displayed: T[]) => React.ReactNode;
  getKey: (item: T, index: number) => string;
  visibleCount?: number;
  /** List body layout; defaults to `CHAT_EXPANDABLE_STACK_LIST_BODY_CLASSES` (composer stack spacing). */
  className?: string;
  emptyContent?: React.ReactNode;
  fadeFrom?: string;
  withBorder?: boolean;
}

function ExpandableItemListInner<T>({
  items,
  renderItem,
  getKey,
  visibleCount = DEFAULT_VISIBLE_COUNT,
  className = CHAT_EXPANDABLE_STACK_LIST_BODY_CLASSES,
  emptyContent,
  fadeFrom = EVENT_BLOCK_FADE_FROM,
  withBorder = true,
}: ExpandableItemListProps<T>) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const needsExpand = items.length > visibleCount;
  const hiddenCount = items.length - visibleCount;

  const displayed = useMemo(
    () => (expanded || !needsExpand ? items : items.slice(0, visibleCount)),
    [expanded, needsExpand, items, visibleCount]
  );

  if (items.length === 0) {
    if (emptyContent) return <>{emptyContent}</>;
    return null;
  }

  return (
    <div
      className={`group/expand relative ${withBorder ? "border border-border-1" : ""} ${EVENT_BLOCK_CONTENT_BG} ${expanded && needsExpand ? "scrollbar-hide" : ""} ${className}`}
      style={
        expanded && needsExpand
          ? { maxHeight: "40vh", overflowY: "auto", overflowX: "hidden" }
          : undefined
      }
    >
      {displayed.map((item, idx) => (
        <React.Fragment key={getKey(item, idx)}>
          {renderItem(item, idx, displayed)}
        </React.Fragment>
      ))}
      {needsExpand && (
        <ExpandOverlay
          isExpanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          collapsedLabel={`${t("common:showMore")} (${hiddenCount})`}
          fadeFrom={fadeFrom}
        />
      )}
    </div>
  );
}

const ExpandableItemList = React.memo(ExpandableItemListInner) as <T>(
  props: ExpandableItemListProps<T>
) => React.ReactElement | null;

export default ExpandableItemList;
