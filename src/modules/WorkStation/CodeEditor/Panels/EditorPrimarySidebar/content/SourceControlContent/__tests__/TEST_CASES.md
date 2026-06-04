# Test Cases: WorkstationPrSection

## Preconditions

- Workstation Code Editor is open with a git repository selected
- User is signed in with GitHub credentials when creating PRs
- Source Control sidebar tab is visible

## Happy Path

| #   | Steps                                                      | Expected Result                                                |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Check out a feature branch, commit, publish/push to origin | PR section shows neutral hint or ready state with branch name  |
| 2   | Click **Create PR** when branch is pushed and clean        | Loading state appears, then PR link with Open status           |
| 3   | Click PR link                                              | Opens GitHub PR in external browser                            |
| 4   | Switch away and back to same branch                        | Existing PR link is restored from GitHub lookup or local cache |

## Edge Cases

| #   | Scenario              | Steps                                                | Expected Result                                    |
| --- | --------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| 1   | Default branch        | Stay on `main` with clean tree                       | PR section shows neutral hint; no Create PR button |
| 2   | Unpushed commits      | Commit locally without pushing                       | No Create PR button; neutral/pending hint          |
| 3   | Uncommitted changes   | Modify files on feature branch                       | No auto-create; no ready state                     |
| 4   | Protected branch push | Push to protected default branch                     | Protected branch dialog offers Create Pull Request |
| 5   | Auto-create enabled   | Enable `git.autoCreatePr`, push clean feature branch | PR is created automatically without button click   |
| 6   | Not authenticated     | Sign out, click Create PR                            | Error alert with retry                             |
| 7   | No origin remote      | Remove origin remote, click Create PR                | Error alert explaining missing origin              |

## Error / Degraded States

| #   | Scenario           | Steps                                      | Expected Result               |
| --- | ------------------ | ------------------------------------------ | ----------------------------- |
| 1   | GitHub API failure | Simulate network/API error during create   | Error alert with retry action |
| 2   | PR lookup failure  | GitHub lookup fails but local cache exists | Cached PR link still shown    |

## Accessibility

- [ ] Create PR button is keyboard activatable
- [ ] PR link has discernible text (repo/path)
- [ ] Error alert retry action is keyboard accessible

## Acceptance Criteria

- [ ] PR section appears below commit/sync controls in Source Control sidebar
- [ ] Create PR pushes branch then opens GitHub PR via local Tauri command
- [ ] Protected branch push surfaces PR creation path
- [ ] `git.autoCreatePr` setting controls automatic PR creation
- [ ] Work item PR flow still works via shared `createPullRequest` helper
