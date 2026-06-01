import type { BrowserEntry } from "../types";

const SCREENSHOT_MARKER_RE = /\[screenshot:([a-f0-9]{8,})\]/g;

export { SCREENSHOT_MARKER_RE };

export function parseBrowserJson(
  value: unknown
): { text?: string; screenshot?: string; url?: string } | null {
  if (typeof value !== "string" || !value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.text === "string" ||
      typeof parsed.screenshot === "string"
    )
      return parsed as { text?: string; screenshot?: string; url?: string };
  } catch {
    // Not JSON
  }
  return null;
}

export function resolveScreenshotMarker(
  text: string,
  cache: Map<string, string>
): string | null {
  const re = new RegExp(SCREENSHOT_MARKER_RE.source, "g");
  let match;
  while ((match = re.exec(text)) !== null) {
    const cached = cache.get(match[1]);
    if (cached) return cached;
  }
  return null;
}

export function stripScreenshotMarkers(text: string): string {
  return text.replace(SCREENSHOT_MARKER_RE, "").trim();
}

export function inferImageMime(base64: string): string {
  if (base64.startsWith("/9j/") || base64.startsWith("/9j"))
    return "image/jpeg";
  return "image/png";
}

export function extractEventScreenshot(
  event: BrowserEntry["event"],
  cache: Map<string, string>
): string | null {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return null;

  if (typeof result.screenshot === "string" && result.screenshot.length > 100)
    return result.screenshot as string;

  for (const field of ["output", "content", "observation"] as const) {
    const parsed = parseBrowserJson(result[field]);
    if (parsed?.screenshot && parsed.screenshot.length > 100)
      return parsed.screenshot;
  }

  for (const field of ["output", "content", "observation"] as const) {
    const val = result[field];
    if (typeof val === "string") {
      const resolved = resolveScreenshotMarker(val, cache);
      if (resolved) return resolved;
    }
  }

  return null;
}

export function extractEventUrl(event: BrowserEntry["event"]): string | null {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return null;

  if (typeof result.url === "string") return result.url as string;

  for (const field of ["output", "content", "observation"] as const) {
    const parsed = parseBrowserJson(result[field]);
    if (parsed?.url) return parsed.url;
  }
  return null;
}

export function extractEventText(event: BrowserEntry["event"]): string | null {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return null;

  for (const field of ["output", "content", "observation"] as const) {
    const raw = result[field];
    if (typeof raw !== "string" || raw.trim().length === 0) continue;

    const parsed = parseBrowserJson(raw);
    if (parsed?.text) return parsed.text;

    const stripped = stripScreenshotMarkers(raw);
    if (stripped.length > 0) return stripped;
  }
  return null;
}

/** Return screenshot marker IDs present in the event result but missing from cache. */
export function extractUnresolvedMarkerIds(
  event: BrowserEntry["event"],
  cache: Map<string, string>
): string[] {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return [];

  const ids: string[] = [];
  for (const field of ["output", "content", "observation"] as const) {
    const val = result[field];
    if (typeof val !== "string") continue;
    const re = new RegExp(SCREENSHOT_MARKER_RE.source, "g");
    let match;
    while ((match = re.exec(val)) !== null) {
      if (!cache.has(match[1])) ids.push(match[1]);
    }
  }
  return ids;
}

/** Check if the event result contains a screenshot marker (resolved or not). */
export function hasScreenshotMarker(event: BrowserEntry["event"]): boolean {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return false;
  for (const field of ["output", "content", "observation"] as const) {
    const val = result[field];
    if (typeof val === "string" && SCREENSHOT_MARKER_RE.test(val)) {
      SCREENSHOT_MARKER_RE.lastIndex = 0;
      return true;
    }
  }
  return false;
}
