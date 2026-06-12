# D3 Sweep — `text-[Npx]` Typography Microsizes

**Date:** 2026-06-11
**Scope:** Phase 2-B of `frontend-ui-audit-2026-06-11`.
**Skill:** `~/.orgii/skills/frontend-ui-audit/SKILL.md` D3 + D5.

## TL;DR

- The `text-[Npx]` literal lands in **~400+ sites** across the repo. It's the largest single UI-consistency debt class in this codebase.
- The Tailwind `fontSize` scale is intentionally minimal — only `xs` (12px) and `sm` (14px) are extended (`tailwind.config.js:109-112`). Everything else (10 / 11 / 13 / 15 / 16 / 18 / 9 px) is written as an arbitrary value.
- **A naming layer already exists** at `src/config/workstation/tokens.ts:243-277` (`TYPOGRAPHY.{secondary, panelTitle, panelSubtitle, badge, listItem, ...}`) — but is consumed by **≤ 10** sites. The other 400+ sites duplicate `text-[Npx]` strings inline.
- Recommended **fix shape is the same as D2** (`D2-cm-editor-sweep.md`): consolidate via the existing `TYPOGRAPHY` constants first; only promote to `tailwind.config.js` if/when CSS-context consumers appear. **Do NOT add `text-chrome-xs` / `text-chrome-sm` Tailwind classes yet.**
- Within this pass, the **abstract verdict** (>= 3 occurrences, skill rule) applies to: `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`. The other values (`9 / 15 / 16 / 18`) are sparse enough to **keep with reason** as optical micro-adjustments.

## Method

```bash
rg 'text-\[\d+px\]' --type tsx --type ts src/ | awk -F'text-\\[' '{print $2}' \
  | awk -F'px\\]' '{print $1}' | sort | uniq -c | sort -rn
```

Plus targeted greps per value to confirm hit-density and bucket by role.

## Hit distribution

Counts are conservative (`code_search` capped at 100 results per query; absolute counts confirmed by per-value greps). The salient story is the **relative ordering**, not the precise number.

| Value         | Approx hits | Role density                                                                                                                          |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `text-[12px]` | ~100+       | Settings rows, table cells, sidebar copy, work-item properties. The single most common arbitrary fontSize.                            |
| `text-[11px]` | ~100+       | Chrome subtitles, file path under filename, status badges, count chips, footer hints.                                                 |
| `text-[10px]` | ~100+       | Tiny tag badges (BADGE family), session row metadata, ChatPanel timestamps, Stamp/DevPassport overlays.                               |
| `text-[13px]` | ~100+       | List-item primary label, FileHeader filename, ComposerStack header title, Pill labels (Mode/Model), breadcrumb mid-tier.              |
| `text-[14px]` | ~30         | Content title in placeholders, profile rows, conflict-row headers.                                                                    |
| `text-[15px]` | ~10         | Modal/spotlight form labels, AskUser event title, command card titles.                                                                |
| `text-[16px]` | ~15         | Modal headers (CloneRepo / CreateWorkspace forms), GlobalDragDrop banner, chat model picker.                                          |
| `text-[18px]` | ~5          | SpotlightModalHeader, KiroSessionSetup hero label, WorkspaceExplorePanelView headline.                                                |
| `text-[9px]`  | ~10         | Background-section animation labels, AgentWorkflow file-row deep micro labels, Stamp inscription overlays — single-purpose mini-text. |

**Buckets that meet the skill's "abstract" threshold (>= 3 sites with the same role):** 10 / 11 / 12 / 13 px.

## Existing tokens — `TYPOGRAPHY` in `src/config/workstation/tokens.ts`

The codebase already has a named layer for the four common sizes:

```ts
// src/config/workstation/tokens.ts:243-277 (excerpt)
export const TYPOGRAPHY = {
  /** Field labels (form, settings, sidebar) — 12px medium */
  label: "text-[12px] font-medium",
  /** Body text in forms, settings, sidebar — 12px normal */
  body: "text-[12px] font-normal",
  /** Form/settings values — 12px normal */
  value: "text-[12px] font-normal",
  /** Emphasized values — 12px medium */
  valueMedium: "text-[12px] font-medium",
  /** Numeric stats, card numbers — 14px semibold */
  statistic: "text-[14px] font-semibold",
  /** Helper text, timestamps, badges — 11px normal */
  secondary: "text-[11px] font-normal",
  /** Panel placeholders (sidebar) — 12px normal */
  panelTitle: "text-[12px]",
  /** Panel subtitle — 11px */
  panelSubtitle: "text-[11px]",
  /** Content placeholders (main area) — 14px bold */
  contentTitle: "text-[14px] font-medium",
  /** Content subtitle — 12px */
  contentSubtitle: "text-[12px]",
  /** List items, row labels — 13px medium */
  listItem: "text-[13px] font-medium",
  /** Small badges, counts — 10px medium */
  badge: "text-[10px] font-medium",
} as const;
```

Plus subordinate tokens that bake in the same micro-sizes:

| Token                                               | Definition                        | Size baked in |
| --------------------------------------------------- | --------------------------------- | ------------- |
| `COUNT_BADGE.base` (`tokens.ts:286`)                | `... text-[11px] font-medium`     | 11px          |
| `DIFF_STATS.container` (`tokens.ts:317`)            | `... text-[12px]`                 | 12px          |
| `DIFF_STATS.containerCompact` (`tokens.ts:319`)     | `... text-[11px]`                 | 11px          |
| `SECTION_ACTION_BUTTON.withLabel` (`tokens.ts:332`) | `gap-1 px-1.5 py-0.5 text-[11px]` | 11px          |
| `FOLDER_HEADER.name` (`tokens.ts:347`)              | `... text-[12px] font-medium ...` | 12px          |

So the naming layer for the four common sizes is already there — it just isn't consumed.

## Verdict table by value

| Value         | Verdict                                                                          | Reason                                                                                                                                                                               | Mechanism                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `text-[10px]` | **abstract → consolidate via TYPOGRAPHY.badge**                                  | ~100 sites, all serve the same role (tiny badge / chip / inline timestamp). `TYPOGRAPHY.badge` already names this size with the right weight (`font-medium`).                        | Codemod: `text-[10px] font-medium` → `TYPOGRAPHY.badge`; bare `text-[10px]` → introduce `TYPOGRAPHY.micro = "text-[10px]"` |
| `text-[11px]` | **abstract → consolidate via TYPOGRAPHY.secondary / panelSubtitle**              | ~100 sites, two roles: helper/timestamp text (`secondary`) and panel subtitle (`panelSubtitle`). Both already named.                                                                 | Codemod per role (see "Mapping table" below)                                                                               |
| `text-[12px]` | **abstract → consolidate via TYPOGRAPHY.body / label / value / contentSubtitle** | ~100 sites. Role-split (label vs value vs body vs subtitle). Tokens already cover all four.                                                                                          | Codemod per role                                                                                                           |
| `text-[13px]` | **abstract → consolidate via TYPOGRAPHY.listItem (and a new `chromeMid`)**       | ~100 sites. Two roles: list-item primary label (`listItem`, already named) and chrome midline (pill labels, breadcrumb current segment, FileHeader filename — no token yet).         | Codemod for the named role; introduce one new constant for the chrome midline role                                         |
| `text-[14px]` | **keep with reason**                                                             | ~30 sites, mostly content titles or stats. Tailwind `text-sm` is 14px — if a fix is wanted, the right move is `text-sm`, not a new token. Many existing sites already use `text-sm`. | Sweep later: bare `text-[14px]` → `text-sm`                                                                                |
| `text-[15px]` | **keep with reason**                                                             | ~10 sites. Sits between Tailwind `text-sm` (14) and `text-base` (16). Sparse, role-specific (modal/spotlight). Promoting it would create a token used by <12 sites.                  | Document, do not abstract                                                                                                  |
| `text-[16px]` | **keep with reason**                                                             | ~15 sites. Tailwind's `text-base` is exactly 16px. Most of these sites should use `text-base` directly.                                                                              | Sweep later: bare `text-[16px]` → `text-base` (mechanical)                                                                 |
| `text-[18px]` | **keep with reason**                                                             | ~5 sites in modal headers. Tailwind's `text-lg` is 18px. Use `text-lg`.                                                                                                              | Sweep later: bare `text-[18px]` → `text-lg`                                                                                |
| `text-[9px]`  | **keep with reason**                                                             | ~10 sites, sub-spacing-scale micro-text in animations / file-row deep metadata. Skill carves out < 4px and sub-spacing-scale micro-fits — 9px qualifies.                             | Document each site's reason inline                                                                                         |

### Why "consolidate via existing constants" beats "add Tailwind fontSize keys"

Adding `text-chrome-xs: 11px` and `text-chrome-sm: 13px` to `tailwind.config.js` is tempting but:

1. **`TYPOGRAPHY.secondary` already carries weight** (`font-normal`) and **`TYPOGRAPHY.badge` carries weight + medium**. A Tailwind `text-chrome-xs` would still need a sibling weight class everywhere — saving zero characters per site.
2. **The 100+ sites that need fixing already mix size + weight + color + truncation** (`text-[11px] font-medium text-text-1 truncate`). The consolidation value is in role-naming (`TYPOGRAPHY.panelSubtitle`), not in saving 4 characters on the size axis.
3. **Tailwind `text-base` / `text-sm` / `text-lg` cover 14 / 16 / 18 already.** The audit's recommendation for those is "use the existing class, no new tokens".
4. The TYPOGRAPHY layer can grow incrementally without a Tailwind config regen step.

## Mapping table — the codemod once landing is approved

Single-source-of-truth per role. Each row is a search-replace target for the eventual landing PR.

| Inline form                                    | Replacement (from `TYPOGRAPHY`)                | Hit class                                            |
| ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `text-[10px] font-medium`                      | `TYPOGRAPHY.badge`                             | Pure badge/chip                                      |
| `text-[11px] font-normal`                      | `TYPOGRAPHY.secondary`                         | Helper text, timestamps                              |
| `text-[11px]` (as a panel subtitle)            | `TYPOGRAPHY.panelSubtitle`                     | Sidebar/panel sub-row                                |
| `text-[12px] font-medium`                      | `TYPOGRAPHY.label`                             | Form / settings field label                          |
| `text-[12px] font-normal`                      | `TYPOGRAPHY.body` / `value`                    | Form / settings body text                            |
| `text-[12px]` (as panel placeholder)           | `TYPOGRAPHY.panelTitle`                        | Sidebar panel title                                  |
| `text-[12px]` (as content subtitle)            | `TYPOGRAPHY.contentSubtitle`                   | Main-area subtitle                                   |
| `text-[13px] font-medium`                      | `TYPOGRAPHY.listItem`                          | List/row primary label                               |
| `text-[13px]` (chrome midline, no font-medium) | **NEW** `TYPOGRAPHY.chromeMid = "text-[13px]"` | Pill labels, breadcrumb current, FileHeader filename |
| `text-[14px] font-semibold`                    | `TYPOGRAPHY.statistic`                         | Stat number                                          |
| `text-[14px] font-medium`                      | `TYPOGRAPHY.contentTitle`                      | Main-area title                                      |
| `text-[14px]` (no weight)                      | `text-sm` (Tailwind default)                   | Generic body                                         |
| `text-[16px]`                                  | `text-base` (Tailwind default)                 | Modal / form text                                    |
| `text-[18px]`                                  | `text-lg` (Tailwind default)                   | Modal headers                                        |

For the bare `text-[11px]` / `text-[12px]` / `text-[10px]` cases where the role is ambiguous from the className alone, the auditor doing the landing PR will need to look at the surrounding component to decide between `secondary` / `panelSubtitle` (etc.). This is the inevitable "case-by-case judgment" the skill calls out as load-bearing — don't try to make it fully mechanical.

## Suggested incremental landing PR shape

Doing this in one PR is too big (~400 sites, ~50 files). The cleanest path is to land in **3 PRs of decreasing visibility**:

| PR  | Scope                                                                                                                                                                          | Why                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| #1  | Replace `text-[16px]` / `text-[18px]` with `text-base` / `text-lg` (Tailwind defaults). ~20 sites.                                                                             | Smallest, all mechanical, mostly modal headers. Validates the methodology.                                                     |
| #2  | Replace `text-[10px] font-medium` with `TYPOGRAPHY.badge` (~80 sites) and `text-[14px] font-semibold` with `TYPOGRAPHY.statistic` (~10 sites). Same-token role is unambiguous. | Largest mechanical batch with zero role-disambiguation.                                                                        |
| #3  | Tackle `text-[11px]` / `text-[12px]` / `text-[13px]` per-feature folder (settings / chatpanel / workstation chrome / project manager), one role at a time. ~300 sites.         | Requires per-call-site role decisions; do not batch across feature folders. Consider this a multi-month opportunistic cleanup. |

The Phase 2-B output (this doc) is enough for any auditor to start PR #1 today.

## Sites that should NOT use the TYPOGRAPHY tokens

- **Bridge layer**: `src/features/CodeMirror/*` — anything that emits CSS theme strings rather than React className. Skip.
- **The token definitions themselves** (`tokens.ts:264, 268, 286, 319, 332`) — these intentionally inline the value; that's where the abstraction is born.
- **DevPassport / Stamp** (`src/components/DevPassport/Stamp.tsx`) — uses `text-[9px]` and `text-[10px]` for designed-print typography. Skill rule "< 16px micro-fit" plus deliberate visual style. Keep with reason.
- **DevTools panels** under `src/modules/WorkStation/Browser/Panels/BrowserSecondaryPanel/components/WebDevTools/` — these mimic browser DevTools' own visual style (Network / Sources / Elements tabs). `text-[11px]` is the DevTools convention. Keep with reason; document at the top of each file or in a wrapper component if a future audit re-flags.

## Not in scope

- Modifying any source file (Phase 2-B is reporting only).
- Modifying `tailwind.config.js` or `src/config/workstation/tokens.ts` (the `chromeMid` constant proposal stays as a recommendation).
- Doing the per-site role disambiguation for the 300+ ambiguous `text-[11px]` / `text-[12px]` / `text-[13px]` sites — that belongs to the landing PRs.
- Other typography concerns (`line-height`, `letter-spacing`, `font-family`) — D3 is size+color only.
