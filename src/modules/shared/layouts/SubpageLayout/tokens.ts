/**
 * Subpage layout spacing tokens.
 *
 * Shared by SubpageLayout and Settings main content to keep
 * visual rhythm consistent (padding, max-width, section gaps, bottom breathing room).
 */
import { DETAIL_PANEL_TOKENS } from "../blocks";

export const SUBPAGE_SCROLL_CONTAINER_CLASSES =
  "h-full min-h-0 overflow-y-auto px-4 scrollbar-overlay";

export const SUBPAGE_CONTENT_WRAPPER_CLASSES = `${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col gap-10 py-6 pb-[50vh]`;

/** Main App Settings scroll content: no top padding under the panel header; keeps bottom padding + scroll affordance. */
export const SETTINGS_MAIN_CONTENT_WRAPPER_CLASSES = `${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col gap-10 ${DETAIL_PANEL_TOKENS.contentScrollBottom}`;

/** Main settings / panel content when a frosted PanelHeader overlays the top (scroll runs beneath the header). */
export const SUBPAGE_CONTENT_WRAPPER_UNDER_PANEL_HEADER_CLASSES = `${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col gap-10 pt-10 pb-[50vh]`;
