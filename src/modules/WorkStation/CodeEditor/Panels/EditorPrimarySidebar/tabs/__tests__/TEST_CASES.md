# Test Cases: SourceControlScopeToolbar & Scope Switch Loading

## Preconditions

- Workstation Code Editor is open on a **single-root** git repository (multi-root hides the picker)
- Repository has at least one **linked git worktree** (non-main checkout under `.orgii/worktrees` or similar)
- Source Control tab is active; filter mode is **not** History / PR / Issues
- Tauri app has been rebuilt after backend `merge-base` diff changes (restart required for accurate stats)
- Each scoped worktree has distinguishable uncommitted changes so stale file flashes are obvious during scope switches

## Happy Path

| #   | Steps                                        | Expected Result                                                                                                                                                                                             |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open Source Control on a repo with worktrees | Header shows breadcrumb `{branch}` only and a chevron dropdown trigger; hover title shows full repo path and branch                                                                                         |
| 2   | Click the scope trigger                      | Dropdown opens with **Main checkout** section (branch name only, same as worktree rows) and **Worktrees** section                                                                                           |
| 3   | Select a worktree row                        | Breadcrumb shows `{branch}` only (no redundant folder prefix); **one** loading state with readable label (`Loading changes…`) appears immediately in the changes area; previous scope files are not visible |
| 4   | Wait for git status to finish                | Loading dismisses; selected worktree's changed files appear                                                                                                                                                 |
| 5   | Select **Main checkout** again               | Loading appears immediately; breadcrumb shows `{main-branch}` only; sidebar shows host repo changes                                                                                                         |
| 6   | Switch to another editor tab and back        | Previously selected scope **persists** (not reset to main)                                                                                                                                                  |
| 7   | Hover diff stats on dropdown row             | Tooltip shows working-tree breakdown (e.g. `Working tree +8 -3`); each dropdown row shows compact +/- badge when uncommitted diffs exist                                                                    |
| 8   | Remove a worktree via trash icon (hover row) | Confirm dialog → worktree removed from disk; if it was active scope, falls back to main                                                                                                                     |
| 9   | Inspect row layout (no hover)                | Rows align flush to the right edge — no empty gutter reserved for delete; diff stats sit at trailing edge; selected row uses highlight only (no checkmark)                                                  |
| 10  | Hover worktree row with diff stats           | Trash icon overlays the trailing stats area without shifting label or row width                                                                                                                             |

## Edge Cases

| #   | Scenario                     | Steps                                                    | Expected Result                                                                                                                                           |
| --- | ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Empty state / no delete slot | Open dropdown; view main checkout row                    | Main row has no delete affordance and no right-side gutter                                                                                                |
| 2   | No uncommitted changes       | Worktree with clean working tree, no branch-only commits | Row shows no +/- badge; row still selectable; filter trigger reads `0 uncommitted` (not `0 uncommitted changes`)                                          |
| 3   | Large diff counts            | Worktree with thousands of line changes                  | Badge shows compact form (`6.2K`, `1.5M`); full numbers in tooltip                                                                                        |
| 4   | Many worktrees (≥ 5)         | Open dropdown                                            | Search field **Filter worktrees…** appears; typing filters by folder name or branch                                                                       |
| 5   | Search focus keeps dropdown  | Click into search field (≥ 5 worktrees)                  | Dropdown stays open; input receives focus and accepts typing                                                                                              |
| 6   | Search no match              | Type a string matching nothing                           | Empty state: **No results**                                                                                                                               |
| 7   | Worktree list loading        | Reload app with persisted worktree scope                 | Loading placeholder in sidebar until list resolves; toolbar breadcrumb matches persisted scope                                                            |
| 8   | Removed worktree in storage  | Delete worktree on disk externally, reopen app           | Scope reconciles to **main checkout**                                                                                                                     |
| 9   | Same branch on main          | Only one checkout (no linked worktrees)                  | Scope picker **hidden**; plain Source Control only                                                                                                        |
| 10  | Multi-root workspace         | Open workspace with 2+ repo folders                      | Scope picker **hidden** (known limitation)                                                                                                                |
| 11  | History / PR / Issues filter | Switch header filter away from file changes              | Scope picker **hidden** for that mode                                                                                                                     |
| 12  | Rapid scope switching        | Click three different scopes quickly                     | Single loading state stays visible during transitions; no stacked duplicate spinners; final scope matches last selection without stale intermediate files |
| 13  | Empty worktree scope         | Select a worktree with no changes                        | Loading dismisses to empty changes state (not previous scope files)                                                                                       |
| 14  | Filter mode unchanged        | Switch scope while on Staged filter                      | Loading overlay still appears; staged filter applies to new scope after load                                                                              |

## Error / Degraded States

| #   | Scenario                 | Steps                                           | Expected Result                                                                           |
| --- | ------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Worktrees API failure    | Simulate git-api error (offline / invalid repo) | Last-known worktree list retained; warning logged; picker may hide if never loaded        |
| 2   | Stale diff stats         | Edit files in worktree without refresh          | File list updates via WebSocket; picker badges refresh after debounced worktree refetch   |
| 3   | Git status fetch failure | Simulate offline / failed status for a worktree | Loading dismisses; error placeholder from SourceControlContent is shown (not stale files) |

## Accessibility

- [ ] Scope trigger has `aria-label` including current repo and branch
- [ ] Selected row exposes `aria-current="true"`
- [ ] Search input has `aria-label` when ≥ 5 worktrees
- [ ] Remove worktree button has `aria-label` and is keyboard focusable on row hover/focus
- [ ] Dropdown keyboard navigation works (Tab, Enter, Escape)
- [ ] Scope picker remains keyboard-navigable during loading
- [ ] Loading placeholder uses sidebar placement with readable title
- [ ] Scope switch shows **one** loading indicator (spinner + label), not two stacked bare spinners
- [ ] Focus is not trapped incorrectly by the loading overlay

## Acceptance Criteria

- [ ] Picker switches Source Control sidebar content between main checkout and selected worktree
- [ ] Selecting a new scope shows a single labeled loading state in the changes/file list area on the same interaction (no stale flash, no duplicate spinners)
- [ ] Previous scope files are cleared from the sidebar and scoped diff state during transition
- [ ] Loading dismisses when the new scope's git status fetch completes
- [ ] Scope toolbar breadcrumb shows branch name only (no repo or worktree folder prefix); full path available via trigger title/tooltip
- [ ] Diff badge on each dropdown row reflects **uncommitted** line counts; tooltip includes working-tree breakdown
- [ ] Committed stats use merge-base (not branch-tip comparison); no inflated million-line deletions after app restart
- [ ] Filter header counts (uncommitted / staged / unstaged) match **active scope** file list
- [ ] Scope persists across tab navigation within the same repo session
- [ ] Dropdown scrolls when worktree list exceeds panel height
- [ ] Dropdown rows do not reserve permanent right-side space for delete; trash overlays trailing content on hover only
- [ ] Unit tests pass: `sourceControlScopePickerHelpers.test.ts`, `sourceControlScopeSwitchHelpers.test.ts`
