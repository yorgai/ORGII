# InlineExternalImport — Test Cases

Test file: `inlineExternalImportUtils.test.ts`
Source: `../inlineExternalImportUtils.ts`

---

## `inlineExternalImportRowKey`

Generates a stable, unique string key for a detected external-import row.
Used as `getRowKey` in `<SettingsTable>` to prevent duplicate renders when
the same artifact appears in multiple scopes.

| #   | Description                                          | Input                                                                                                                                        | Expected                                                                        |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | All four fields joined with `:`                      | sourceAgent=`claude_code`, sourcePath=`/home/user/.claude/CLAUDE.md`, suggestedName=`global-rules`, targetRepoPath=`/home/user/projects/foo` | `claude_code:/home/user/.claude/CLAUDE.md:global-rules:/home/user/projects/foo` |
| 2   | Null `targetRepoPath` serialised as `"global"`       | targetRepoPath=`null`                                                                                                                        | key ends with `:global`                                                         |
| 3   | Same artifact, different scopes → distinct keys      | same base, targetRepoPath=`null` vs `/home/user/myrepo`                                                                                      | two distinct strings                                                            |
| 4   | Same path, different `suggestedName` → distinct keys | suggestedName=`docs` vs `docs-copy`                                                                                                          | two distinct strings                                                            |
| 5   | Deterministic — same input always same output        | fixed row object                                                                                                                             | two calls return equal strings                                                  |

---

## `resolveHasImportable`

Selects the importable-items array to inspect based on the chosen strategy,
then returns `true` if at least one item is present.

Controls whether the "all already imported" banner shows vs. the import table
and the import button:

- `"all"` strategy → used by MCP, Rules, and Skills (show banner only when
  every detected artifact has been imported, ignoring the current search filter)
- `"filtered"` strategy → used by Agents (show banner whenever the current
  filtered list is empty, even if unfiltered items still exist)

### Strategy `"all"` (checks `allImportableItems`)

| #   | Description                                                                | allImportableItems | importableItems | Expected |
| --- | -------------------------------------------------------------------------- | ------------------ | --------------- | -------- |
| 1   | Non-empty `allImportableItems` → `true`                                    | `[1,2,3]`          | `[]`            | `true`   |
| 2   | Empty `allImportableItems` → `false` even when `importableItems` non-empty | `[]`               | `[1,2,3]`       | `false`  |
| 3   | Both empty → `false`                                                       | `[]`               | `[]`            | `false`  |

### Strategy `"filtered"` (checks `importableItems`)

| #   | Description                                                                | allImportableItems | importableItems | Expected |
| --- | -------------------------------------------------------------------------- | ------------------ | --------------- | -------- |
| 4   | Non-empty `importableItems` → `true`                                       | `[]`               | `[1,2,3]`       | `true`   |
| 5   | Empty `importableItems` → `false` even when `allImportableItems` non-empty | `[1,2,3]`          | `[]`            | `false`  |
| 6   | Both empty → `false`                                                       | `[]`               | `[]`            | `false`  |
