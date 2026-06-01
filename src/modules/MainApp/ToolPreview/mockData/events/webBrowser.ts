import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { createEvent } from "../shared";

export const webBrowserEvents: Record<string, SessionEvent> = {
  web_search: createEvent(
    "web_search",
    { query: "React 19 new features" },
    {
      success: true,
      results: [
        {
          title: "React 19 Release Notes",
          url: "https://react.dev/blog/2024/react-19",
          snippet:
            "React 19 introduces new features including Actions, useOptimistic, and improved Server Components...",
        },
        {
          title: "What's New in React 19",
          url: "https://example.com/react-19-features",
          snippet:
            "A comprehensive guide to the new features in React 19, including the new compiler...",
        },
      ],
    }
  ),

  browser: createEvent(
    "browser",
    {
      action: "navigate",
      url: "https://example.com/login",
    },
    {
      success: true,
      screenshot: null,
      page_title: "Login - Example App",
    }
  ),

  internal_browser: createEvent(
    "internal_browser",
    {
      action: "click",
      selector: "#submit-button",
    },
    {
      success: true,
      element_found: true,
    }
  ),
};
