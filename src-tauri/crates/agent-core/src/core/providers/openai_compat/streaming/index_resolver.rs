//! Tool-call accumulator slot allocation for streaming chunks.

/// Resolve the accumulator slot for an incoming tool-call delta chunk.
///
/// OpenAI's streaming protocol **requires** every `tool_calls[]` entry
/// to carry an `index`, but several relays and Azure deployments drop
/// it on follow-up chunks. The previous implementation fell back to
/// `index=0`, which silently merged two distinct tool_calls' argument
/// deltas into a single string and produced concatenated-JSON parse
/// failures (see the `classify_invalid_args` "concatenated objects"
/// branch).
///
/// The new policy (caller passes the already-observed state in
/// `last_known_index` and `existing_indices`):
///
/// 1. **Explicit `index` on the chunk** — always honored. Updates
///    `last_known_index`.
/// 2. **No `index`, but chunk has `id` + `function.name`** — this is a
///    "new tool_call begins" marker. Allocate a fresh slot at
///    `max(existing_indices) + 1` (or `0` if none exist yet).
/// 3. **No `index`, bare continuation delta** — reuse
///    `last_known_index`. If no index has ever been seen yet, fall
///    back to `0` (same as before, but only for this narrow case).
///
/// This is a pure helper so it can be unit-tested.
pub(super) fn resolve_tool_call_index(
    delta_index: Option<usize>,
    has_id: bool,
    has_name: bool,
    last_known_index: Option<usize>,
    existing_indices: &[usize],
) -> usize {
    if let Some(idx) = delta_index {
        return idx;
    }
    if has_id && has_name {
        // New tool_call starting — allocate next free slot.
        return existing_indices.iter().copied().max().map_or(0, |m| m + 1);
    }
    // Bare continuation delta — reuse whatever slot we last touched.
    last_known_index.unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::resolve_tool_call_index;

    #[test]
    fn explicit_index_is_always_honored() {
        // Explicit index wins over any fallback reasoning.
        assert_eq!(
            resolve_tool_call_index(Some(3), false, false, Some(1), &[0, 1]),
            3
        );
        assert_eq!(resolve_tool_call_index(Some(0), true, true, None, &[]), 0);
    }

    #[test]
    fn first_chunk_with_no_index_allocates_zero() {
        // Brand-new tool_call: has id+name, no index, no existing slots.
        // Should allocate slot 0.
        assert_eq!(resolve_tool_call_index(None, true, true, None, &[]), 0);
    }

    #[test]
    fn continuation_without_index_reuses_last_slot() {
        // Bare arguments delta — same tool_call continuing.
        assert_eq!(
            resolve_tool_call_index(None, false, false, Some(0), &[0]),
            0
        );
    }

    #[test]
    fn new_tool_call_after_first_allocates_fresh_slot_not_zero() {
        // This is the bug fix: previously a second index-less tool_call
        // (with its own id+name) would collapse into slot 0 and clobber
        // the first one's args. Now it must get a fresh slot.
        assert_eq!(resolve_tool_call_index(None, true, true, Some(0), &[0]), 1);
    }

    #[test]
    fn interleaved_multi_tool_streaming_stays_separated() {
        // Simulate the full sequence of a provider that omits index
        // but sends id+name on every "new tool" chunk:
        //
        //   chunk 1: id="tc1", name="read_file", args='{"path'
        //   chunk 2: args='":"a.md"}'
        //   chunk 3: id="tc2", name="read_file", args='{"path":"b.md"}'
        //
        // Expected accumulator layout:
        //   slot 0: tc1 -> '{"path":"a.md"}'
        //   slot 1: tc2 -> '{"path":"b.md"}'
        let mut existing: Vec<usize> = vec![];
        let mut last: Option<usize> = None;

        // Chunk 1: new tool
        let idx1 = resolve_tool_call_index(None, true, true, last, &existing);
        assert_eq!(idx1, 0);
        existing.push(idx1);
        last = Some(idx1);

        // Chunk 2: bare continuation
        let idx2 = resolve_tool_call_index(None, false, false, last, &existing);
        assert_eq!(idx2, 0, "bare continuation must reuse the same slot");
        last = Some(idx2);

        // Chunk 3: second new tool
        let idx3 = resolve_tool_call_index(None, true, true, last, &existing);
        assert_eq!(idx3, 1, "second new tool must get a fresh slot, not 0");
    }

    #[test]
    fn last_known_index_not_zero_is_respected() {
        // Provider sent index=7 once, then dropped it on the next
        // continuation chunk. We must keep using 7, not fall back to 0.
        assert_eq!(
            resolve_tool_call_index(None, false, false, Some(7), &[7]),
            7
        );
    }

    #[test]
    fn new_tool_slot_picks_max_plus_one_across_sparse_indices() {
        // If the provider has already sent indices 2 and 5 explicitly,
        // a new index-less tool_call should land at 6, not 3.
        assert_eq!(
            resolve_tool_call_index(None, true, true, Some(5), &[2, 5]),
            6
        );
    }
}
