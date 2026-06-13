# Frontend UI Audit — 2026-06-11

First runs of the `frontend-ui-audit` skill (`~/.orgii/skills/frontend-ui-audit/SKILL.md`).

## Files audited

| Date       | File                                                                                  | LOC      | D1 hits                                                             | D2 hits                                              | D3 watch                                                                             | D4 hits                                                                                    | D5 deltas                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 2026-06-11 | `src/modules/WorkStation/shared/DiffFileSection/index.tsx`                            | 330      | 0 (1 keep-with-reason)                                              | 1 (`bg-[var(--cm-editor-background)]`)               | 3 (`text-[11px]` ×2, `text-[13px]`)                                                  | 0                                                                                          | sticky chrome header (1st instance)                                                                               |
| 2026-06-11 | `src/modules/shared/layouts/blocks/PanelHeader/index.tsx`                             | 436      | 0                                                                   | 1 (same as above)                                    | 5 (inline `style={{ fontSize: 13 }}` — alternative form)                             | 0                                                                                          | breadcrumb parent-current pair (3rd instance → abstract candidate)                                                |
| 2026-06-12 | `src/modules/MainApp/IdeaArea/views/SharedView/index.tsx` + `components/IdeaCard.tsx` | 86 + 108 | 2 (badge clusters → DS `Tag`)                                       | 3 (raw Tailwind palette colors + focus-ring formula) | ~10 (all defer to D3 sweep)                                                          | 2 (input `aria-label`, button `type="button"`)                                             | categorical color lookup table → Tag absorption (abstract candidate); 3 watch-list patterns                       |
| 2026-06-13 | `src/engines/ChatPanel/ChatItems/UserChatItem.tsx`                                    | 475      | 3 (close `<button>`, link `<a>`, edit `<button>` → IconButton/i18n) | 3 (`bg-[#232325]`, `text-white/70`, `text-blue-400`) | 3 fixable + 1 mechanical (`gap-[6px]→gap-1.5`); 4 keep (incl. truncation thresholds) | 4 (outer `<div onClick>` keyboard, chip `<div onClick>` keyboard, 2× missing `aria-label`) | CachedFileChip preview popover → ImagePreviewOverlay (watch); raw `text-blue-400` link (3rd repo-wide occurrence) |

## Cross-cutting sweeps

| Sweep                                 | File                           | What it covers                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D2 `bg-[var(--cm-editor-background)]` | `D2-cm-editor-sweep.md`        | 6 className sites (3 bare + 3 fallback variant). Existing token `EDITOR_TAB_CANVAS_BG_CLASS` already covers the bare case; recommends adding sibling `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS` for the 3 fallback consumers. |
| D3 `text-[Npx]` micro-sizes           | `D3-typography-scale-sweep.md` | 400+ inline `text-[Npx]` sites bucketed by value (10/11/12/13/14/15/16/18/9). Confirms `TYPOGRAPHY` constants in `tokens.ts` already name 10/11/12/13/14 — just unused. Maps 14/16/18 to Tailwind defaults.              |

## Scope of this directory

- Per-file audit reports in the skill's prescribed 5-dimension format (`DiffFileSection.md`, `PanelHeader.md`).
- Cross-cutting sweeps that escalate D2/D3 findings from "this one site" to "the whole pattern across the repo".
- This README — index + how to extend.

## What these reports do NOT do

- **Do not modify source code.** Verdicts are documented only; landing fixes is a separate follow-up so PR scope stays clean.
- **Do not touch `tailwind.config.js`.** The D2/D3 recommendations route through `src/config/workstation/tokens.ts` constants instead — the abstraction already exists there.
- **Do not touch `architecture-audit`.** Two skills coexist; callers pick by scope.

## Pending repo-wide actions (ready for landing PRs)

These are the consolidations the sweep reports prepared. Each one is a separate PR — see the sweep doc for the full codemod table.

| Action                                                                                                                | Scope                                                                                                                                                | Mechanism                                                                                                                                                                                  | Risk                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Consolidate `bg-[var(--cm-editor-background)]` → existing `EDITOR_TAB_CANVAS_BG_CLASS`**                            | 6 className sites in `DiffFileSection`, `PanelHeader`, `SubagentPromptToggle`, `StatusBarRenderer`, `WorkItemProperties`, `PropertiesRailFrame` (×2) | Add `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS` to `tokens.ts`; import + substitute in the 6 files                                                                                               | Low — string substitution, visual identical                                                          |
| **Sweep `text-[16px]` / `text-[18px]` → Tailwind defaults `text-base` / `text-lg`**                                   | ~20 sites, mostly modal headers (CloneRepo, CreateWorkspace, SpotlightModalHeader, KiroSessionSetup)                                                 | Mechanical find-replace, no token addition                                                                                                                                                 | Low — Tailwind defaults are exact-pixel matches                                                      |
| **Consolidate `text-[10px] font-medium` / `text-[14px] font-semibold` → `TYPOGRAPHY.badge` / `TYPOGRAPHY.statistic`** | ~90 sites, unambiguous role                                                                                                                          | Import + substitute                                                                                                                                                                        | Low — token already named                                                                            |
| **Per-feature-folder cleanup of bare `text-[11px]` / `text-[12px]` / `text-[13px]`**                                  | ~300 sites across settings / chatpanel / workstation chrome / project manager                                                                        | Per-site role disambiguation → `TYPOGRAPHY.{secondary, panelSubtitle, body, label, value, listItem, ...}`; introduce new `TYPOGRAPHY.chromeMid` for bare `text-[13px]` chrome midline role | Medium — case-by-case judgment, do not batch across feature folders. Multi-PR opportunistic cleanup. |

The first three are mechanical; the fourth needs the case-by-case judgment the skill encourages.

## Next candidates for per-file audit

In priority order, based on the 5-dimension surface area and density of UI tokens:

1. `src/modules/ProjectManager/WorkItems/components/WorkItemProperties/index.tsx` — properties panel, high density, D2 hit confirmed
2. `src/modules/WorkStation/shared/StatusBar/StatusBarRenderer.tsx` — chrome bar, three appType branches, D2 hit confirmed
3. `src/modules/ProjectManager/shared/components/PropertiesPanel/PropertiesRailFrame.tsx` — comfort/compact layout switching, 2 D2 hits in same file
4. `src/engines/Simulator/components/GridCell/SubagentPromptToggle.tsx` — portalled panel, lower density but interactive

## Running the audit on another file

```bash
# From the skill (see ~/.orgii/skills/frontend-ui-audit/SKILL.md):
# 1. Grep D1-D4 patterns over the target file.
# 2. For each hit, judge against the rules and record a row in the report table.
# 3. After D1-D4, cross-reference against the existing sweep reports (D2/D3) before
#    deciding "fix" vs "consolidate via existing constant".
# 4. Emit a report at docs/frontend-ui-audit-YYYY-MM-DD/<ComponentName>.md.
# 5. Update this README's "Files audited" table.
```
