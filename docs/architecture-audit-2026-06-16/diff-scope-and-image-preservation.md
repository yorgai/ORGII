# Architecture Audit — Diff Scoping, Composer Reload & Image Preservation (control-flow)

**Date:** 2026-06-16
**Auditor:** audit-then-commit session
**Scope (type / control-flow level):**

- `src/store/ui/simulatorAtom.ts` — `simulatorDiffScopeRequestAtom`, `simulatorDiffRefreshNonceAtom`, `bumpSimulatorDiffRefreshNonceAtom` (WS1)
- `src/modules/WorkStation/Diff/SessionReplay/diffScope.ts` + `index.tsx` (WS1)
- `src/engines/ChatPanel/InputArea/components/{useCompactFileData,compactFileChangesHelpers}.ts` (WS2)
- `src/engines/SessionCore/core/atoms/actions.ts` (WS4)

## Layer-by-layer (relevant layers)

### L4 Semantic overloading

- "scope" — `simulatorDiffScopeRequestAtom` is the only "diff scope" concept; not overloaded with other scope notions. The session guard (`scope.sessionId !== currentSessionId → inactive`) makes it self-clearing on session switch, avoiding a stale cross-session scope. Good.
- Two distinct signals are correctly kept separate: `simulatorDiffScopeRequestAtom` (which files to show) vs `simulatorDiffRefreshNonceAtom` (force a re-read of canonical diffs). Splitting these per anti-pattern #22 (one atom = one concern) is the right call — re-clicking a file refocuses (scope `nonce`) without refetching, and navigation refetches (refresh nonce) without changing scope.

### L5 Default branch analysis

- `filterDiffSectionsByScope`: active scope with **zero** matches falls back to the full list (`matched.length > 0 ? matched : [...items]`) — documented graceful degradation (avoids an empty "Review" when scoped files were reverted). Correct universal default.
- `useCompactFileData` `.catch` leaves prior files; `useTurnModifiedFiles` `.catch` resets to empty map. Both fail safe.

### L9 / lifecycle — effect dependencies & stale closures

- `useCompactFileData` effect dep set is `[initialData, sessionId, reloadKey]`; `reloadKey` encodes `sessionId:roundCount:working|idle`, so refetch cadence is bounded to session/round/idle transitions — **not** per streamed tick. `countChatRounds` counts `source==="user" && displayText` boundaries, which do not appear mid-stream, so the key is stable during streaming (verified by `compactFileChangesHelpers.test.ts`).
- `SessionReplay/index.tsx` scope-apply `useEffect` deps `[diffScopeRequest, sessionId]` — the `set*` callbacks used inside are stable Jotai/React setters, so omitting them is safe (no stale-closure capture of changing values). The `diffRefreshNonce` is added to the orgtrack-final-diffs load effect so navigation re-reads the canonical diffs. Both `cancelled`-flag guards are present → no setState-after-unmount.
- The refresh nonce is bumped only on explicit chat→Diff navigation (`openAgentStationDiff`, footer `openDiff`), never in a render path → no refetch loop (documented).

### WS4 — image preservation (actions.ts)

- Extracted helpers (`getUserMessageContent`, `getUserMessageImages`, `hasUserMessageImages`, `withUserMessageImages`) deduplicate the previously-inlined content extraction across `loadSessionAtom` and `appendEventsAtom` — removes a copy-paste pair (L2 dedup win).
- `withUserMessageImages` spreads `event.result ?? {}` then sets `images` — preserves other result fields; only carries images onto a backend-echoed message when it has none of its own (`!hasUserMessageImages(nextEvent)`), so it never clobbers real backend images.
- In `appendEventsAtom`, the synthetic-image map is built from `get(eventsAtom)` (existing store) **before** `removeSyntheticUserInputEvents()` evicts the placeholders, and the enriched array (`uniqueNewWithImages`) is used consistently for append, time-range, and follow-target — no half-updated path. Covered by `actions.test.ts` (5 passing).

## Summary

- 0 blocking issues
- 0 fix candidates
- Clean concern-split (scope vs refresh nonce), bounded refetch cadence, fail-safe defaults, and a legitimate dedup extraction in WS4. No stale-closure or lifecycle leaks found.
