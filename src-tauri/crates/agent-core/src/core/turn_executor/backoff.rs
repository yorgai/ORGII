//! Constants and helpers for the turn-executor retry / backoff policy.
//!
//! Centralizes the magic numbers and the two pure helpers
//! (`cache_hit_rate`, `stream_backoff_ms`) that drive the streaming retry
//! loop in `execute_turn`. Kept in its own file so the policy is auditable
//! at a glance without scrolling through the 800-line agent loop.

use crate::providers::traits::StreamErrorKind;

/// Maximum number of identical repeated tool call signatures before breaking.
pub(super) const MAX_REPEAT_STREAK: u32 = 3;

/// Maximum consecutive tool errors before breaking the loop.
pub(super) const MAX_CONSECUTIVE_ERRORS: u32 = 8;

/// Maximum characters in a tool result before truncation.
pub(crate) const MAX_TOOL_OUTPUT_CHARS: usize = 100_000;

/// Maximum auto-continue attempts when the model hits the output token limit.
/// Ref: claude_code query.ts MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
pub(super) const MAX_OUTPUT_RECOVERY_ATTEMPTS: u32 = 3;

/// Tier-1 escalation ceiling: when the first truncation hits and the current
/// max_tokens is below this value, silently retry at this higher limit with
/// no user-visible message injected into the transcript.
/// Ref: claude_code utils/context.ts ESCALATED_MAX_TOKENS = 64_000
pub(super) const ESCALATED_MAX_TOKENS: u32 = 64_000;

/// Maximum number of consecutive stream-error retries within a single turn
/// for non-overload errors (connection drops, idle timeouts, generic
/// provider errors). Matches `DEFAULT_MAX_RETRIES` in claude_code
/// `services/api/withRetry.ts`. When exhausted, we surface a user-visible
/// error instead of looping forever (the old behavior, which caused
/// "stream interrupted" to appear to retry indefinitely whenever the
/// upstream provider was flapping).
pub(super) const MAX_STREAM_ERROR_RETRIES: u32 = 10;

/// Maximum number of consecutive **overload** retries before bailing.
/// An overload signal (`StreamErrorKind::Overloaded`) gets a much shorter
/// budget than a transient connection drop because:
///   1. The upstream is explicitly telling us "I'm at capacity" — hammering
///      it faster won't help and is gateway-cache-thrashy.
///   2. During a capacity cascade each retry is 3-10× gateway amplification.
///   3. When we do give up, the user can retry manually seconds later and
///      often succeeds because the cascade has moved on.
pub(super) const MAX_OVERLOADED_RETRIES: u32 = 3;

/// Base backoff in milliseconds before retrying a stream error. The actual
/// sleep doubles per attempt (up to `MAX_BACKOFF_MS`) with +/-25% jitter.
/// See `stream_backoff_ms`.
pub(super) const STREAM_BACKOFF_BASE_MS: u64 = 500;

/// Hard cap on backoff regardless of attempt number.
pub(super) const STREAM_BACKOFF_MAX_MS: u64 = 32_000;

/// Threshold above which we split a single sleep into periodic heartbeat
/// chunks so the frontend footer can update its countdown. Below this, we
/// sleep monolithically — sub-second and few-second waits don't need UI
/// updates.
pub(super) const BACKOFF_HEARTBEAT_INTERVAL_MS: u64 = 5_000;

/// Compute the prompt-cache hit rate `cache_read / (cache_read +
/// billable_input)`. Returns 0.0 when both inputs are zero (no usage
/// recorded yet) so the metric is safe to log unconditionally.
///
/// Note: Anthropic reports `prompt_tokens` excluding `cache_read`, so
/// the denominator is `cache_read + prompt_tokens` — the total
/// effective input the LLM saw on this call. This is the number that
/// maps directly to cost: at 90% the prompt is ~10% of normal price.
pub(super) fn cache_hit_rate(cache_read: i64, billable_input: i64) -> f64 {
    let denom = cache_read.saturating_add(billable_input).max(0) as f64;
    if denom <= 0.0 {
        0.0
    } else {
        (cache_read.max(0) as f64) / denom
    }
}

/// Test-only backoff override. Production code never touches this — it stays
/// at 0 (the "unset" sentinel) and `stream_backoff_ms` behaves exactly as
/// documented. Tests that want to exercise the retry loop *without* burning
/// 30+ seconds on real exponential sleeps can flip this to e.g. 5ms so the
/// full 3-attempt overloaded path runs in <100ms.
///
/// Scoped to a single test binary (each `cargo test` invocation gets its
/// own process). The helper `set_test_backoff_override_ms` is `#[cfg(test)]`
/// so it can't leak into the agent runtime binary.
#[cfg(test)]
static TEST_BACKOFF_OVERRIDE_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

#[cfg(test)]
pub(crate) fn set_test_backoff_override_ms(ms: u64) {
    TEST_BACKOFF_OVERRIDE_MS.store(ms, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(test)]
fn test_backoff_override_ms() -> u64 {
    TEST_BACKOFF_OVERRIDE_MS.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(not(test))]
#[inline(always)]
fn test_backoff_override_ms() -> u64 {
    0
}

/// Compute the next backoff delay in ms for a stream-error retry.
///
/// Policy:
///   - Exponential: `base * 2^(attempt - 1)`, clamped to `STREAM_BACKOFF_MAX_MS`.
///   - Per-kind multiplier:
///     - `Overloaded`: ×4. With `MAX_OVERLOADED_RETRIES = 3` and the fact
///       that capacity cascades need time to cool, we want a 2s / 4s / 8s
///       spread rather than the 500ms / 1s / 2s the plain exponential
///       would give.
///     - `IdleTimeout`: ×2. The upstream is silently overloaded (no frames
///       at all for 90s), so give it extra breathing room.
///     - `ConnectionError`: ×1. Fresh socket usually recovers immediately.
///     - `ProviderError`: ×1. Use plain exponential — could be a one-off 5xx.
///     - `Unknown`: ×1. Conservative default.
///   - Jitter: ±25% to avoid thundering-herd when many sessions retry in lockstep.
pub(super) fn stream_backoff_ms(attempt: u32, kind: StreamErrorKind) -> u64 {
    // Test escape hatch: when the override is set (never in production), use
    // it as a flat constant backoff so retry-loop tests run in milliseconds
    // instead of seconds. The override intentionally bypasses the per-kind
    // multiplier and jitter so tests can assert exact timing.
    let override_ms = test_backoff_override_ms();
    if override_ms > 0 {
        return override_ms;
    }

    let attempt = attempt.max(1);
    // `2u64.pow(attempt - 1)` without overflow: attempt is bounded by
    // MAX_STREAM_ERROR_RETRIES = 10, so shift at most by 9 (safe for u64).
    let multiplier = 1u64 << (attempt - 1).min(10);
    let kind_multiplier: u64 = match kind {
        StreamErrorKind::Overloaded => 4,
        StreamErrorKind::IdleTimeout => 2,
        StreamErrorKind::ProviderError => 1,
        StreamErrorKind::ConnectionError => 1,
        StreamErrorKind::Unknown => 1,
    };
    let raw = STREAM_BACKOFF_BASE_MS
        .saturating_mul(multiplier)
        .saturating_mul(kind_multiplier)
        .min(STREAM_BACKOFF_MAX_MS);
    // Deterministic pseudo-jitter seeded from (attempt, raw) — we don't pull
    // in `rand` just for this and tokio's runtime already adds natural variance.
    let jitter_pct = ((attempt as u64).wrapping_mul(7919).wrapping_add(raw)) % 50;
    let jitter = raw.saturating_mul(jitter_pct) / 200; // ±25% range, centered
    raw.saturating_add(jitter).min(STREAM_BACKOFF_MAX_MS)
}
