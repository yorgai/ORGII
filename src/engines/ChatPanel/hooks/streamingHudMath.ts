/**
 * streamingHudMath
 *
 * Pure, dependency-free derivation of the streaming heads-up display
 * readout (elapsed / tokens / tokens-per-second / ETA). Kept separate from
 * `useStreamingHud` so the math is unit-testable without pulling in React
 * or the Jotai atom graph (which touches `localStorage`).
 *
 * Token counts are *estimates*: the Rust runtime only emits an
 * authoritative token total at `agent:complete`, with no per-delta count
 * on the wire. The HUD therefore estimates produced tokens from the
 * streaming delta string length using a fixed chars-per-token ratio.
 */

/** Average characters per token for English-ish LLM output. */
export const CHARS_PER_TOKEN = 4;

/**
 * Minimum elapsed time before a tokens/s figure is shown. Below this the
 * sample is too small and the rate swings wildly.
 */
export const MIN_ELAPSED_FOR_RATE_MS = 1_000;

/**
 * A typical agent answer length used as the ETA denominator. ETA is a
 * deliberately soft estimate — there is no way to know the true final
 * length mid-stream — so it is only surfaced while below this length.
 */
export const ETA_TARGET_TOKENS = 600;

export interface StreamingHudState {
  /** True while the HUD has meaningful data to render. */
  active: boolean;
  /** Whole seconds since the first streaming delta of this turn. */
  elapsedSecs: number;
  /** Estimated produced tokens so far. */
  tokens: number;
  /** Estimated tokens per second, or null until a stable sample exists. */
  tokensPerSec: number | null;
  /** Soft ETA in seconds to a typical answer length, or null when unknown. */
  etaSecs: number | null;
}

export const IDLE_HUD_STATE: StreamingHudState = {
  active: false,
  elapsedSecs: 0,
  tokens: 0,
  tokensPerSec: null,
  etaSecs: null,
};

/**
 * Pure derivation of the HUD readout from a delta string length and an
 * elapsed duration.
 *
 * @param deltaLength - Character count of the streamed answer so far.
 * @param elapsedMs   - Wall time since the first delta of this turn.
 */
export function computeStreamingHud(
  deltaLength: number,
  elapsedMs: number
): StreamingHudState {
  const safeElapsed = Math.max(0, elapsedMs);
  const tokens = Math.round(Math.max(0, deltaLength) / CHARS_PER_TOKEN);

  let tokensPerSec: number | null = null;
  let etaSecs: number | null = null;
  if (safeElapsed >= MIN_ELAPSED_FOR_RATE_MS && tokens > 0) {
    tokensPerSec = Math.round((tokens / safeElapsed) * 1_000);
    if (tokensPerSec > 0 && tokens < ETA_TARGET_TOKENS) {
      etaSecs = Math.ceil((ETA_TARGET_TOKENS - tokens) / tokensPerSec);
    }
  }

  return {
    active: true,
    elapsedSecs: Math.floor(safeElapsed / 1_000),
    tokens,
    tokensPerSec,
    etaSecs,
  };
}
