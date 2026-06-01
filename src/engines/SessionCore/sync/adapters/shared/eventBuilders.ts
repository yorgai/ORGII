/**
 * Shared SessionEvent Factories + Stream Helpers
 *
 * Re-exports from the two focused modules:
 *   - eventFactories: pure SessionEvent constructors (make*, create*)
 *   - streamBuffer:   throttled delta buffer and stream-ref helpers
 *
 * Importers can either use this barrel or import from the focused files
 * directly when they only need one half.
 */
export type { ErrorEventOptions } from "./eventFactories";
export {
  createSyntheticUserEvent,
  makeAssistantEvent,
  makeErrorEvent,
  makeRateLimitHintEvent,
  makeSummaryEvent,
  makeThinkingEvent,
  makeToolCallEvent,
  makeToolResultEvent,
} from "./eventFactories";
export {
  appendStreamDelta,
  finalizeStream,
  flushPendingStreamDeltas,
  getPendingFlushSize,
  PENDING_FLUSH_MAX_ENTRIES,
  resetStreamRefs,
} from "./streamBuffer";
