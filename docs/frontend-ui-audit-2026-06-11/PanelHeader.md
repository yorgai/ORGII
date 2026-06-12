# Frontend UI Audit — PanelHeader

**File:** `src/modules/shared/layouts/blocks/PanelHeader/index.tsx` (436 LOC)
**Date:** 2026-06-11
**Auditor:** orgii session (Phase 2-C)
**Skill:** `~/.orgii/skills/frontend-ui-audit/SKILL.md`

## Why this file

Per the pilot's "Next candidates" list, this is the highest-leverage second sample: PanelHeader is the canonical 40px chrome header used across Settings / Workstation / Sidebar / Inbox pages. It also surfaces the same `bg-[var(--cm-editor-background)]` D2 hit as `DiffFileSection` — so it cross-references with `D2-cm-editor-sweep.md`.

## File shape (for context)

- Defines and exports a single component `PanelHeader` (`memo`).
- Co-located concerns: `PanelHeaderSurfaceContext` + provider for nested surface inheritance; `PANEL_HEADER_TOKENS` constant; `PanelRefreshButton` helper.
- All interactive elements are routed through `<Button>` from `src/components/Button` with spread props from `PANEL_HEADER_TOKENS.actionButton` / `dangerButton` / `actionButtonPill`.
- Title fontSize is applied via `style={{ fontSize: PANEL_HEADER_TOKENS.fontSize }}` (numeric `13`) — i.e., **not** a `text-[13px]` className.

## D1 — Raw HTML vs Design System

| Line                                             | Element                                                        | Verdict | Reason                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| 67-69                                            | `<PanelHeaderSurfaceContext.Provider>` wrapper                 | keep    | React context provider, no UI primitive                   |
| 308, 312, 323, 327, 341, 346, 352, 360, 362, 363 | `<span>` text wrappers                                         | keep    | Inline text containers, non-interactive, D1 exempts these |
| 318, 384                                         | `<ChevronRight />`, `<ArrowLeft />` (Lucide)                   | keep    | Decorative icons under labelled `<Button>` parent         |
| 376-418                                          | `<div className={baseClasses}>` headerRow wrapper              | keep    | Pure layout; classNames composed from tokens              |
| 380-392                                          | `<Button {...PANEL_HEADER_TOKENS.actionButton} />` back-button | keep    | DS Button consumed correctly                              |
| 401-417                                          | `<div>` actions container + `<Button>` for search              | keep    | DS Button consumed correctly                              |
| 421-427                                          | `<div>` afterHeader wrapper                                    | keep    | Layout primitive                                          |

**No raw `<button>` / `<input>` / `<select>` / `<table>` / `<form>` in this file.** D1 perfectly clean — a positive signal that this is a mature chrome primitive.

(Bonus: file-header doc comment lines 11-32 actively documents the "spread PANEL_HEADER_TOKENS on Button" convention. That is exactly the "audit precedent" pattern the skill encourages.)

## D2 — Arbitrary Tailwind Value vs Token

| Line | Value                              | Verdict | Reason                                                                                                                                                                 | Suggested change                                 |
| ---- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 293  | `bg-[var(--cm-editor-background)]` | **fix** | Project-owned token (see `D2-cm-editor-sweep.md`); already abstracted at `src/config/workstation/tokens.ts:13` as `EDITOR_TAB_CANVAS_BG_CLASS`, just not consumed here | Replace with `EDITOR_TAB_CANVAS_BG_CLASS` import |

**One D2 hit, identical to the DiffFileSection finding.** Same recommended fix mechanism — consolidate via the existing constant, not via a new Tailwind class. See `D2-cm-editor-sweep.md` for the full codemod table.

No raw hex / rgb literals. No other `bg-[var(--…)]` occurrences in the file.

## D3 — Hardcoded Sizes / Colors

This file is **deliberately token-driven**. The cleanest D3 audit row in the pilot so far.

| Line           | Value                                                                                  | Verdict              | Reason                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 85, 87, 91, 93 | `iconSize: 14`, `buttonIconSize: 16`, `fontSize: 13`, `height: 40` (object literals)   | keep                 | These ARE the tokens; defined in `PANEL_HEADER_TOKENS` for consumers to spread. Source of the abstraction.                                                                                      |
| 137            | `verticalSeparator: "h-4 w-px flex-shrink-0 bg-border-2"`                              | keep                 | Composite class token, `h-4`/`w-px` are Tailwind defaults                                                                                                                                       |
| 308, 312, 314  | `style={{ fontSize: PANEL_HEADER_TOKENS.fontSize }}` (used 5 times in `renderContent`) | **keep with reason** | Reads `PANEL_HEADER_TOKENS.fontSize = 13` via inline style instead of a `text-[13px]` className. **This sidesteps the D3 `text-[Npx]` class entirely.** See "Inline-style-as-token" note below. |
| 282            | `paddingClass = isListVariant ? "px-3" : "px-4"`                                       | keep                 | Tailwind default sizing tokens                                                                                                                                                                  |
| 283            | `h-10 flex-shrink-0 items-center gap-2`                                                | keep                 | All Tailwind defaults                                                                                                                                                                           |
| 285            | `border-b border-border-2`                                                             | keep                 | DS border token                                                                                                                                                                                 |
| 308, 323       | `text-text-2`, `text-text-4`                                                           | keep                 | DS color tokens                                                                                                                                                                                 |

### Inline-style-as-token pattern (lines 314, 329, 355, 365)

PanelHeader writes `style={{ fontSize: PANEL_HEADER_TOKENS.fontSize }}` rather than `className="text-[13px]"`. From the D3 perspective both are equivalent (both produce `font-size: 13px`), but the inline-style form **does not show up in the `rg 'text-\[\d+px\]'` sweep** that `D3-typography-scale-sweep.md` is built on.

This is a real D3 alternative pattern worth noting:

- **Pro:** the size flows from a single named token (`PANEL_HEADER_TOKENS.fontSize`). If the chrome resizes, the change is one line.
- **Con:** the value lives in `style={{}}` not in className, so it bypasses Tailwind's purge/preview path and any `@layer` overrides; future-you can't override it via cascade.
- **Verdict:** **keep** — for chrome primitives like PanelHeader where the size is a stable architectural constant, this is acceptable. But it should NOT become the codebase-wide pattern: 100+ inline `style={{ fontSize: 11 }}` would defeat the whole point of D3 consolidation. Document and contain.

## D4 — Accessibility

| Line               | Element                                                                | Verdict          | Reason                                                                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 381-391            | Back `<Button>` with `title="Back"`                                    | keep             | `title` provides accessible tooltip; underlying DS `<Button>` has correct semantics                                                                                                                                                                                                                     |
| 403-413            | Search `<Button>` with `title="Search pages"`                          | keep             | Same                                                                                                                                                                                                                                                                                                    |
| 162-175            | `PanelRefreshButton` — `<Button>` with `title` prop forwarded          | keep             | Same; `disabled={!!spinClass}` is correct                                                                                                                                                                                                                                                               |
| 312, 327, 352, 363 | `<span>` text labels                                                   | keep             | Static text, no interactive semantics needed                                                                                                                                                                                                                                                            |
| 308, 323, 341      | `<span className="flex-shrink-0 text-text-2">{icon}</span>` icon hosts | keep with reason | Decorative icon wrapper, no `aria-hidden` set — but the parent header IS a labelled chrome row (sibling `<span>` carries the breadcrumb text). Screen readers will read the title; the icon-span has no perceivable text node. Could add `aria-hidden` defensively but **not required** for compliance. |

**No D4 violations.** Every interactive element routes through `<Button>` with a `title`.

Minor watch-list: the decorative `<span>` icon hosts at lines 308 / 323 / 341 are bare wrappers without `aria-hidden`. Audit verdict is **keep** (they contain no text), but tagging this as a watch-list item for whether a future a11y pass wants to enforce `aria-hidden` on all icon-only `<span>` wrappers.

## D5 — Visual Patterns Observed

| Pattern                                                                                                                 | Where seen so far                                                                                                                         | Count                                   | Verdict                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40px chrome header (h-10, px-3/px-4, gap-2, action buttons on the right)                                                | PanelHeader, FileHeader, BreadcrumbFileHeader, sticky-collapsible variant in DiffFileSection                                              | 4                                       | **abstract — partially done** (PanelHeader IS the abstraction for the standard variant; DiffFileSection's sticky variant is intentionally different) |
| Breadcrumb-parent + chevron + breadcrumb-current text pair (`text-text-2` → `ChevronRight` → `font-medium text-text-1`) | PanelHeader (lines 312-332), SettingsBreadcrumb (`src/modules/shared/layouts/blocks/SettingsBreadcrumb/index.tsx:379`), BreadcrumbPillNav | 3                                       | **abstract** — extract a `<Breadcrumb parent={…} current={…} />` sub-component                                                                       |
| Inline-style-as-fontSize-token (`style={{ fontSize: TOKEN.x }}` over `text-[Npx]`)                                      | PanelHeader (5 occurrences), `BreadcrumbFileHeader.tsx:64` uses `text-[13px]` className instead — **inconsistent siblings**               | 2 different approaches in sibling files | **watch-list** — document the choice; do not flip yet                                                                                                |

## Cross-file deltas vs DiffFileSection

| Dimension           | DiffFileSection                                                                 | PanelHeader                                                                                     |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1 violations       | 0 (sticky `<button>` is keep-with-reason because DS doesn't cover the role)     | 0 (all interactive routed through DS `<Button>`)                                                |
| D2 hits             | 1 (`bg-[var(--cm-editor-background)]` on sticky header)                         | 1 (same value, different role: panel canvas)                                                    |
| D2 fix mechanism    | Use `EDITOR_TAB_CANVAS_BG_CLASS`                                                | Use `EDITOR_TAB_CANVAS_BG_CLASS`                                                                |
| D3 micro-sizes form | className `text-[13px]` / `text-[11px]` (4 sites in 1 file)                     | Inline `style={{ fontSize: 13 }}` driven by `PANEL_HEADER_TOKENS.fontSize` (5 sites in 1 file)  |
| D4 violations       | 0                                                                               | 0                                                                                               |
| D5 contribution     | Donates "sticky-collapsible chrome header" pattern (2 seen so far → watch-list) | Confirms "40px chrome row" abstraction; surfaces the breadcrumb sub-pattern (3 seen → abstract) |

**Key observation across the two files:** the codebase already has the D2 fix mechanism (`EDITOR_TAB_CANVAS_BG_CLASS`) and a partial D3 fix mechanism (`TYPOGRAPHY` constants + per-area `PANEL_HEADER_TOKENS.fontSize`). The dominant debt class isn't "abstractions missing", it's "abstractions exist but aren't consumed". This matters for landing strategy — the next PR is mechanical consolidation, not new design-system work.

## Summary

| Verdict                       | Count                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fix recommended               | **1** (D2 same as DiffFileSection — single shared mechanism)                                                                                           |
| keep with reason (documented) | 4 (5× inline-style-as-token, decorative icon-span without `aria-hidden`, breadcrumb sub-component watch-list, 40px chrome abstraction already partial) |
| keep (no concern)             | 11 (DS Button consumers, layout `<div>` wrappers, decorative Lucide icons, all tokens read from constants)                                             |
| abstract candidate            | 1 new (breadcrumb parent-current text pair → `<Breadcrumb>` component, ≥ 3 occurrences)                                                                |
| **D1 / D4 violations found**  | **0**                                                                                                                                                  |

## Takeaways

1. **PanelHeader is the codebase's positive example of D1+D4 hygiene.** Every interactive element is `<Button>` with a `title`. Worth pointing to when explaining DS adherence to new contributors.
2. **The single D2 hit confirms the systemic finding** from `D2-cm-editor-sweep.md` — same mechanism, same fix, no new categories.
3. **The inline-style-as-fontSize-token pattern is a legitimate D3 alternative** but should remain rare; it bypasses the D3 grep that the rest of the audit relies on, so it's invisible to future automated sweeps unless explicitly noted.
4. **Breadcrumb sub-component is a real D5 abstraction candidate** worth a small refactor — 3 sites independently implement the parent → ChevronRight → current text pair.

## Not in scope

- Modifying `PanelHeader/index.tsx`.
- Modifying `tailwind.config.js` / `tokens.ts`.
- Auditing the call sites that consume `PanelHeader` (different scope).
- Building the `<Breadcrumb>` sub-component or running the inline-style sweep.
