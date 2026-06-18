# Test Cases: Agent Station plan editing — Save decoupled from Build (issue #28)

Covers issue #28 plus the three follow-up bugs:

1. Edit a pending plan directly in Agent Station (Communication preview).
2. "Open in My Station" action (ArrowUpRight) opening the plan file.
3. Hide unrelated actions (Skip) while editing; show only Cancel + Save.
4. **Save persists edits WITHOUT approving/executing** (Build is the only
   approve+execute action). — fixed bug
5. **The Agent Station preview plan is actually editable** (the Edit button +
   editable textarea now appear for a "Ready for review" plan). — fixed bug
6. **Edits survive re-view**: after Save, re-opening the preview / chat card /
   the file via "Open in My Station" shows the edited content. — fixed bug

Touched: `Communication/index.tsx` (Save → `handleSave`),
`Communication/usePlanApproval.ts` (`handleSave`; `isPlanPending` no longer
gated on `currentSurfaceVisible`), `ChatPanel/blocks/CreatePlanCard/index.tsx`
(Save → save-only `handleSave`), new shared
`SessionCore/derived/planContentPersistence.ts` (file + event-store + snapshot
persistence), i18n `planDoc.saveFailed`.

### Persistence model (design (a) — true persistence, no new backend command)

Save reuses existing APIs to write the edit to every source the plan is later
read from:

- **Plan file** at `planPath` via `FileService.save` → read by the backend
  Build turn (`respondPlanApproval` `approve` reads the file) and by "Open in
  My Station".
- **Plan `SessionEvent`(s)** via `eventStoreProxy.updateById` (args
  `content`/`streamContent`) → the source the in-app preview + chat card render.
- **`pendingPlanApprovalsAtom`** snapshot `planContent` → snapshot-derived reads and
  **immediate cross-surface display** via `resolvePlanMarkdownContent` (chat
  transcript may lag the event store; the snapshot is updated synchronously on
  Save).

Build stays `approve` / `approve_with_edits` (the only approve+execute path).
Known limitation: a full app restart _before_ Build re-broadcasts the backend
snapshot, so the in-app preview would show the pre-edit content again — but the
**file** still holds the edit (Build + Open in My Station stay correct). Closing
that last gap needs a backend "update pending plan content" command (see Notes).

## Preconditions

- An agent session has produced a plan that is **pending approval**.
- Agent Station mode is active; the Communication app is open.

## Happy Path

| #   | Steps                                                     | Expected Result                                                                                                                                                               |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open Communication while a plan is pending.               | Preview auto-opens; trailing row shows Source/Preview pill + **Edit** + **Open in My Station** (ArrowUpRight).                                                                |
| 2   | Click **Edit**.                                           | View switches to preview; plan renders as an editable textarea (`plan-doc-editor`); trailing row now shows **only Cancel + Save** (pill, Edit, Open in My Station hidden).    |
| 3   | Modify the text, click **Save**.                          | Edits persist (plan file + plan event + snapshot); edit mode exits back to Edit + Open in My Station; the preview now shows the **edited** content. **No build/turn starts.** |
| 4   | After Save, re-open the preview (or switch tab and back). | The edited content is still shown (re-view reflects the edit).                                                                                                                |
| 5   | After Save, click **Open in My Station**.                 | The plan `.md` opens in My Station Code dock showing the **edited** content.                                                                                                  |
| 6   | After Save, Build the plan (chat card **Build**).         | Backend reads the saved plan file and executes the **edited** plan.                                                                                                           |
| 7   | Enter edit, click **Cancel**.                             | Edit discarded; textarea reverts to preview; trailing row returns to Edit + Open in My Station.                                                                               |

## Chat panel CreatePlanCard

| #   | Steps                                                                        | Expected Result                                                                                                     |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 8   | Pending plan card shows footer: **Skip · Edit · Build**.                     | All three visible when not editing.                                                                                 |
| 9   | Click **Edit** on the card.                                                  | Footer shows **only Cancel + Save**; Skip and the standalone Build are hidden.                                      |
| 10  | Edit text, click **Save**.                                                   | Edits persisted; footer returns to **Skip · Edit · Build**; card preview shows edited content. **No build starts.** |
| 11  | Click **Build** (non-edit).                                                  | Approves + builds the persisted plan (`approve`, backend reads the saved file).                                     |
| 12  | Click **Cancel**.                                                            | Reverts to Skip · Edit · Build, edits discarded.                                                                    |
| 13  | Save from Agent Station preview, glance at chat CreatePlanCard (no refresh). | Chat card preview shows the **same edited** markdown immediately.                                                   |
| 14  | Save from chat CreatePlanCard, glance at Agent Station preview (no refresh). | Preview shows the **same edited** markdown immediately.                                                             |

## Cross-surface sync

| #   | Steps                                                                        | Expected Result                                                                         |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Edit + Save from Agent Station Communication preview.                        | Chat panel CreatePlanCard (transcript or current surface) updates without page refresh. |
| 2   | Edit + Save from chat CreatePlanCard.                                        | Agent Station preview updates without page refresh.                                     |
| 3   | After either Save, both surfaces show identical markdown including the edit. | Left/right stay in sync until Build clears the pending approval.                        |

## Edge Cases

| #   | Scenario                                   | Steps                                             | Expected Result                                                                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No plan path resolved                      | Pending plan whose `planPath` is empty.           | "Open in My Station" hidden; Save still patches the plan event + snapshot (no file write); editing still works.                    |
| 2   | Save with no edits                         | Enter edit, change nothing, Save.                 | Persists identical content; exits edit; no build.                                                                                  |
| 3   | Session busy / not pending                 | Plan no longer pending or session running.        | Save/Edit disabled (`buildDisabled`).                                                                                              |
| 4   | Edit from a non-preview tab                | On Interactions/Messages tab, click Edit.         | View is forced to preview so the textarea is actually shown.                                                                       |
| 5   | "Ready for review" but not current-surface | Freshly pending plan with no user reply after it. | Edit button + editable textarea STILL appear (`isPlanPending` = matches pending approval, independent of `currentSurfaceVisible`). |

## Accessibility

- [ ] Edit / Cancel / Save / Open buttons are keyboard-focusable with visible labels + icons.
- [ ] Textarea autofocuses on entering edit mode.

## Acceptance Criteria

- [ ] Save persists edits and exits edit mode WITHOUT approving/executing.
- [ ] Build (chat `create-plan-build`) is the only approve+execute action and uses the edited content.
- [ ] The Agent Station "Ready for review" plan is editable (Edit reveals textarea).
- [ ] Edits are visible on re-view (preview, chat card, Open in My Station file).
- [ ] "Open in My Station" uses ArrowUpRight and opens the plan file via `openFileInWorkStation`.
- [ ] While editing (both surfaces), only Cancel + Save show; Skip/Build/pill hidden.
- [ ] No regression to the non-editing approve/skip flow.
- [ ] No new TypeScript errors; no new lint warnings.

## Unit coverage

- `SessionCore/derived/__tests__/planContentPersistence.test.ts` covers the pure
  helpers (`applyEditedContentToPlanArgs`, `buildPlanContentPatches`,
  `updatePendingPlanContent`, `resolvePlanMarkdownContent`) and the injected-IO
  orchestrator
  (`persistEditedPlanContent`: file→event→cache order, no-path skip, no-match
  short-circuit, cache-failure tolerance).

## Notes / Manual QA required

- The Save/Build wiring and `PlanDocPanel.editState` rendering must be verified
  in-app; the pending-plan flow cannot be fully exercised headlessly.
- To make the in-app preview survive a cold app restart before Build, add a
  production backend command (e.g. `agent_update_pending_plan_content`) that
  writes the file + re-runs `mark_ready` so the DB snapshot row, the rebroadcast
  `plan_ready_for_approval` event, and the pending atom all carry the edit.
