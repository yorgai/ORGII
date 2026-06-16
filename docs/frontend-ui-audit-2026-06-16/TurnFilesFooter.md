# Frontend UI Audit — TurnFilesFooter

**File:** `src/engines/ChatPanel/ChatHistory/components/TurnFilesFooter/index.tsx` (~172 LOC)
**Date:** 2026-06-16
**Auditor:** audit-then-commit session
**Scope:** New per-round "N Files Changed" card rendered at the bottom of each chat turn (Workstream 1).

## D1 — Raw HTML vs Design System

| Line | Element                           | Verdict          | Reason                                                                                                                                                                                                                                                                          | Suggested change |
| ---- | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 124  | `<button>` "Review"               | keep with reason | Ghost text-link affordance (`border-0 bg-transparent p-0 text-text-3 hover:text-text-1`). DS `Button`/`IconButton` carry chrome (padding, surface, variant) this inline header link must not have; sibling composer-stack rows use the same raw-button-as-text-link convention. | —                |
| 145  | `<button>` "Show N more" expander | keep with reason | Full-width borderless row styled by `COMPOSER_STACK_ROW_BASE/HOVER`; matches the established composer-stack row pattern, not a DS Button shape.                                                                                                                                 | —                |

## D2 — Arbitrary Tailwind Value vs Token

| Line        | Value                                                   | Verdict          | Reason                                                                                                                          | Suggested change |
| ----------- | ------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 115,133,147 | `CHAT_COMPOSER_STACK_*` / `COMPOSER_STACK_ROW_*` consts | keep             | Already token-based; pulls from `@src/config/composerStackTokens`.                                                              | —                |
| 133         | `max-h-[280px]`                                         | keep with reason | Scroll-cap for the file list; no spacing-scale token covers a 280px max-height clamp, and it is a one-off container constraint. | —                |

## D3 — Hardcoded Sizes / Colors

| Line    | Value                                 | Verdict          | Reason                                                                                                                                                                     | Suggested change |
| ------- | ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 118,126 | `text-[13px]`                         | keep with reason | 13px body/label size is an established repo convention (185 occurrences across `*.tsx`); not a per-site one-off. Belongs in a future global type-scale sweep, not this PR. | —                |
| 149     | `MoreHorizontal size={14}`            | keep             | Sub-scale icon size for optical alignment.                                                                                                                                 | —                |
| 113,117 | `px-3 pt-2`, `h-8`, `px-2.5`, `gap-2` | keep             | Standard spacing-scale classes.                                                                                                                                            | —                |

## D4 — Accessibility

| Line    | Element                       | Verdict | Reason                                                                                          | Suggested change |
| ------- | ----------------------------- | ------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| 124,145 | Review / Show-more `<button>` | keep    | Both have visible text children → accessible name present; keyboard-operable as native buttons. | —                |

## D5 — Visual Patterns Observed

- "N Files Changed" card (header + count + Review + scrollable file rows + show-more) — currently 1 implementation (this file). The composer pill (`CompactFileChanges`) is a sibling but renders a different surface (pill, not card). Watch-list only.
- additions/deletions two-tone (+N green / -N red) lives in the shared `FileChangeRow` (see its report). Already factored out — not duplicated here.

## Summary

- 0 fixes recommended
- 6 kept with documented reason
- 0 abstract candidates

No blocking UI issues. The component renders nothing when the round touched no files (`files.length === 0` guard, line 110), so empty-state is handled.
