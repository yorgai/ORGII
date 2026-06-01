/**
 * Pure entry-classification + display helpers shared between BrowserSidebar
 * and the replay tab bar. The icon helpers stay sidebar-private because they
 * encode active-state colouring that the tab bar handles differently (the
 * whole tab background changes, the icon doesn't).
 */
import { getInternalBrowserActionTitle } from "./config";
import type { BrowserEntry, InternalBrowserEntry } from "./types";

export type EntryCategory =
  | "browser"
  | "web_search"
  | "web_fetch"
  | "internal_browser";

export function categorizeBrowserEntry(entry: BrowserEntry): EntryCategory {
  const fn = entry.event.functionName;
  if (fn === "web_search" || fn === "WebSearch") return "web_search";
  if (fn === "web_fetch" || fn === "WebFetch") return "web_fetch";
  return "browser";
}

/**
 * Short, human-readable label for a native browser action — used both in the
 * sidebar tree and in the tab strip so the user sees the same text in both
 * places.
 */
export function getNativeEntryDisplayName(entry: InternalBrowserEntry): string {
  const title = getInternalBrowserActionTitle(entry.action);

  switch (entry.action) {
    case "click":
      return entry.index !== undefined ? `${title} [${entry.index}]` : title;
    case "input":
      if (entry.index !== undefined && entry.text) {
        const truncatedText =
          entry.text.length > 15 ? `${entry.text.slice(0, 15)}...` : entry.text;
        return `${title} [${entry.index}] "${truncatedText}"`;
      }
      return entry.index !== undefined ? `${title} [${entry.index}]` : title;
    case "select":
      if (entry.index !== undefined && entry.option) {
        return `${title} [${entry.index}] "${entry.option}"`;
      }
      return entry.index !== undefined ? `${title} [${entry.index}]` : title;
    case "scroll":
      return entry.direction ? `${title} ${entry.direction}` : title;
    default:
      return title;
  }
}
