import type { CanvasInlineMode } from "./types";

export type CanvasPreviewSurfaceVariant = "inline" | "tab" | "simulator";
export type CanvasPreviewRenderKind =
  | "a2ui"
  | "html"
  | "react"
  | "url"
  | "empty";

export interface CanvasPreviewPayload {
  mode: CanvasInlineMode;
  content?: string;
  url?: string;
  title?: string;
  streaming?: boolean;
}

export const CANVAS_HTML_IFRAME_SANDBOX = "allow-scripts";
export const CANVAS_URL_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms";
export const CANVAS_URL_IFRAME_SANDBOX_WITH_POPUPS = `${CANVAS_URL_IFRAME_SANDBOX} allow-popups`;

export function getCanvasUrlIframeSandbox(
  variant: CanvasPreviewSurfaceVariant
): string {
  return variant === "tab"
    ? CANVAS_URL_IFRAME_SANDBOX_WITH_POPUPS
    : CANVAS_URL_IFRAME_SANDBOX;
}

export function getCanvasPreviewRenderKind(
  payload: CanvasPreviewPayload | null | undefined
): CanvasPreviewRenderKind {
  if (!payload) return "empty";
  if (payload.mode === "url" && payload.url) return "url";
  if (payload.mode === "a2ui" && payload.content) return "a2ui";
  if (payload.mode === "react" && payload.content) return "react";
  if (payload.mode === "html" && payload.content) return "html";
  return "empty";
}

export function splitA2UIContent(content: string): string[] {
  const result: string[] = [];
  const physicalLines = content.split("\n");
  let buffer = "";

  for (const line of physicalLines) {
    buffer = buffer.length === 0 ? line : `${buffer}\n${line}`;
    const trimmed = buffer.trim();
    if (trimmed.length === 0) {
      buffer = "";
      continue;
    }
    try {
      JSON.parse(trimmed);
      result.push(trimmed);
      buffer = "";
    } catch {
      // Incomplete JSON — keep accumulating across physical newlines.
    }
  }

  return result;
}
