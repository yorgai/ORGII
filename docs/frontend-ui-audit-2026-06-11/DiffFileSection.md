# Frontend UI Audit — DiffFileSection

**File:** `src/modules/WorkStation/shared/DiffFileSection/index.tsx` (330 LOC)
**Date:** 2026-06-11
**Auditor:** orgii session (pilot run)
**Skill:** `~/.orgii/skills/frontend-ui-audit/SKILL.md`

## Why this file

User screenshot pointed at the sticky `<button>` block (lines 274–314) and asked why `architecture-audit` didn't flag it. Correct answer: `architecture-audit` is type/control-flow only. This audit covers the gap.

## D1 — Raw HTML vs Design System

| Line     | Element                                                                                | Verdict          | Reason                                                                                                                                                                                                                                                                                                                                                                                                 | Suggested change |
| -------- | -------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 186      | `<div ref={containerRef}>` wrapper around diff content                                 | keep             | Pure layout primitive hosting `CodeMirrorDiff` / `Placeholder`; D1 rule explicitly exempts `<div>` wrappers                                                                                                                                                                                                                                                                                            | —                |
| 241, 269 | `<div ref={sectionRef}>` outer section wrapper                                         | keep             | Same as above; receives forwarded ref + `data-diff-section-path` for scroll targeting                                                                                                                                                                                                                                                                                                                  | —                |
| 274      | `<button>` sticky collapsible file header                                              | keep with reason | (a) DS `Button` doesn't support sticky positioning + multi-column flex layout + `disabled`-as-static-placeholder; (b) sibling `WorkStation/shared/*` components (FileHeader, UnifiedDiffHunk, terminal block headers) all use raw `<button>` for the same role — switching only this site would create local inconsistency. **This is the canonical "keep with reason" example shipped in the skill.** | —                |
| 280      | `<span className="inline-block w-[14px] shrink-0" aria-hidden />` chevron placeholder  | keep             | Decorative spacer (`aria-hidden`), inside the named parent `<button>`                                                                                                                                                                                                                                                                                                                                  | —                |
| 292, 296 | `<span>` for fileName / dirPath                                                        | keep             | Inline text within a labelled button; no interactive semantics required                                                                                                                                                                                                                                                                                                                                | —                |
| 302–308  | `<span className={DIFF_STATS.…}>` for additions/deletions badge                        | keep             | Already abstracted via `DIFF_STATS` token in `WorkStation/shared/tokens` — the right pattern                                                                                                                                                                                                                                                                                                           | —                |
| 311      | `<span className={\`shrink-0 text-[11px] font-medium ${statusColor}\`}>` status letter | keep (D1)        | Inline text label inside parent button. See D3 for `text-[11px]`.                                                                                                                                                                                                                                                                                                                                      | —                |

**No D1 violations.**

## D2 — Arbitrary Tailwind Value vs Token

| Line | Value                                                   | Verdict           | Reason                                                                                                                                                                                                                                                                                                                                                                                                        | Suggested change                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 275  | `bg-[var(--cm-editor-background)]` on the sticky header | **fix candidate** | `--cm-editor-background` is project-owned: defined/written in `src/config/workstation/tokens.ts:12-13`, `src/features/CodeMirror/config/themeConfig.ts:46,61`, `src/features/CodeMirror/themes/github.ts:22`, `src/util/ui/terminal/themes.ts:5`, `src/components/TerminalInteractive/utils/theme.ts:5,18,23`, `src/hooks/settings/useEditorAppearance.ts:13`. Read in 19 files total. Not a third-party var. | Map to a Tailwind class in `tailwind.config.js` (e.g. `colors: { 'cm-editor': 'var(--cm-editor-background)' }`) so this site becomes `bg-cm-editor`. **Do not fix site-by-site** — sweep all 19 hit sites in the same change. See README "Next candidates". |

**One D2 hit, escalated to config-level fix.**

### R4 resolution (from the plan's open question)

`--cm-editor-background` is **project-owned**, not bridged from CodeMirror's own internal CSS. CodeMirror does have its own theme system (`@codemirror/view` ships its own variables), but this name with this exact spelling is an ORGII surface token used to harmonize the diff viewer background with the workstation chrome. Verdict-affecting consequence: this is a normal D2 violation (fix at the config level), not a bridge-layer exemption.

## D3 — Hardcoded Sizes / Colors

| Line     | Value                                                               | Verdict          | Reason                                                                                                                                                                                                                                                           | Suggested change |
| -------- | ------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 280      | `w-[14px]` chevron placeholder                                      | keep             | Sub-4px-scale microadjustment matching the 14-px lucide icon size; D3 rule explicitly carves out < 16px micro-fitting                                                                                                                                            | —                |
| 282, 284 | `size={14}` on `ChevronDown` / `ChevronRight` (prop, not className) | keep             | Lucide icon prop, not a Tailwind class; out of D3 scope                                                                                                                                                                                                          | —                |
| 292      | `text-[13px]` on fileName span                                      | keep with reason | 13 px is not a Tailwind default (12 / 14 / 16); it's a fileName-specific optical adjustment between `text-xs` (12) and `text-sm` (14). Same value is used elsewhere in WorkStation chrome. If a token like `text-chrome-13` ever lands, fold in; otherwise keep. | —                |
| 296      | `text-[11px]` on dirPath span                                       | keep with reason | Same as above — 11 px is a deliberate secondary-text size used across the diff header family                                                                                                                                                                     | —                |
| 311      | `text-[11px]` on status letter span                                 | keep with reason | Same as above                                                                                                                                                                                                                                                    | —                |

**Three `text-[Npx]` micro-tokens** in the same file, all sub-spacing-scale. **Watch-list** for D5: if `text-[11px]` and `text-[13px]` recur across enough sites, promote them into the type scale (e.g. `text-chrome-sm` / `text-chrome-xs`). Current count not verified — note for next batch.

No raw hex / rgb literals. No inline `style={{ color: "#…" }}`.

## D4 — Accessibility

| Line          | Element                                      | Verdict | Reason                                                                                                                                                                                                          | Suggested change |
| ------------- | -------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 274–314       | Sticky `<button>` header                     | keep    | Has visible text children (fileName, dirPath, additions/deletions counts, status letter) → accessible name OK. `onClick={toggleExpanded}`, `disabled={isDeleted}` use native button semantics → keyboard works. | —                |
| 280           | `<span … aria-hidden />` chevron placeholder | keep    | Decorative spacer, correctly `aria-hidden`, inside a labelled parent button                                                                                                                                     | —                |
| 282, 284      | `<ChevronDown />` / `<ChevronRight />`       | keep    | Decorative icons inside the labelled parent button; no `aria-label` required                                                                                                                                    | —                |
| 269, 241, 186 | `<div>` wrappers with `ref` only             | keep    | No interactive handlers attached → no a11y requirement                                                                                                                                                          | —                |

**No D4 violations.** The component is accessible as-shipped.

(Note: this file has zero `<div onClick=…>` / `<span onClick=…>` patterns. That's a positive signal — many WorkStation files have a few.)

## D5 — Visual Patterns Observed

| Pattern                                                                                                       | Where seen so far                                                                                                                  | Count              | Verdict                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Sticky collapsible file header (chevron + filetype icon + name + dir path + diff stats badge + status letter) | DiffFileSection (collapsible path), `src/modules/shared/components/FileHeader` (flat path used by `flat=true` branch in same file) | 2                  | **watch-list** (not yet ≥ 3)                                                                          |
| Additions/deletions two-tone badge                                                                            | `DIFF_STATS.containerCompact` token in `WorkStation/shared/tokens`                                                                 | already abstracted | —                                                                                                     |
| `bg-[var(--cm-editor-background)]` surface tinting                                                            | DiffFileSection + 5+ workstation/properties surfaces (see README)                                                                  | ≥ 5                | **abstract** — promote to Tailwind class in `tailwind.config.js` (this is the D2 verdict's mechanism) |

## Summary

| Verdict                       | Count                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------- |
| fix recommended               | **1** (D2: `bg-[var(--cm-editor-background)]` → Tailwind class, swept repo-wide) |
| keep with reason (documented) | 4 (D1 sticky button; D3 `text-[13px]`, `text-[11px]`×2)                          |
| keep (no concern)             | 8 (wrappers, decorative spans, lucide icons, accessible button)                  |
| abstract candidate            | 1 (the D2 hit, since it spans ≥ 5 files — the fix mechanism IS the abstraction)  |
| **D1/D4 violations found**    | **0**                                                                            |

## Takeaways from the pilot

1. **The skill works as intended.** It surfaces the user's reported `<button>` block, runs it through the rules, and reaches the right verdict (**keep with reason**, not "fix") — the explicit reasoning is the deliverable.
2. **The real issue in this file is D2, not D1.** The screenshot's `<button>` is fine; the `bg-[var(--cm-editor-background)]` is the actual debt — and it's a repo-wide pattern, not a per-file fix.
3. **Three `text-[Npx]` watch-list items** suggest the typography scale may have a missing tier (11 / 13 / 15) used by chrome headers. Worth a one-shot sweep next pass.
4. **No a11y debt.** The native `<button>` provides everything D4 cares about — another reason the screenshot's pattern is correct.

## Not in scope (intentionally)

- Modifying `DiffFileSection/index.tsx`.
- Modifying `tailwind.config.js` to land the D2 fix.
- Sweeping the other 5+ `bg-[var(--cm-editor-background)]` sites (listed in `README.md`).
- Re-evaluating `architecture-audit` coverage.

If you want to act on the D2 finding, that's a separate, repo-wide change with its own PR (modify `tailwind.config.js`, rewrite all 15+ site className strings, verify visual parity).
