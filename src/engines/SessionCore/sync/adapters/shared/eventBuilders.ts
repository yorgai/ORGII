/**
 * Shared SessionEvent Factories + Stream Helpers
 *
 * Re-exports pure SessionEvent constructors (make*, create*).
 * Streaming deltas for Rust agent sessions are intentionally ephemeral and
 * must not be routed through this durable EventStore factory layer.
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
