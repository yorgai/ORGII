/**
 * Thinking / observation data extractor.
 */
import type {
  ExtractedThinkingData,
  UniversalEventProps,
} from "../types/universalProps";
import { safeText } from "./extractorShared";

export function extractThinkingData(
  props: UniversalEventProps
): ExtractedThinkingData {
  if (props.rustExtracted?.kind === "thinking") {
    const { content, duration } = props.rustExtracted;
    return { content: props.streamingContent || content, duration };
  }

  const { result, args, streamingContent } = props;

  const content =
    streamingContent ||
    safeText(result?.thought) ||
    safeText(result?.content) ||
    safeText(result?.observation) ||
    safeText(args?.content) ||
    undefined;

  const duration = (result?.duration as number) || undefined;

  return { content, duration };
}
