/**
 * Session history list UI tokens
 *
 * Shared by ChatPanelHistoryPanel, ChatPrimarySidebar, and similar session lists.
 */

export const SESSION_HISTORY_LIST_TOKENS = {
  /** Grouped sections (category, date bucket, etc.) — full-width bar below rows */
  loadMoreWrapGroup: "w-full pb-2 pt-1",
  /** Full-width “show more” row (ellipsis icon + label) */
  loadMoreBarButton:
    "flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md border-none bg-transparent px-2 py-1.5 text-[12px] font-medium text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1",
  loadMoreEllipsisClass: "shrink-0 text-current",
  loadMoreEllipsisSize: 16,
  loadMoreEllipsisStroke: 2,
} as const;
