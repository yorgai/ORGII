# Test Cases: Source Control re-render stability (Issue #16)

Covers RC-1 (stable `handleDiffSidebarFileSelect`) and the pure selection
resolver it now delegates to (`resolveGitDiffSelection`).

## Preconditions

- A repo is open in the WorkStation Code Editor.
- The Source Control sidebar tab is mounted (warm/keep-alive).

## Happy Path

| #   | Steps                                                                   | Expected Result                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In Source Control "all changes" view, click a changed file              | Diff opens in focus target; `resolveGitDiffSelection` returns `isAllChangesView: true`, correct absolute + relative paths                                                        |
| 2   | In Source Control focus/non-all-changes view, click a file              | Falls through to `handleGitFileSelect` (unified focus tab)                                                                                                                       |
| 3   | Navigate between editor tabs repeatedly while Source Control stays warm | The warm Source Control tree does NOT re-render; `SidebarSlot` context identity stays stable because `handleDiffSidebarFileSelect` identity is stable across `activeTab` changes |

## Edge Cases

| #   | Scenario                  | Steps                                                    | Expected Result                                                                                |
| --- | ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Worktree file             | Click a file whose `repoRoot` differs from host repoPath | `effectiveRepoPath` = file's `repoRoot`; absolute path built under the worktree                |
| 2   | Already-absolute path     | File path begins with `/` and host repo prefix           | `absolutePath` unchanged, `relativePath` stripped of repo prefix                               |
| 3   | Null/undefined active tab | Resolve with no active tab                               | `isAllChangesView` is `false` (routes to focus select)                                         |
| 4   | Rapid navigation          | Switch tabs many times quickly                           | Callback identity unchanged each render (refs hold latest `activeTab` / `handleGitFileSelect`) |

## Error / Degraded States

| #   | Scenario                | Steps                            | Expected Result                                |
| --- | ----------------------- | -------------------------------- | ---------------------------------------------- |
| 1   | Diff content load fails | `loadGitFileDiffContent` rejects | Error logged; no crash; focus target still set |

## Accessibility

- [x] No change to keyboard/focus behavior (pure perf/identity refactor).

## Acceptance Criteria

- [x] `resolveGitDiffSelection` unit-tested (absolute/relative/worktree/all-changes/null tab).
- [x] `handleDiffSidebarFileSelect` no longer lists `activeTab` in its `useCallback` deps; reads it via `activeTabRef`.
- [x] `handleGitFileSelect` (unstable — closes over per-render `gitDiffState`) read via `handleGitFileSelectRef`.
- [x] `gitDiffState.setFile` destructured (stable) instead of depending on the whole `gitDiffState` object.
- [x] No new TypeScript / lint errors in touched files.

## Notes

- Identity-stability across renders is a React-runtime property; per the repo's
  UI-feature workflow (no `.tsx` / testing-library tests) it is verified by
  construction (deps reduced to stable values) plus the pure-resolver unit tests,
  and manually via React DevTools "highlight updates" while navigating.
