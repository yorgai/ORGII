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

## Pass 2 — ScopePickerItem row structure (lines 126–154)

User flagged the custom `div` + nested `<button>` row instead of DS dropdown primitives.

| Line    | Element                                   | Verdict                      | Reason                                                                                                                                                                                                                                                          | Suggested change                                                                       |
| ------- | ----------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 126–137 | `div.SCOPE_PICKER_ROW` + inner `<button>` | **fix**                      | Duplicates hover/height (`DROPDOWN_ITEM.hoverBgClass` on wrapper, `h-8` again on button). `DropdownItem` already renders a single `div` with `DROPDOWN_CLASSES.item`, trailing `suffix`, and `aria-selected`. Homemade split row diverges from other droplists. | Refactor to `DropdownItem` inside a `relative` wrapper only.                           |
| 127–137 | Raw `<button>` row select                 | **fix**                      | DS `DropdownItem` covers label + suffix (diff badge + check).                                                                                                                                                                                                   | Replace inner `<button>` with `<DropdownItem onClick={onSelect} selected suffix={…}>`. |
| 126     | Outer `div` wrapper                       | **fix** (after DropdownItem) | Only needed for absolute delete overlay. Drop `SCOPE_PICKER_ROW` hover duplication — let `DropdownItem` own row chrome.                                                                                                                                         | `relative group/scope-row` + `DropdownItem` + absolute `IconButton`.                   |
| 138–153 | Absolute `IconButton` delete              | keep with reason             | Secondary destructive action on hover; `DropdownItem` has no built-in trailing action slot beyond `suffix`. Overlay pattern is valid once row uses `DropdownItem`.                                                                                              | —                                                                                      |
| 325–346 | Trigger `<button>`                        | keep with reason             | Unchanged from pass 1 — breadcrumb trigger is not a menu row.                                                                                                                                                                                                   | —                                                                                      |

### Why it looks wrong

`DropdownItem` (`src/components/Dropdown/DropdownItem.tsx:154–198`) is a **single** interactive `div[role=option]` with built-in label + suffix layout. `ScopePickerItem` reimplements that with an outer hover `div` and an inner full-width `<button>`, which:

1. Stacks two interactive-looking layers (wrapper hover + button click).
2. Re-specifies row height/typography (`text-[13px]`, `h-8`) that `DROPDOWN_CLASSES.item` already defines.
3. Makes keyboard focus land on the inner button while hover styles live on the parent — split semantics.

Delete overlay does **not** require the inner `<button>`; `DropdownItem` + `relative` parent + absolute `IconButton` is sufficient (same as current delete placement).

### Recommended refactor (minimal)

```tsx
<div className="group/scope-row relative">
  <DropdownItem
    selected={selected}
    onClick={onSelect}
    className="pr-8" // optional: room for delete overlay on hover
    suffix={
      <>
        <ScopePickerDiffStats summary={summary} />
      </>
    }
  >
    <span title={title}>{label}</span>
  </DropdownItem>
  {onRemove ? <IconButton className={SCOPE_PICKER_REMOVE_BUTTON} … /> : null}
</div>
```

Use `DropdownItemGroup` + `DROPDOWN_CLASSES.sectionLabel` for section headers to replace raw `ScopePickerSectionLabel` div (optional second fix).

## Summary

### Pass 1 (initial)

- **0** fixes recommended
- **16** kept with documented reason
- **1** abstract candidate (custom droplist search field, ≥ 3 occurrences repo-wide)

### Pass 2 (ScopePickerItem)

- **3** fixes recommended (row wrapper + replace raw button with `DropdownItem`)
- **2** kept with reason (delete overlay, trigger button)
- **0** new abstract candidates

## Pass 3 — Fixes applied (2026-07-01)

Refactored `ScopePickerItem` per Pass 2 recommendations:

| Line (before) | Change                                                                                                                                                                  | Status                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 126–137       | Removed `SCOPE_PICKER_ROW` wrapper with duplicated `h-8` / `hover:bg-surface-hover`; replaced inner `<button>` with `DropdownItem` using `DROPDOWN_CLASSES.item` tokens | **fixed**              |
| 126           | Outer wrapper now `group/scope-row relative w-full` only — hover/height owned by `DropdownItem`                                                                         | **fixed**              |
| 129           | Eliminated inline `text-[13px]`, `h-8`, manual `itemSelected` class string on raw button                                                                                | **fixed**              |
| 138–153       | Delete `IconButton` overlay unchanged; `pr-8` on row when `onRemove` present reserves hover space                                                                       | kept (overlay pattern) |

Selection semantics: `aria-current` on raw button → `aria-selected` via `DropdownItem` (`role="option"`), consistent with other droplist rows.

### Updated summary (all passes)

- **3** fixes applied (Pass 2 ScopePickerItem row)
- **18** kept with documented reason (Pass 1 + overlay/trigger/section labels)
- **1** abstract candidate unchanged (custom droplist search field, ≥ 3 occurrences repo-wide)
