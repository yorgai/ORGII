# D2 Sweep — `bg-[var(--cm-editor-background)]`

**Date:** 2026-06-11
**Scope:** Phase 2-A of `frontend-ui-audit-2026-06-11`.
**Skill:** `~/.orgii/skills/frontend-ui-audit/SKILL.md` D2.

## TL;DR

- **6 className sites** use the arbitrary value `bg-[var(--cm-editor-background)]` (with or without `var(...,--color-bg-1)` fallback) — far fewer than the README's initial estimate of "≈ 15 / 19 sites". The earlier number conflated **className users** with **token definitions / SCSS injectors / inline `style={{}}` consumers**, which are different verdicts.
- **A token already exists**: `src/config/workstation/tokens.ts:13` defines `EDITOR_TAB_CANVAS_BG_CLASS = "bg-[var(--cm-editor-background)]"`. Only **0 / 6** sites consume it today — 6 sites duplicate the string literal instead.
- The cheapest fix is **not** a `tailwind.config.js` mapping (R4 from the pilot suggested that). It is: **make the existing `EDITOR_TAB_CANVAS_BG_CLASS` the single source of truth, and replace the 6 sites with it.** No config change, no Tailwind sweep, mechanical 6-line edit.
- The remaining `--cm-editor-background` references are either (a) bridge layer (CodeMirror theme `:root` injection, terminal theme adapters) — keep untouched, or (b) `style={{}}` consumers in xterm/CodeMirror bridges — keep untouched.

## Method

```bash
# 1. className users (the actual D2 hits)
rg 'bg-\[var\(--cm-editor-background' --type tsx --type ts src/

# 2. All --cm-editor-background occurrences (def + read + inline style)
rg -- '--cm-editor-background' --type tsx --type ts --type scss --type css src/

# 3. Sibling token names (to decide if multiple keys need mapping)
rg -- '--cm-editor-(foreground|gutter|selection|cursor|line-highlight)' src/

# 4. Equivalent inline styles
rg 'var\(--cm-editor-background\)' src/
```

## Findings — className sites (6 hits, all D2)

| #   | File                                                                                   | Line   | Form                                                                                           | Role                                                                                    | Verdict                                    |
| --- | -------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `src/modules/WorkStation/shared/DiffFileSection/index.tsx`                             | 275    | bare `bg-[var(--cm-editor-background)]`                                                        | Sticky collapsible file header background                                               | **fix** — use `EDITOR_TAB_CANVAS_BG_CLASS` |
| 2   | `src/modules/shared/layouts/blocks/PanelHeader/index.tsx`                              | 293    | bare `bg-[var(--cm-editor-background)]`                                                        | Panel header when `background === "editorCanvas"`                                       | **fix** — use `EDITOR_TAB_CANVAS_BG_CLASS` |
| 3   | `src/engines/Simulator/components/GridCell/SubagentPromptToggle.tsx`                   | 130    | bare `bg-[var(--cm-editor-background)]`                                                        | Portalled subagent prompt panel surface                                                 | **fix** — use `EDITOR_TAB_CANVAS_BG_CLASS` |
| 4   | `src/modules/WorkStation/shared/StatusBar/StatusBarRenderer.tsx`                       | 29     | with fallback `bg-[var(--cm-editor-background,var(--color-bg-1))]`                             | Floating status bar background; needs the fallback to degrade outside CodeMirror routes | **fix (variant)** — see "Two-tone variant" |
| 5   | `src/modules/ProjectManager/WorkItems/components/WorkItemProperties/index.tsx`         | 42     | with fallback `bg-[var(--cm-editor-background,var(--color-bg-1))]`                             | Property-card outer surface                                                             | **fix (variant)** — see "Two-tone variant" |
| 6   | `src/modules/ProjectManager/shared/components/PropertiesPanel/PropertiesRailFrame.tsx` | 57, 67 | with fallback `bg-[var(--cm-editor-background,var(--color-bg-1))]` (2 occurrences in one file) | Properties rail outer + inner surface in comfort layout                                 | **fix (variant)** — see "Two-tone variant" |

### Two-tone variant — fallback form

3 of the 6 sites (#4 #5 #6, all in non-CodeMirror routes like Project Manager's Properties panel and the floating status bar) deliberately write the form with a fallback:

```tsx
bg-[var(--cm-editor-background,var(--color-bg-1))]
```

Reason: these surfaces render in routes where the `--cm-editor-background` variable may not be defined on `:root` (it's injected by CodeMirror theme bootstrap, see `src/features/CodeMirror/config/themeConfig.ts:46,61`). They want to degrade to `--color-bg-1`. This is **legitimate** — the existing `EDITOR_TAB_CANVAS_BG_CLASS` does NOT include the fallback and would render transparent on those routes.

**Decision:** introduce a second sibling token next to `EDITOR_TAB_CANVAS_BG_CLASS`:

```ts
/** Same as EDITOR_TAB_CANVAS_BG_CLASS but degrades to bg-1 outside CodeMirror routes. */
export const EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS =
  "bg-[var(--cm-editor-background,var(--color-bg-1))]";
```

Then #4 #5 #6 consume this. The bare `EDITOR_TAB_CANVAS_BG_CLASS` is fine for #1 #2 #3 (all inside CodeMirror-aware surfaces).

## Findings — non-className occurrences (keep, do not touch)

These came up in the `--cm-editor-background` grep but are NOT D2 hits — they're either token definitions, bridge layer, or inline styles for libraries that own the variable.

| File                                                                                             | Lines     | Why keep                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/CodeMirror/themes/github.ts`                                                       | 22        | CodeMirror theme bridge — defines the variable for the editor's own theme                                                                                                          |
| `src/features/CodeMirror/config/themeConfig.ts`                                                  | 46, 61    | CodeMirror theme bootstrap — `style.setProperty('--cm-editor-background', ...)` on `:root`                                                                                         |
| `src/config/workstation/tokens.ts`                                                               | 12-13     | The token definition itself                                                                                                                                                        |
| `src/util/ui/terminal/themes.ts`                                                                 | 5         | xterm theme adapter                                                                                                                                                                |
| `src/components/TerminalInteractive/utils/theme.ts`                                              | 5, 18, 23 | xterm theme adapter                                                                                                                                                                |
| `src/hooks/settings/useEditorAppearance.ts`                                                      | 13        | Settings-driven theme apply hook                                                                                                                                                   |
| `src/modules/WorkStation/CodeEditor/Panels/EditorBottomPanel/tabs/TerminalTab.tsx`               | 143       | inline `style={{ background: "var(--cm-editor-background)" }}` on a terminal host element — terminal/CodeMirror bridge, `style={{}}` is the correct form for runtime theme handoff |
| `src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/TerminalMainContent/index.tsx` | 153       | same as above                                                                                                                                                                      |
| `src/engines/TerminalCore/index.tsx`                                                             | 250       | same as above                                                                                                                                                                      |

## Sibling tokens — do they need the same mapping?

Sweep of `--cm-editor-(foreground|gutter|selection|cursor|line-highlight)`:

| Variable                     | Where read                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cm-editor-gutter`         | `src/features/CodeMirror/config/minimap.ts:189`, `src/features/CodeMirror/config/themeConfig.ts:61`, `src/features/CodeMirror/themes/github.ts:26,27` — **all bridge layer, no className users.** |
| `--cm-editor-foreground`     | `src/features/CodeMirror/themes/github.ts:23` only — **bridge only.**                                                                                                                             |
| `--cm-editor-selection`      | `src/features/CodeMirror/themes/github.ts:24,25` only — **bridge only.**                                                                                                                          |
| `--cm-editor-line-highlight` | `src/features/CodeMirror/themes/github.ts:28` only — **bridge only.**                                                                                                                             |

**Conclusion:** the D2 problem is **specific to `--cm-editor-background`**. No need to introduce a class for the other four — they live entirely inside the CodeMirror bridge layer.

## Recommended fix (deferred to next PR)

### Step 1 — extend `src/config/workstation/tokens.ts`

```ts
// existing (line 12-13)
/** Orgii Editor tab canvas — matches CodeMirror (--cm-editor-background on :root). */
export const EDITOR_TAB_CANVAS_BG_CLASS = "bg-[var(--cm-editor-background)]";

// NEW — for surfaces that may render outside CodeMirror-bootstrapped routes
/** Same as EDITOR_TAB_CANVAS_BG_CLASS but degrades to bg-1 when the var is undefined. */
export const EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS =
  "bg-[var(--cm-editor-background,var(--color-bg-1))]";
```

### Step 2 — codemod table (6 sites)

| File                           | Line | Before (inside className)                            | After                                                         |
| ------------------------------ | ---- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `DiffFileSection/index.tsx`    | 275  | `bg-[var(--cm-editor-background)]`                   | `${EDITOR_TAB_CANVAS_BG_CLASS}` (template) or import + concat |
| `PanelHeader/index.tsx`        | 293  | `bg-[var(--cm-editor-background)]`                   | `EDITOR_TAB_CANVAS_BG_CLASS`                                  |
| `SubagentPromptToggle.tsx`     | 130  | `bg-[var(--cm-editor-background)]`                   | `EDITOR_TAB_CANVAS_BG_CLASS`                                  |
| `StatusBarRenderer.tsx`        | 29   | `bg-[var(--cm-editor-background,var(--color-bg-1))]` | `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS`                         |
| `WorkItemProperties/index.tsx` | 42   | `bg-[var(--cm-editor-background,var(--color-bg-1))]` | `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS`                         |
| `PropertiesRailFrame.tsx`      | 57   | `bg-[var(--cm-editor-background,var(--color-bg-1))]` | `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS`                         |
| `PropertiesRailFrame.tsx`      | 67   | `bg-[var(--cm-editor-background,var(--color-bg-1))]` | `EDITOR_TAB_CANVAS_BG_FALLBACK_CLASS`                         |

Each site already uses `classNames(...)` or a template literal — drop the literal string and concatenate the constant.

### Step 3 — verification

```bash
# Should return only the token definitions and bridge layer, NOT any className site
rg 'bg-\[var\(--cm-editor-background' --type tsx --type ts src/
```

After fix, the only hits should be the two `export const` lines in `tokens.ts`.

## Why this is better than the original `tailwind.config.js` proposal

The pilot's R4 suggested adding a `cm-editor` color in `tailwind.config.js` so the class becomes `bg-cm-editor`. That would also work, but:

1. **An abstraction already exists** (`EDITOR_TAB_CANVAS_BG_CLASS`); adding a second mechanism (Tailwind class) creates two-ways-to-spell-the-same-thing instead of consolidating.
2. **The fallback variant cannot be expressed as a single Tailwind class** without losing the fallback semantics — you'd need a separate `bg-cm-editor-fallback` class anyway, so you're back to two tokens.
3. The constant approach keeps the diff scoped to one config file and the 6 consumers. The Tailwind approach requires `tailwind.config.js` + 6 consumers + a JIT regeneration check.

If a future requirement needs the value in CSS-only contexts (e.g. SCSS modules), THEN promote to Tailwind. For now, the constant covers all 6 sites cleanly.

## Not in scope

- Modifying any of the 6 listed source files (Phase 2-A is reporting only).
- Modifying `tailwind.config.js`.
- Touching the bridge-layer files (CodeMirror themes, terminal adapters).
- The other `text-[Npx]` D3 question (see `D3-typography-scale-sweep.md`).
