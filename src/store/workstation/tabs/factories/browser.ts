/**
 * Browser Tab Factories
 *
 * Tab factories for the browser using defineTabFactory.
 */
import { defineTabFactory } from "../tabFactory";
import type { WorkStationTab } from "../types";

// ============================================
// Browser Session Tab
// ============================================

export interface BrowserSessionTabData {
  sessionId: string;
  url: string;
  incognito: boolean;
}

function getTitleFromUrl(url: string): string {
  try {
    if (url && url !== "about:blank") {
      const urlObj = new URL(url);
      return urlObj.hostname || "New Tab";
    }
  } catch {
    // Invalid URL
  }
  return "New Tab";
}

export const browserSessionTabFactory = defineTabFactory<BrowserSessionTabData>(
  {
    tabType: "browser-session",
    idStrategy: {
      type: "keyed",
      prefix: "browser-session",
      getKey: (data) => data.sessionId,
    },
    getTitle: (data) => getTitleFromUrl(data.url),
  }
);

export function createBrowserSessionTab(
  sessionId: string,
  url: string,
  incognito?: boolean
): WorkStationTab {
  return browserSessionTabFactory({
    sessionId,
    url,
    incognito: incognito ?? false,
  });
}
