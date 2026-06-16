# Frontend UI Audit — FileChangeRow

**File:** `src/engines/ChatPanel/InputArea/components/FileChangeRow.tsx` (~65 LOC)
**Date:** 2026-06-16
**Auditor:** audit-then-commit session
**Scope:** New shared row primitive (file icon + name + +N/−N stats) used by both `TurnFilesFooter` and the composer file list (Workstream 1).

## D1 — Raw HTML vs Design System

| Line  | Element                             | Verdict          | Reason                                                                                                                                                                                                                                                                                   | Suggested change |
| ----- | ----------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 40–47 | `<div>` row with optional `onClick` | keep with reason | This is a list-row layout primitive, not a DS-covered control shape. DS `Button` would impose chrome and break the flush composer-stack row layout (icon + truncating label + right-aligned stats). When non-clickable it is purely presentational. See D4 for the click-handler caveat. | —                |

## D2 — Arbitrary Tailwind Value vs Token

| Line  | Value                         | Verdict | Reason                                             | Suggested change |
| ----- | ----------------------------- | ------- | -------------------------------------------------- | ---------------- |
| 43,50 | `COMPOSER_STACK_ROW_*` consts | keep    | Token-based via `@src/config/composerStackTokens`. | —                |

## D3 — Hardcoded Sizes / Colors

| Line  | Value                             | Verdict          | Reason                                                                                                                                                                                                                                                                                                           | Suggested change |
| ----- | --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 31,34 | `text-green-500` / `text-red-500` | keep with reason | additions/deletions green/red is a repo-wide convention (10+ `*.tsx` files: `StatCard`, `EditorStatusBar`, `OutputContent`, `ContributorStatsSection`, …). A per-site token swap here would diverge from the established palette. Flagged as an abstract candidate below for a future repo-wide diff-stat token. | —                |
| 29    | `chat-block-xs`                   | keep             | Shared typography class.                                                                                                                                                                                                                                                                                         | —                |

## D4 — Accessibility

| Line  | Element                                             | Verdict                          | Reason                                                                                                                                                                                                                                                                          | Suggested change                                                                                                                                      |
| ----- | --------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40–47 | `<div onClick={...}>` (when `onFileClick` provided) | **fix candidate** (non-blocking) | Clickable `<div>` lacks `role="button"`, `tabIndex={0}`, and an Enter/Space `onKeyDown` handler, so the file row is not keyboard-operable. The "Review" button in `TurnFilesFooter` still reaches the same destination via keyboard, so this is a degraded-not-broken a11y gap. | Add `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space → `onFileClick`) when `onFileClick` is set; or wrap the label in a real `<button>`. |

## D5 — Visual Patterns Observed

- +N/−N two-tone diff badge — appears in 10+ files. **Abstract candidate (≥3):** a shared `<DiffStatBadge additions deletions />` (or a `diff-stat-add` / `diff-stat-del` token pair) would consolidate the green/red literals. Out of scope for this feature PR; recommend a separate config-level sweep.

## Summary

- 0 fixes recommended in this PR (1 fix **candidate** flagged, non-blocking)
- 4 kept with documented reason
- 1 abstract candidate (diff-stat two-tone badge, ≥3 occurrences)

The clickable-`<div>` keyboard gap is the only actionable item and does not block the feature (mouse path works; the Review button provides a keyboard route to the same Diff view). Recommend addressing in a follow-up a11y pass alongside the diff-stat-badge abstraction.
