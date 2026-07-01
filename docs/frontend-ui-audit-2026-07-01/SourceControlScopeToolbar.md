# Frontend UI Audit — SourceControlScopeToolbar

**File:** `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/SourceControlScopeToolbar.tsx` (355 LOC)
**Date:** 2026-07-01
**Auditor:** Cursor agent (frontend-ui-audit skill)

## D1 — Raw HTML vs Design System

| Line | Element                  | Verdict          | Reason                                                                                                                                                                                                                                           | Suggested change                                                     |
| ---- | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 119  | `<button>` scope row     | keep with reason | Multi-slot row (label + diff badge + selected check) with an absolutely positioned delete overlay; matches droplist-mode patterns in `InlineDropdown` and spotlight palettes where DS `Button`/`DropdownItem` cannot host the overlay layout     | —                                                                    |
| 242  | `<input type="search">`  | keep with reason | Custom droplist mode (not `options` mode); same raw search input pattern as `InlineDropdown`, `ContributorFilter`, and `DropdownOptionsContent`. `DropdownSearch` is available but does not yet wire `onMouseDown` portal-bubble guard used here | Consider `DropdownSearch` once it absorbs the mousedown/portal guard |
| 331  | `<button>` scope trigger | keep with reason | Compact breadcrumb trigger with mixed tone segments and chevron; DS `Button` padding/height would overflow the 40px workstation header slot                                                                                                      | —                                                                    |
| 85   | `<div>` section label    | keep with reason | Non-interactive section header; uses shared `DROPDOWN_CLASSES` section-label typography                                                                                                                                                          | —                                                                    |
| 131  | `IconButton` delete      | keep with reason | Correct DS component for icon-only destructive action                                                                                                                                                                                            | —                                                                    |
| 72   | `DiffStatsBadge`         | keep with reason | Reuses existing diff badge primitive with compact variant                                                                                                                                                                                        | —                                                                    |

## D2 — Arbitrary Tailwind Value vs Token

| Line | Value  | Verdict          | Reason                                                              | Suggested change |
| ---- | ------ | ---------------- | ------------------------------------------------------------------- | ---------------- |
| —    | (none) | keep with reason | No `bg-[var(--…)]`, hex, or rgb arbitrary color values in this file | —                |

## D3 — Hardcoded Sizes / Colors

| Line  | Value                        | Verdict          | Reason                                                                                                                                           | Suggested change                                                  |
| ----- | ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 40–42 | `text-[11px]`, `text-[12px]` | keep with reason | Sidebar micro-typography band established across `EditorPrimarySidebar` (e.g. `SourceControlStickyHeader`, `SourceControlTreeRow`, `TestingTab`) | —                                                                 |
| 129   | `text-[13px]`                | keep with reason | Matches dropdown row body size in `DROPDOWN_ITEM` / `InlineDropdown`                                                                             | —                                                                 |
| 239   | `max-w-[320px]`              | keep with reason | Caps wide repo paths in the file-tree-width panel (`DROPDOWN_WIDTHS.fileTreeClass` sets min only); one-off max for scope picker overflow         | Fold into `DROPDOWN_WIDTHS` if a second picker needs the same cap |
| 333   | `max-w-[min(100%,32rem)]`    | keep with reason | Responsive clamp so long breadcrumbs truncate inside the header without blowing layout                                                           | —                                                                 |
| 333   | `h-7`                        | keep with reason | Aligns with workstation header control height (28px)                                                                                             | —                                                                 |
| 129   | `h-8`                        | keep with reason | Standard dropdown row height (`DROPDOWN_ITEM`)                                                                                                   | —                                                                 |
| 341   | `ChevronRight size={10}`     | keep with reason | Sub-scale chevron between 11px breadcrumb segments; optical pairing with muted tone text                                                         | —                                                                 |

## D4 — Accessibility

| Line    | Element               | Verdict          | Reason                                                                                                                       | Suggested change |
| ------- | --------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 331     | Trigger `<button>`    | keep with reason | `aria-label` from `sourceControl.scope.switchScopeActive` includes repo + branch; visible breadcrumb provides redundant name | —                |
| 123     | Row `<button>`        | keep with reason | Visible truncated label + `title` tooltip with path and diff breakdown                                                       | —                |
| 123     | `aria-current="true"` | keep with reason | Correctly marks selected scope row                                                                                           | —                |
| 252     | Search `<input>`      | keep with reason | `aria-label` matches placeholder                                                                                             | —                |
| 137–138 | Delete `IconButton`   | keep with reason | `aria-label` + `title`; `focus-visible:opacity-100` exposes control to keyboard users without reserving layout width         | —                |
| 131     | Hover-only delete     | keep with reason | Overlay pattern with keyboard focus visibility satisfies minimum bar; row `title` still conveys remove affordance on hover   | —                |

## D5 — Visual Patterns Observed

- **Custom droplist + inline search input** — also seen in: `InlineDropdown`, `ContributorFilter`, `SettingsBreadcrumb`, `CursorModelDropdown`, `BranchDropdown`, `SubAgentsEditor`, `PinActionsPanel`, `DispatchCategoryDropdown`, `WorkspaceDropdown` (≥ 3). **Abstract candidate:** promote shared `DropdownSearch` usage (or a thin `DroplistSearchField` wrapper with portal mousedown guard) for droplist-mode dropdowns.
- **Hover-reveal absolute delete on list row** — also seen in: `QueryHistoryContent`, `DatabasePrimarySidebar` patterns, chat attachment thumbnails (2–3). Watch-list; not yet ≥ 3 identical scope-picker rows.
- **Breadcrumb tone segments in compact trigger** — unique to this toolbar; no abstract candidate.

## Summary

- **0** fixes recommended
- **16** kept with documented reason
- **1** abstract candidate (custom droplist search field, ≥ 3 occurrences repo-wide)
