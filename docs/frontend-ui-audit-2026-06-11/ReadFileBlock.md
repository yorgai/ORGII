# Frontend UI Audit — ReadFileBlock

**File:** `src/engines/ChatPanel/blocks/ReadFileBlock/index.tsx` (151 LOC)
**Date:** 2026-06-12
**Auditor:** session — `frontend-ui-audit` skill smoke run on the just-shipped
"Use xxx skill" header patch (+22 / −5 from the previous `Read SKILL.md` render).

> **Scope caveat.** The skill's `When NOT To Use` clause flags single bug-fix
> PRs as low value-to-noise. This file is exactly that — a ~30-line targeted
> patch, not a refactor. The audit was run as a deliberate dry-run on the
> smallest reasonable surface; treat the findings accordingly. The one signal
> worth keeping (D5 — duplicate skill-path detection) was found by the
> repo-wide sweep, not by the per-file pass.

## D1 — Raw HTML vs Design System

| Line    | Element                                                                | Verdict | Reason                                                                                    | Suggested change |
| ------- | ---------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | ---------------- |
| 102     | `<div className=getEventBlockContainerClasses(false) animate-fade-in>` | keep    | Layout wrapper hosting `EventBlockHeader` primitives; no interactive behavior to delegate | —                |
| 137-142 | `<span data-testid="read-file-path">{displayName}</span>`              | keep    | Plain text node inside the DS `EventBlockHeaderSubtitle`; no interactive role             | —                |

All interactive surfaces (chevron toggle, locate-on-click, hover area) are
already delegated to `EventBlockHeader` / `EventBlockHeaderIcon` /
`EventBlockHeaderSubtitle` / `EventBlockHeaderTitle` / `FailedEventRow` / `FileTypeIcon`. No raw `<button>` / `<input>` / `<a>` / `<div onClick>`.

**Hits: 0.**

## D2 — Arbitrary Tailwind Value vs Token

Sweep: `(bg|text|border|fill|ring|shadow|from|to|via|outline|divide)-\[var\(--` and `-\[#hex\]` against the file.

**Hits: 0.** All color uses are semantic tokens (`text-text-1`, `text-text-2`,
`EVENT_LOADING_SHIMMER_TEXT_CLASSES` from primitives).

## D3 — Hardcoded Sizes / Colors

Sweep: `\[\d+(px|rem)\]` against the file, plus raw lucide `size={N}` props.

| Line   | Value                                                                              | Verdict | Reason                                                                                                                                                               | Suggested change |
| ------ | ---------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 81, 84 | `size={SESSION_UI_TOKENS.ICON.SIZE_SM}` (both branches of the `isSkill ?` ternary) | keep    | Already routed through the project icon-size token; matches the rest of `ReadFileBlock`'s convention                                                                 | —                |
| 134    | `mr-1.5 shrink-0` on `FileTypeIcon`                                                | keep    | 6px sub-spacing-scale microadjust for icon→text gap, in line with skill's `< 4px` exemption spirit (1.5 = 6px is the smallest Tailwind step without arbitrary value) | —                |

**Hits: 0.** No raw color literals, no pixel-literal `w-[Npx]` / `h-[Npx]`.

## D4 — Accessibility

| Line         | Surface                                                                           | Verdict | Reason                                                                        |
| ------------ | --------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| 107-121      | `EventBlockHeader` (`onNavigate` + `onMouseEnter/Leave`)                          | keep    | DS primitive owns the keyboard / focus semantics                              |
| 114-121      | `EventBlockHeaderIcon` with `revealChevronOnIconHoverOnly` + `hasContent={false}` | keep    | DS primitive; chevron toggle a11y handled internally                          |
| 91-100       | `FailedEventRow`                                                                  | keep    | DS primitive; renders the failure as a labelled row                           |
| 123          | `EventBlockHeaderTitle` content (`title`)                                         | keep    | Provides the accessible name ("Use" or "Read") next to the icon               |
| 127, 137-142 | `displayName` subtitle (`title={displayName}` on host + visible text)             | keep    | Both the native browser tooltip and visible label carry the skill / file name |

**Hits: 0.** No raw interactives need ARIA. The `Sparkles` icon on line 81 is
purely decorative — fine because the labelled `EventBlockHeaderTitle` provides
the accessible name.

## D5 — Visual Patterns Observed

### Pattern P1 — skill path detection (`**/skills/<name>/SKILL.md`)

The just-shipped patch added a 5th independent implementation of "given a
file path, decide if it's a SKILL.md and extract the skill name".

| #       | Site                                                                                                                                                               | Shape                                                                                                                    | Variant beyond the base regex                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | `src/components/ComposerInput/pasteHandlers.ts:117` `extractSkillNameFromPath`                                                                                     | `/[/\\]skills(?:-[^/\\]+)?[/\\]([^/\\]+)[/\\]SKILL\.md$/i`                                                               | Also matches Cursor's `skills-cursor/<name>/SKILL.md` — strictly more general than the new one                                                                                                    |
| 2       | `src/scaffold/WizardSystem/variants/Skill/SkillEditorPanel.tsx`                                                                                                    | inline `/skills/` checks                                                                                                 | save-location derivation                                                                                                                                                                          |
| 3       | `src/scaffold/WizardSystem/variants/Skill/SkillEditorBlocks.tsx`                                                                                                   | inline `/skills/` checks                                                                                                 | block-editor scope detection                                                                                                                                                                      |
| 4       | `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent/views/skillFrontmatter.ts` (re-export) → `src/util/skills/skillFrontmatter.ts` | dedicated frontmatter parsing module; no path matcher exported                                                           | Owns SKILL.md _parsing_, not _path detection_ — closest existing utility                                                                                                                          |
| 5       | `src/types/extensions/types.ts:65-78`                                                                                                                              | `SKILL_SOURCE` const documents `<workspace>/.orgii/skills/<name>/` and `~/.orgii/skills/<name>/` as the canonical shapes | Schema declaration, not a runtime matcher                                                                                                                                                         |
| 6 (new) | `src/engines/ChatPanel/blocks/ReadFileBlock/index.tsx:44` `extractSkillName`                                                                                       | `/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i`                                                                            | Strictly weaker than (1) — doesn't match `skills-cursor/` paths, so the new ChatPanel header will render `Read SKILL.md` for the Cursor skills the user has at `~/.cursor/skills/<name>/SKILL.md` |

**Verdict: abstract candidate (≥ 3 sites).**

There is no exported helper today; (1) is file-private. The right move is one
of:

1. Promote `extractSkillNameFromPath` out of `ComposerInput/pasteHandlers.ts`
   into `src/util/skills/skillPath.ts` (or extend the existing
   `src/util/skills/skillFrontmatter.ts` module — same folder, same concern).
2. Replace the new `ReadFileBlock`-local `SKILL_PATH_RE` with an import from
   the shared helper. This also fixes the Cursor-skills regression the new
   regex introduces (the user's `~/.cursor/skills/` directory still shows
   `Read SKILL.md`, not `Use xxx skill`).
3. Optional: re-point `pasteHandlers.ts`'s import to the new shared location
   so it stops being the de-facto owner.

Cost: ~15 LOC + 1 unit test. Blast radius: 1 new file + 2 import lines.

### Pattern P2 — `EventBlockHeader` / `EventBlockHeaderIcon` / `EventBlockHeaderSubtitle` / `EventBlockHeaderTitle` composition

Used the same way across `ReadFileBlock`, `SearchBlock`, `ListDirBlock`,
`GlobBlock`, `ShellBlock` (per `src/engines/ChatPanel/blocks/`). Already
abstracted as primitives. No action.

## Summary

- **0 fixes** strictly inside the file diff (D1/D2/D3/D4 all clean).
- **0 keep-with-reason** rows (no DS-bypass decisions were made by this patch).
- **1 abstract candidate** uncovered by the repo-wide D5 sweep: skill-path
  matcher (6 sites total, current site being the 6th and also a regression for
  Cursor skills).
- Recommended follow-up: small helper extraction in
  `src/util/skills/skillPath.ts`, replace both `pasteHandlers.ts` and
  `ReadFileBlock` callers. Closes a duplication class **and** fixes a real
  rendering bug for the user's `~/.cursor/skills/` content.
