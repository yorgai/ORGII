# Test Cases: Spotlight branch switching via guarded checkout (Issue #17)

Routes Spotlight branch operations through the canonical guarded checkout
(`useRepoSelection().selectBranch` → `useBranchCheckout.selectBranch`) so a dirty
working tree surfaces the `CheckoutConflictDialog` (stash / discard / cancel).

> Pure logic covered by Vitest: the `uncommitted_changes` classifier for the
> `checkout` operation lives in
> `src/util/dialogs/__tests__/gitErrorDialogHelpers.test.ts`. The handler
> orchestration below is integration-level (modal + git API) and is verified
> manually / by the agent harness — the repo's UI-feature workflow forbids
> `.tsx` / testing-library tests.

## Preconditions

- A git repo is selected in Spotlight; the Branch palette is open.

## Happy Path

| #   | Steps                                        | Expected Result                                                                                                                            |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Clean tree → pick an existing branch         | `selectBranch` checks out with no dialog; Spotlight closes AFTER checkout resolves                                                         |
| 2   | Clean tree → type a new name → create branch | `gitCreateBranch({ checkout: false })`, then `selectBranch(name)` performs the guarded checkout; "created" toast shown; modal closes after |
| 3   | Clean tree → "Checkout detached..."          | `selectBranch("HEAD")` runs the guarded checkout; detached-HEAD success toast shown; modal closes after                                    |

## Edge Cases

| #   | Scenario                                       | Steps                                                                                                                                       | Expected Result |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Dirty tree → pick branch                       | Checkout returns `uncommitted_changes` → `CheckoutConflictDialog` appears (stash/discard/cancel) BEFORE the modal closes (no teardown race) |
| 2   | Dirty tree → conflict dialog → Cancel          | No checkout performed; branch state rolled back; modal still closes (await-before-close)                                                    |
| 3   | Dirty tree → conflict dialog → Stash           | Changes stashed, branch checked out, success toast                                                                                          |
| 4   | Dirty tree → conflict dialog → Discard (force) | Force checkout, success toast                                                                                                               |
| 5   | Dirty tree → create-and-checkout               | Branch created (not checked out), then guarded `selectBranch` raises the conflict dialog on the dirty tree                                  |
| 6   | Dirty tree → checkout detached                 | `selectBranch("HEAD")` raises the conflict dialog instead of bypassing it                                                                   |

## Error / Degraded States

| #   | Scenario                                                                                | Steps                           | Expected Result                                                                             |
| --- | --------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | No repo selected                                                                        | Invoke any handler              | "No repo selected" error toast; no git call                                                 |
| 2   | Create branch fails                                                                     | `gitCreateBranch` returns false | "Failed to create branch" error toast; no checkout attempted                                |
| 3   | Backend returns errorType "unknown" but message says "would be overwritten by checkout" | checkout op                     | `inferErrorTypeFromText` classifies `uncommitted_changes` (so the conflict dialog can fire) |

## Accessibility

- [x] No change to keyboard/focus model of the palette.

## Acceptance Criteria

- [x] Step 1: create-and-checkout uses `checkout: false` then `selectBranch`.
- [x] Step 2: detached-HEAD routes through `selectBranch("HEAD")` (raw `gitCheckout` removed); success copy kept.
- [x] Step 3: all three handlers `await selectBranch(...)` BEFORE `closeModal()`.
- [x] Step 4: `gitErrorDialog` classifier detects `uncommitted_changes` for `checkout` (minimal fix; full ActionSystem reroute left as TODO).
- [ ] Step 5 (OUT OF SCOPE): "commit changes" conflict option NOT added — existing flow is stash/discard/cancel only.

## Notes / Follow-ups

- The ActionSystem path (`gitBranchActions.zod.ts` → `branchOps.checkoutWithDialog`)
  still uses its own dialog. Only the minimal classifier fix was applied; a full
  reroute onto `selectBranch` would need to preserve the action's
  `{ success, message, errorType }` result contract and is left as a TODO.
