# Test Cases: SourceControlScopeToolbar

## Preconditions

- Workstation Code Editor is open on a **single-root** git repository (multi-root hides the picker)
- Repository has at least one **linked git worktree** (non-main checkout under `.orgii/worktrees` or similar)
- Source Control tab is active; filter mode is **not** History / PR / Issues
- Tauri app has been rebuilt after backend `merge-base` diff changes (restart required for accurate stats)

## Happy Path

| #   | Steps                                        | Expected Result                                                                                                 |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Open Source Control on a repo with worktrees | Header shows breadcrumb `ORGII > {branch}` and a chevron dropdown trigger                                       |
| 2   | Click the scope trigger                      | Dropdown opens with **Main checkout** section (repo name + branch) and **Worktrees** section                    |
| 3   | Select a worktree row                        | Breadcrumb becomes `{worktree-folder} > ORGII > {worktree-branch}`; sidebar lists that worktree's changed files |
| 4   | Select **Main checkout** again               | Breadcrumb returns to `ORGII > {main-branch}`; sidebar shows host repo changes                                  |
| 5   | Switch to another editor tab and back        | Previously selected scope **persists** (not reset to main)                                                      |
| 6   | Hover diff stats on a row                    | Tooltip shows working-tree and committed breakdown (e.g. `Working tree +8 -3 · since main +12 -1`)              |
| 7   | Remove a worktree via trash icon (hover row) | Confirm dialog → worktree removed from disk; if it was active scope, falls back to main                         |

## Edge Cases

| #   | Scenario                     | Steps                                                    | Expected Result                                                                                |
| --- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | No uncommitted changes       | Worktree with clean working tree, no branch-only commits | Row shows no +/- badge; row still selectable                                                   |
| 2   | Large diff counts            | Worktree with thousands of line changes                  | Badge shows compact form (`6.2K`, `1.5M`); full numbers in tooltip                             |
| 3   | Many worktrees (≥ 5)         | Open dropdown                                            | Search field **Filter worktrees…** appears; typing filters by folder name or branch            |
| 4   | Search no match              | Type a string matching nothing                           | Empty state: **No results**                                                                    |
| 5   | Worktree list loading        | Reload app with persisted worktree scope                 | Loading placeholder in sidebar until list resolves; toolbar breadcrumb matches persisted scope |
| 6   | Removed worktree in storage  | Delete worktree on disk externally, reopen app           | Scope reconciles to **main checkout**                                                          |
| 7   | Same branch on main          | Only one checkout (no linked worktrees)                  | Scope picker **hidden**; plain Source Control only                                             |
| 8   | Multi-root workspace         | Open workspace with 2+ repo folders                      | Scope picker **hidden** (known limitation)                                                     |
| 9   | History / PR / Issues filter | Switch header filter away from file changes              | Scope picker **hidden** for that mode                                                          |

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
- [ ] Diff badge reflects **uncommitted** line counts; tooltip includes committed delta since merge-base
- [ ] Committed stats use merge-base (not branch-tip comparison); no inflated million-line deletions after app restart
- [ ] Filter header counts (uncommitted / staged / unstaged) match **active scope** file list
- [ ] Scope persists across tab navigation within the same repo session
- [ ] Dropdown scrolls when worktree list exceeds panel height
- [ ] Unit tests pass: `sourceControlScopePickerHelpers.test.ts` (24 tests)
