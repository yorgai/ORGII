/**
 * Text Extraction Utilities
 *
 * Shared helpers for extracting text content from various message formats
 * (Claude, OpenAI, raw events) and detecting orchestrator system prompts.
 *
 * Used by ActivityRouter, chatItemPipeline/filters, and other places
 * that need to parse message content.
 */
import { decodeUnicodeEscapes } from "@src/util/data/unicode";

/**
 * Extract text content from various message formats.
 * Handles:
 * - Plain strings
 * - Claude/OpenAI content arrays: [{type: "text", text: "..."}]
 * - Wrapped objects with a `.content` field (recursive)
 */
export function extractTextFromContent(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    return decodeUnicodeEscapes(value);
  }
  if (Array.isArray(value)) {
    const textParts = value
      .filter(
        (item): item is { type: string; text: string } =>
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "text" &&
          typeof (item as Record<string, unknown>).text === "string"
      )
      .map((item) => decodeUnicodeEscapes(item.text));
    return textParts.length > 0 ? textParts.join("\n") : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.content !== undefined) {
      return extractTextFromContent(obj.content);
    }
  }
  return undefined;
}

export function extractAssistantMessageContent(event: {
  result?: Record<string, unknown>;
  displayText?: unknown;
}): string | null {
  const text =
    extractTextFromContent(event.result?.message) ||
    extractTextFromContent(event.result?.observation) ||
    extractTextFromContent(event.result?.content) ||
    extractTextFromContent(event.displayText);
  return text?.trim() ? text : null;
}

/**
 * Orchestrator system prompt patterns.
 * These are internal workflow instructions that should NOT be shown to users.
 */
const ORCHESTRATOR_PATTERNS: RegExp[] = [
  /^Create a technical specification/i,
  /^Break down this work into executable tasks/i,
  /^Enrich execution threads with context/i,
  /^Analyze the user's request/i,
  /^Review the completed work/i,
  /^Merge the following/i,
  /^Task:/i,
  /^Execute the following/i,
  /^Implement the following/i,
  /^Complete the following/i,
  /^\*\*Threads to Enrich:\*\*/i,
  /^\*\*WORKFLOW CONTEXT/i,
  /^\*\*IMPORTANT INSTRUCTIONS/i,
  /^Acceptance Criteria:/i,
];

/**
 * Check if a message is a system prompt from the orchestrator.
 * These are internal workflow instructions that should be filtered from chat UI.
 */
export function isOrchestratorSystemPrompt(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  return ORCHESTRATOR_PATTERNS.some((pattern) => pattern.test(trimmed));
}
