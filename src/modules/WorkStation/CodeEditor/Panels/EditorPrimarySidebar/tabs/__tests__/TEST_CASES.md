# Test Cases: SourceControlScopeToolbar

## Preconditions

- Workstation Code Editor is open on a **single-root** git repository (multi-root hides the picker)
- Repository has at least one **linked git worktree** (non-main checkout under `.orgii/worktrees` or similar)
- Source Control tab is active; filter mode is **not** History / PR / Issues
- Tauri app has been rebuilt after backend `merge-base` diff changes (restart required for accurate stats)

## Happy Path

| #   | Steps                                        | Expected Result                                                                                                                                            |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open Source Control on a repo with worktrees | Header shows breadcrumb `ORGII > {branch}` and a chevron dropdown trigger                                                                                  |
| 2   | Click the scope trigger                      | Dropdown opens with **Main checkout** section (repo name + branch) and **Worktrees** section                                                               |
| 3   | Select a worktree row                        | Breadcrumb shows `{branch}` when folder matches branch, else `{worktree-folder} > {branch}` (no repo segment); sidebar lists that worktree's changed files |
| 4   | Select **Main checkout** again               | Breadcrumb returns to `ORGII > {main-branch}`; sidebar shows host repo changes                                                                             |
| 5   | Switch to another editor tab and back        | Previously selected scope **persists** (not reset to main)                                                                                                 |
| 6   | Hover diff stats on dropdown row             | Tooltip shows working-tree breakdown (e.g. `Working tree +8 -3`); each dropdown row shows compact +/- badge when uncommitted diffs exist                   |
| 7   | Remove a worktree via trash icon (hover row) | Confirm dialog → worktree removed from disk; if it was active scope, falls back to main                                                                    |
| 8   | Inspect row layout (no hover)                | Rows align flush to the right edge — no empty gutter reserved for delete; diff stats and checkmark sit at trailing edge                                    |
| 9   | Hover worktree row with diff stats           | Trash icon overlays the trailing stats/check area without shifting label or row width                                                                      |

## Edge Cases

| #   | Scenario                     | Steps                                                    | Expected Result                                                                                                  |
| --- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Empty state / no delete slot | Open dropdown; view main checkout row                    | Main row has no delete affordance and no right-side gutter                                                       |
| 2   | No uncommitted changes       | Worktree with clean working tree, no branch-only commits | Row shows no +/- badge; row still selectable; filter trigger reads `0 uncommitted` (not `0 uncommitted changes`) |
| 3   | Large diff counts            | Worktree with thousands of line changes                  | Badge shows compact form (`6.2K`, `1.5M`); full numbers in tooltip                                               |
| 4   | Many worktrees (≥ 5)         | Open dropdown                                            | Search field **Filter worktrees…** appears; typing filters by folder name or branch                              |
| 5   | Search focus keeps dropdown  | Click into search field (≥ 5 worktrees)                  | Dropdown stays open; input receives focus and accepts typing                                                     |
| 6   | Search no match              | Type a string matching nothing                           | Empty state: **No results**                                                                                      |
| 7   | Worktree list loading        | Reload app with persisted worktree scope                 | Loading placeholder in sidebar until list resolves; toolbar breadcrumb matches persisted scope                   |
| 8   | Removed worktree in storage  | Delete worktree on disk externally, reopen app           | Scope reconciles to **main checkout**                                                                            |
| 9   | Same branch on main          | Only one checkout (no linked worktrees)                  | Scope picker **hidden**; plain Source Control only                                                               |
| 10  | Multi-root workspace         | Open workspace with 2+ repo folders                      | Scope picker **hidden** (known limitation)                                                                       |
| 11  | History / PR / Issues filter | Switch header filter away from file changes              | Scope picker **hidden** for that mode                                                                            |

## Error / Degraded States

| #   | Scenario              | Steps                                           | Expected Result                                                                         |
| --- | --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Worktrees API failure | Simulate git-api error (offline / invalid repo) | Last-known worktree list retained; warning logged; picker may hide if never loaded      |
| 2   | Stale diff stats      | Edit files in worktree without refresh          | File list updates via WebSocket; picker badges refresh after debounced worktree refetch |

## Accessibility

- [ ] Scope trigger has `aria-label` including current repo and branch
- [ ] Selected row exposes `aria-current="true"`
- [ ] Search input has `aria-label` when ≥ 5 worktrees
- [ ] Remove worktree button has `aria-label` and is keyboard focusable on row hover/focus
- [ ] Dropdown keyboard navigation works (Tab, Enter, Escape)

## Acceptance Criteria

- [ ] Picker switches Source Control sidebar content between main checkout and selected worktree
- [ ] Diff badge on each dropdown row reflects **uncommitted** line counts; tooltip includes working-tree breakdown
- [ ] Committed stats use merge-base (not branch-tip comparison); no inflated million-line deletions after app restart
- [ ] Filter header counts (uncommitted / staged / unstaged) match **active scope** file list
- [ ] Scope persists across tab navigation within the same repo session
- [ ] Dropdown scrolls when worktree list exceeds panel height
- [ ] Dropdown rows do not reserve permanent right-side space for delete; trash overlays trailing content on hover only
- [ ] Unit tests pass: `sourceControlScopePickerHelpers.test.ts` (32 tests)
