/**
 * Context Pill Content Helpers
 *
 * Utilities for loading and formatting content when inserting @session
 * and @browser pills. Content is stored in window.__orgiiTerminalPillTexts
 * and appended to the agent message on send.
 */
import { invoke } from "@tauri-apps/api/core";

import { type TodoEntry, projectApi } from "@src/api/http/project";
import { storePillText } from "@src/config/pillTokens";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { loadEvents } from "@src/engines/SessionCore/storage/cacheAdapter";
import { createLogger } from "@src/hooks/logger";
import { globalTabsAtom } from "@src/store/ui/globalTabsAtom";
import type { ActivityChunk } from "@src/types/session/session";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const logger = createLogger("contextPill");

const MAX_CONTENT_LENGTH = 100_000;
const MAX_TOOL_OUTPUT_LENGTH = 200;

const pendingLoads = new Map<string, Promise<void>>();

function summarizeToolCall(event: SessionEvent): string {
  const fn = event.functionName || "unknown";
  const args = event.args || {};

  const filePath = args.file_path || args.path || args.filepath;
  if (filePath) return `[Tool: ${fn}] ${filePath}`;

  const command = args.command;
  if (command) {
    const cmd = String(command);
    return `[Tool: ${fn}] ${cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd}`;
  }

  const query = args.query || args.search_query;
  if (query) return `[Tool: ${fn}] query: ${query}`;

  return `[Tool: ${fn}]`;
}

function formatSessionEvents(events: SessionEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    const text = event.displayText?.trim();
    if (!text) continue;

    switch (event.displayVariant) {
      case "message": {
        const role = event.source === "user" ? "User" : "Agent";
        lines.push(`${role}: ${text}`);
        break;
      }
      case "tool_call": {
        const summary = summarizeToolCall(event);
        const result = event.result as Record<string, unknown>;
        const output =
          (result?.observation as string) || (result?.content as string) || "";
        if (output && output.length > 0) {
          const trimmed =
            output.length > MAX_TOOL_OUTPUT_LENGTH
              ? output.slice(0, MAX_TOOL_OUTPUT_LENGTH) + "..."
              : output;
          lines.push(`${summary}\n${trimmed}`);
        } else {
          lines.push(summary);
        }
        break;
      }
      case "error": {
        lines.push(`[Error] ${text}`);
        break;
      }
    }
  }
  let result = lines.join("\n\n");
  if (result.length > MAX_CONTENT_LENGTH) {
    result = result.slice(-MAX_CONTENT_LENGTH);
    const firstNewline = result.indexOf("\n");
    if (firstNewline > 0) result = result.slice(firstNewline + 1);
  }
  return result;
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let text = doc.body?.innerText || "";
  if (text.length > MAX_CONTENT_LENGTH) {
    text = text.slice(0, MAX_CONTENT_LENGTH) + "\n[... truncated]";
  }
  return text;
}

interface SessionEventLoadResult {
  events: SessionEvent[];
  source: "events" | "chunks" | "none";
  errors: string[];
}

async function loadSessionEventsWithFallback(
  sessionId: string
): Promise<SessionEventLoadResult> {
  const errors: string[] = [];

  try {
    const events = await loadEvents(sessionId);
    if (events.length > 0) {
      return { events, source: "events", errors };
    }
    errors.push("loadEvents returned empty");
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    errors.push(`loadEvents failed: ${errorMessage}`);
  }

  try {
    const chunks = await invoke<ActivityChunk[]>("cli_agent_chunks", {
      sessionId,
    });
    if (!Array.isArray(chunks) || chunks.length === 0) {
      errors.push("cli_agent_chunks returned empty");
      return { events: [], source: "none", errors };
    }

    const events = await processChunksRust(chunks, sessionId);
    if (events.length === 0) {
      errors.push("cli_agent_chunks normalized to empty events");
      return { events: [], source: "none", errors };
    }

    return { events, source: "chunks", errors };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    errors.push(`cli_agent_chunks failed: ${errorMessage}`);
    return { events: [], source: "none", errors };
  }
}

/**
 * Wait for all pending async pill content loads to complete.
 * Call before collecting pill texts on send to avoid race conditions.
 */
export async function waitForPendingPills(): Promise<void> {
  if (pendingLoads.size === 0) return;
  await Promise.all(pendingLoads.values());
}

/**
 * Load session chat history and store as pill content.
 * Called after pill insertion so the content is available when the user sends.
 */
export function loadSessionPillContent(
  sessionId: string,
  pillPath: string
): void {
  const promise = loadSessionEventsWithFallback(sessionId)
    .then(({ events, source, errors }) => {
      const formatted = formatSessionEvents(events);
      if (formatted) {
        storePillText(pillPath, formatted);
        if (source === "chunks") {
          logger.info(
            `Session ${sessionId} loaded from cli_agent_chunks fallback.`
          );
        }
      } else {
        const debugHint =
          errors.length > 0 ? `\nDebug: ${errors.join(" | ")}` : "";
        storePillText(
          pillPath,
          `[Session Context]\nSession ID: ${sessionId}\nNo events found for this session.${debugHint}`
        );
        logger.warn(
          `Session ${sessionId} has no events from events/chunks sources.`
        );
      }
    })
    .catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      storePillText(
        pillPath,
        `[Session Context]\nSession ID: ${sessionId}\nFailed to load session events: ${errorMessage}`
      );
      logger.error("Failed to load session events:", err);
    })
    .finally(() => {
      pendingLoads.delete(pillPath);
    });
  pendingLoads.set(pillPath, promise);
}

/**
 * Load browser tab content (URL + page text) and store as pill content.
 * Falls back to URL-only if page content is unavailable (webview not mounted).
 */
export function loadBrowserPillContent(tabId: string, pillPath: string): void {
  const store = getInstrumentedStore();
  const tabs = store.get(globalTabsAtom);
  const tab = tabs.browser.find((browserTab) => browserTab.id === tabId);
  const url = tab?.url || "";
  const webviewLabel = `browser-session-${tabId}`;

  const promise = invoke<string>("get_full_html_document", {
    label: webviewLabel,
  })
    .then((html) => {
      const text = htmlToPlainText(html);
      const content = url ? `URL: ${url}\n\n${text}` : text;
      storePillText(pillPath, content);
    })
    .catch(() => {
      if (url) {
        storePillText(pillPath, `URL: ${url}`);
      }
    })
    .finally(() => {
      pendingLoads.delete(pillPath);
    });
  pendingLoads.set(pillPath, promise);
}

function formatTodos(todos: TodoEntry[]): string {
  if (todos.length === 0) return "";
  const lines = todos.map(
    (todo) => `- [${todo.status === "completed" ? "x" : " "}] ${todo.content}`
  );
  return `\n## Todos\n${lines.join("\n")}`;
}

/**
 * Load work item content (title, description, todos) and store as pill content.
 * `workItemPath` is "projectSlug/shortId", `pillPath` is the full workitem:// URI.
 */
export function loadWorkItemPillContent(
  workItemPath: string,
  pillPath: string
): void {
  const [projectSlug, shortId] = workItemPath.split("/");
  if (!projectSlug || !shortId) {
    storePillText(pillPath, `[Work Item] Invalid path: ${workItemPath}`);
    return;
  }

  const promise = projectApi
    .readWorkItem(projectSlug, shortId)
    .then((item) => {
      const parts: string[] = [
        `[Work Item: ${item.frontmatter.short_id}]`,
        `Title: ${item.frontmatter.title}`,
        `Status: ${item.frontmatter.status}`,
        `Priority: ${item.frontmatter.priority}`,
      ];
      if (item.frontmatter.assignee) {
        parts.push(`Assignee: ${item.frontmatter.assignee}`);
      }
      if (item.frontmatter.labels.length > 0) {
        parts.push(`Labels: ${item.frontmatter.labels.join(", ")}`);
      }
      if (item.body.trim()) {
        parts.push(`\n## Description\n${item.body.trim()}`);
      }
      parts.push(formatTodos(item.frontmatter.todos));

      let content = parts.filter(Boolean).join("\n");
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n[... truncated]";
      }
      storePillText(pillPath, content);
    })
    .catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      storePillText(
        pillPath,
        `[Work Item] ${workItemPath}\nFailed to load: ${errorMessage}`
      );
    })
    .finally(() => {
      pendingLoads.delete(pillPath);
    });
  pendingLoads.set(pillPath, promise);
}
