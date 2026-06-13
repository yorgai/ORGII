/**
 * Thinking / observation data extractor.
 */
import type {
  ExtractedThinkingData,
  UniversalEventProps,
} from "../types/universalProps";
import { safeText } from "./extractorShared";

function normalizeDuration(
  value: unknown,
  unit: "ms" | "seconds"
): number | undefined {
  if (typeof value !== "number" || value <= 0) return undefined;
  return unit === "seconds" ? value * 1000 : value;
}

export function extractThinkingData(
  props: UniversalEventProps
): ExtractedThinkingData {
  if (props.rustExtracted?.kind === "thinking") {
    const { content, duration } = props.rustExtracted;
    return {
      content: props.streamingContent || content,
      duration: normalizeDuration(duration, "seconds"),
    };
  }

  const { result, args, streamingContent } = props;

  const content =
    streamingContent ||
    safeText(result?.thought) ||
    safeText(result?.content) ||
    safeText(result?.observation) ||
    safeText(args?.content) ||
    undefined;

  const duration =
    normalizeDuration(result?.durationMs, "ms") ??
    normalizeDuration(result?.duration_ms, "ms") ??
    normalizeDuration(args?.durationMs, "ms") ??
    normalizeDuration(args?.duration_ms, "ms") ??
    normalizeDuration(result?.duration, "seconds") ??
    normalizeDuration(args?.duration, "seconds");

  return { content, duration };
}
