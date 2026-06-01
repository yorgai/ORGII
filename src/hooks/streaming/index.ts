/**
 * Streaming-aware hooks for colocated subscriptions.
 *
 * These hooks subscribe directly to high-frequency data sources instead of
 * receiving values as props through intermediate components. This prevents
 * re-renders from cascading through expensive parent subtrees during streaming.
 *
 * Pattern inspired by Mux's CostsTabLabel / StatsTabLabel approach.
 */
export { useAgentWorkingRef } from "./useAgentWorkingRef";
