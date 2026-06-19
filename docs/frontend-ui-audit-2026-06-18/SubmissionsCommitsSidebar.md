# Frontend UI Audit — Submissions Commits Sidebar

**File:** `src/modules/WorkStation/Diff/SessionReplay/SubmissionsContent.tsx` (296 LOC)
**Secondary file (data, not UI):** `src/modules/WorkStation/Diff/SessionReplay/index.tsx`
**Reused row:** `src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent/GitCommitRow.tsx`
**Date:** 2026-06-18
**Auditor:** session

> **Directory policy:** Per `workspace_frontend_ui_audit_directory_policy.md`, this report is **docs-only** — no source edits in the same pass. Verdicts marked `fix candidate` are deferred to a follow-up PR. The "data dedupe / mention-vs-created merge" landed earlier today is a separate, non-UI fix and is intentionally out of scope here.

## What the screenshot shows

Sidebar column titled `COMMITS` with two stacked entries, each rendered as:

```
┌──────────────────────────────┐
│  ⌜ MENTIONED COMMIT ⌟         │   ← independent pill row (SubmissionArtifactLabel)
│  ae4d75a                      │   ← GitCommitRow.summary line
│  Unknown                      │   ← GitCommitRow.author line
└──────────────────────────────┘
```

Reading-order concerns visible from the screenshot:

1. The per-row "MENTIONED COMMIT" pill **above** each entry visually splits the list into independent cards instead of a uniform "tag + commit row" cluster.
2. Both rows show `Unknown` as author, which reads as broken metadata.
3. Both rows show the short SHA as the "title" because the real commit summary isn't available yet.

(2) and (3) are not UI debt — they're upstream data fallbacks. The 5-dim audit below is scoped to the UI file; they're noted under **D-extra** for completeness.

## D1 — Raw HTML vs Design System

| Line                                                              | Element                                                                           | Verdict              | Reason                                                                                                                                                                                                                                                     | Suggested change                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubmissionsContent.tsx:159-161` `SubmissionArtifactLabel`        | `<span>` styled as a pill (`rounded-full border bg-fill-1 text-[10px] uppercase`) | **fix candidate**    | DS `Tag` already covers this exact role (label-only badge with size + bordered + pill variants — `src/components/Tag/index.tsx`). Hand-rolling it loses theme integration and "Mentioned/Created" no longer participates in token-level color refactors.   | Replace with `<Tag size="mini" bordered pill>{label}</Tag>` (optionally `color="primary"` for `origin === "created"` to differentiate). Keep the surrounding `shrink-0` if layout still needs it. |
| `SubmissionsContent.tsx:179-223` `PullRequestSubmissionRow` outer | `<div>` row (non-interactive)                                                     | **keep**             | The PR row is intentionally non-clickable; only the external GitHub `<a>` is interactive. No DS row primitive matches this "two-line metadata + external link" shape; promoting to `<Button variant="ghost">` would falsely imply the whole row activates. | —                                                                                                                                                                                                 |
| `SubmissionsContent.tsx:194-204` external link                    | `<a href target="_blank" rel="noreferrer">`                                       | **keep**             | Pure navigation; `aria-label` + `title` provide accessible name.                                                                                                                                                                                           | —                                                                                                                                                                                                 |
| `SubmissionsContent.tsx:240-251` per-commit row wrapper           | `<div>` containing label + `GitCommitRow`                                         | **keep with reason** | The interactive surface is `GitCommitRow` itself (which already renders a real `<button>` — see `GitCommitRow.tsx:113-124`). The outer `<div>` is a layout primitive hosting badge + row.                                                                  | —                                                                                                                                                                                                 |

## D2 — Arbitrary Tailwind Value vs Token

Sweeps:

```bash
rg '\b(bg|text|border)-\[var\(--' src/modules/WorkStation/Diff/SessionReplay/SubmissionsContent.tsx   # 0 hits
rg '\b(bg|text|border)-\[#'        src/modules/WorkStation/Diff/SessionReplay/SubmissionsContent.tsx   # 0 hits
```

The file uses semantic tokens (`bg-fill-1`, `border-border-2`, `text-text-1/3`) consistently. **No findings.**

## D3 — Hardcoded Sizes / Colors

| Line | Value                                             | Verdict                  | Reason                                                                                                                                      | Suggested change                 |
| ---- | ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 159  | `text-[10px] font-medium uppercase tracking-wide` | **absorbs into D1**      | This literal disappears once the badge becomes `<Tag size="mini">` — Tag's own size scale owns the font sizing.                             | (no separate change beyond D1)   |
| 207  | `text-[12px] font-medium leading-snug` (PR title) | **deferred to D3 sweep** | `12px` = `text-xs` default; mechanical swap (`workspace_design_token_consumption_gap.md` batch class 1). Not this file's PR.                | Defer to the repo-wide D3 sweep. |
| 213  | `text-[11px]` (PR branch line)                    | **deferred to D3 sweep** | Bare 11px; same role as `GitCommitRow:137` author line. Both belong to the WorkStation-folder D3 cleanup (consume a `TYPOGRAPHY` constant). | Defer.                           |
| 214  | `<GitBranch size={12} />`                         | **keep**                 | < 16px optical-alignment microvalue.                                                                                                        | —                                |

## D4 — Accessibility

| Line                                       | Element                   | Verdict  | Reason                                                                                                                                                             | Suggested change |
| ------------------------------------------ | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 159-161 `SubmissionArtifactLabel` `<span>` | non-interactive label     | **keep** | Decorative descriptor; reading order places it adjacent to the (interactive) `GitCommitRow` button which carries the accessible name (commit summary via `title`). | —                |
| `GitCommitRow.tsx:113-124` row `<button>`  | interactive               | **keep** | Real `<button type="button">` with visible text children + `title`.                                                                                                | —                |
| 165-224 `PullRequestSubmissionRow` `<div>` | non-interactive container | **keep** | No `onClick`; the only interactive child is the `<a>` (labelled).                                                                                                  | —                |
| 194-204 `<a>` external link                | external nav              | **keep** | `aria-label` + `title` + `rel="noreferrer"`.                                                                                                                       | —                |

## D5 — Repeated Visual Patterns

```bash
rg 'rounded-full border border-border-2 bg-fill-1 px-1\.5 py-0\.5' src/   # 1 site (this file)
rg 'text-\[10px\] font-medium uppercase tracking-wide'            src/   # 2 sites
```

| Pattern                                                                                             | Sites                                    | Count | Action                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| Tiny uppercase "context" pill — `rounded-full border bg-fill-1 px-1.5 py-0.5 text-[10px] uppercase` | `SubmissionArtifactLabel` (this file)    | 1     | D1 fix consumes it (`Tag`, not a new abstraction).                                                            |
| `text-[10px] font-medium uppercase tracking-wide` (section eyebrow text, no pill)                   | `SessionRunCard:175`, `ComposerPill:413` | 2     | Watch-list. Different role (section eyebrow / sticky panel header), not a context pill — do **not** abstract. |
| Master-detail "label-above-row" structure (`<SubmissionArtifactLabel>` + `<GitCommitRow>`)          | only here                                | 1     | Not a D5 candidate.                                                                                           |

**Conclusion:** no abstraction needed. The single D1 swap (handwritten pill → `Tag`) closes the only flag.

## D-extra — Data / UX findings the screenshot exposes (cross-cutting; non-blocking)

Not part of the 5-dim UI audit; flagged here because the screenshot makes them obvious.

1. **`Unknown` author on every mentioned-commit row.** Source: `GitCommitRow.tsx:109` `commit.author?.name ?? "Unknown"`. Today's just-shipped merge intentionally allows `author === null` rows (mention commits don't carry author until git-history resolve, and out-of-repo commits may never resolve). Result: every mention-commit row reads `Unknown`. Options (not landing this pass):
   - Show `Mentioned in chat` or the parsed `repoFullName` when `author == null` and `origin === "mentioned"`.
   - Or hide the author line entirely in that case.
   - Either option requires extending `GitCommitRowProps` or wrapping the row — out of scope for a "reuse components" pass.

2. **`summary` falling back to the short SHA.** `index.tsx:96` `commitLinkToSubmissionCommit` and `SubmissionsContent.tsx:83` `commitFromArtifact` both default `summary` to `shortSha` when orgtrack/text-parse didn't supply a subject. The screenshot's `ae4d75a` / `21b1bc6` "title" rows are this fallback, not a real commit message. Fix belongs upstream (parser / orgtrack), not in this UI file.

3. **Per-row pill stacks vertically.** With the D1 swap to `<Tag size="mini">`, the badge picks up DS-standard chip sizing and the "two independent cards" feel softens. If the user wants the badge **inline** with the SHA/summary line instead of above it, that's a layout change inside `SubmissionCommitsContent`'s `commitRows` (move `<SubmissionArtifactLabel>` from its own `<div className="px-3 pb-1 pt-2">` into a flex row with the commit summary). Not an audit verdict — flag for a UX micro-pass on request.

## Summary

- **fix candidates: 1** — replace the hand-rolled `SubmissionArtifactLabel` `<span>` pill with DS `Tag` (`size="mini"` `bordered` `pill`). Landing belongs to a focused follow-up PR per directory policy.
- **kept with documented reason: 3** — PR row `<div>`, per-commit row wrapper `<div>`, external link `<a>` (D1 / D4).
- **abstract candidates (≥3 occurrences): 0** — D5 sweep shows the pill is a one-off.
- **deferred to existing sweeps: 2** — `text-[12px]` / `text-[11px]` → batchable into the repo-wide D3 sweep, not this PR.
- **out-of-scope notes: 2** — `Unknown` author copy and `summary` fallback to short SHA are upstream (data/parser) concerns, not UI debt.

**Total recommended source changes in this audit pass: 0.** The single D1 fix and the two D3 deferrals each belong to their own scoped PR.
