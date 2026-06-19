# ChatPanel architecture audit

> Read-only architecture audit. No production code changed. Branch `ORGII-dev`.

## 0. Executive summary

ChatPanel is not only the left/right chat sidebar. It is a multi-surface frontend engine centered in `src/engines/ChatPanel/`:

- the docked ChatPanel shell and header,
- the live session chat surface,
- several non-session mode views under `panels/`,
- session creation / start-page flows,
- reusable `ChatView` embeds in WorkStation and project/task detail surfaces,
- tool/result rendering blocks used by chat history.

The highest-risk file is `src/engines/ChatPanel/ChatView.tsx` (843 LOC in this audit). It intentionally coordinates several sensitive responsibilities: session pipeline claiming, workspace/file-review sync, message queue visibility, group chat overlays, plan approval surfaces, Git diff affordances, ChatHistory, and the floating composer. Treat it as an orchestration seam, not a simple view component.

Recommended posture:

- Do **not** mechanically split `ChatView` around queue, streaming, group chat, or composer dispatch without tests.
- Keep `panels/` inside ChatPanel unless a domain owner is created; today they are ChatPanel mode surfaces, not misplaced generic pages.
- Low-risk work is documentation, naming tables, and pure local extraction of derived view models.
- High-risk work is any change to active-session claiming, queue flush/send paths, `readOnly`/`secondary` behavior, file review sync, or group chat session routing.

## 1. User-visible architecture map

```
App shell / route layout
  └─ ChatPanel (`src/engines/ChatPanel/index.tsx`)
      ├─ ChatPanelHeader
      │   ├─ header actions: search, reload, export/link/share, display toggles
      │   └─ surface header publisher for selected non-session surfaces
      └─ ChatPanelContent
          ├─ BenchmarkPanel
          ├─ WorkItemPanelView
          ├─ ProjectPanelView
          ├─ ProjectOrgPanelView
          ├─ WorkspaceDashboardPanelView
          ├─ WorkspaceExplorePanelView
          ├─ CollabOrgPanelView
          ├─ WorkspaceOverviewPanelView
          ├─ ChatView (live session)
          └─ ChatPanelEmptyContent / SessionCreator start flows

ChatView
  ├─ ChatSessionContext.Provider
  ├─ ChatHistoryOverrideContext.Provider
  ├─ GroupChatProvider + AgentEventsTap overlays
  ├─ ChatHistory
  │   ├─ ActivityRouter / renderers
  │   ├─ chat item pipeline
  │   ├─ blocks/* tool/result cards
  │   └─ group chat rendering
  └─ ChatFloatingComposer
      └─ InputArea
          ├─ AskQuestionCard / PermissionCard / ModeSwitchCard
          ├─ queue controls
          ├─ Git diff actions
          ├─ Agent Org controls
          └─ ComposerBar shared UI
```

## 2. Directory responsibility table

| Path                                                                   | Responsibility                                                                           | Notes                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/engines/ChatPanel/index.tsx`                                      | ChatPanel shell: width, header, content state wiring, start-page actions, modal surfaces | Large orchestrator; not just visual chrome.                                                            |
| `ChatPanelContent.tsx`                                                 | Content-mode renderer                                                                    | Priority chain between non-session panels and `ChatView`.                                              |
| `hooks/useChatPanelContentState.tsx`                                   | Derived booleans for content/header visibility and titles                                | Main fallback/precedence resolver for ChatPanel surfaces.                                              |
| `ChatView.tsx`                                                         | Session chat orchestration                                                               | Coordinates state sync, history, composer, queue, group chat, plan approval.                           |
| `ChatHistory/`                                                         | Message/event rendering surface                                                          | Includes activity router, group chat, turn files context, pipeline/renderers.                          |
| `InputArea/`                                                           | Composer and input-side controls                                                         | Owns question/permission/mode-switch cards, queue edit mode, Git diff affordances, Agent Org controls. |
| `blocks/`                                                              | Tool call/result and rich message blocks                                                 | Includes `ToolCallBlock`, `CreatePlanCard`, shell/read/list/search/setup/subagent/canvas blocks.       |
| `panels/`                                                              | ChatPanel non-session mode views                                                         | These are real ChatPanel surface implementations; do not treat them as stray files.                    |
| `header/`                                                              | Header primitives and surface header publishing                                          | Bridges selected surface header state to header UI.                                                    |
| `components/`                                                          | Smaller ChatPanel-only widgets                                                           | Includes status/banner-style UI used by ChatPanel.                                                     |
| `events/`, `rendering/`, `adapters/`, `navigation/`, `ThreadSelector/` | Supporting seams for event/render/navigation/thread behavior                             | Audit individually before moving; names imply framework seams.                                         |
| `src/features/SessionCreator/variants/ChatPanel/`                      | SessionCreator variant that feeds ChatPanel create flows                                 | Creation state is adjacent to ChatPanel but not the same as a live session.                            |

## 3. Surface-to-code-to-state map

| User-visible surface                     | Primary module                                        | State sources                                                                                 | Canonical vs mirror                                                                                      |
| ---------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chat panel width / visibility            | `ChatPanel/index.tsx`, `chatPanelAtom.ts`             | `chatWidthAtom`, `stationChatVisibilityAtom`, CSS var `--orgii-chat-width`                    | `chatWidthAtom` is canonical for panel width; CSS var mirrors for immediate layout.                      |
| Header title/actions                     | `ChatPanelHeader.tsx`, `useChatPanelContentState.tsx` | `contentState`, selected surface atoms, `eventCountAtom`, `collapseAllCommandAtom`            | Header derives from selected surface and current session; it should not own surface identity.            |
| Live session chat                        | `ChatPanelContent.tsx` → `ChatView.tsx`               | `currentSessionId` from `usePanelTitle`, `activeSessionIdAtom`, SessionCore atoms             | `currentSessionId` selects content; `activeSessionIdAtom` is the streaming pipeline claim.               |
| Non-session project/workspace/org panels | `panels/*PanelView.tsx`                               | `chatPanelSelected*Atom`, dashboard/explore booleans                                          | Selection atoms are canonical UI state; render booleans are derived.                                     |
| Empty/start/create surface               | `ChatPanelEmptyContent.tsx`, SessionCreator variant   | `chatPanelStartPageOpenAtom`, `chatPanelCreateTargetAtom`, `sessionCreatorStateAtom`          | Create target is ChatPanel UI state; session creation details live in SessionCreator state.              |
| Chat history messages                    | `ChatHistory/`                                        | `ChatSessionContext`, `chatEventsAtom`, optional `ChatHistoryOverrideContext`                 | Normal history uses current chat session; group chat override is an explicit alternate feed.             |
| Floating composer                        | `ChatFloatingComposer.tsx`, `InputArea/`              | `inputAreaSessionId`, queue atoms, question/permission/mode-switch state, plan approval state | Composer is driven by ChatView-provided view model; queue atoms are canonical for queued messages.       |
| Tool/result cards                        | `blocks/`                                             | Session events/tool result payloads                                                           | Event payloads are canonical; card parsers are display adapters.                                         |
| Group chat                               | `useAgentOrgGroupChatController`, `GroupChatView/`    | Agent Org run view, `groupChatViewSessionIdAtom`, member sessions, `activeSessionIdAtom`      | Group chat state intentionally overlays normal session history.                                          |
| Read-only embedded chat tab              | `ChatView readOnly` callers                           | passed `sessionId`, `readOnly` prop                                                           | Read-only surfaces must not claim pipeline or run workspace sync.                                        |
| Secondary inspect chat                   | `ChatView secondary` callers                          | passed `sessionId`, `secondary` prop, `activeSessionIdAtom`                                   | Secondary claims pipeline while mounted, but must release it on unmount and not rewrite workspace state. |

## 4. ChatPanel content precedence

Two parallel but related resolvers exist:

1. `useChatPanelContentState` returns render/header booleans.
2. `activeChatPanelSurfaceAtom` returns a discriminated surface state.

They currently encode the same broad precedence:

1. benchmark session group,
2. work item,
3. project,
4. project org,
5. workspace dashboard,
6. workspace explore,
7. collab org,
8. workspace overview,
9. explicit create/non-session targets,
10. session fallback.

Relevant code:

- `src/engines/ChatPanel/hooks/useChatPanelContentState.tsx:94` starts the render precedence chain.
- `src/store/ui/chatPanelAtom.ts:572` starts `activeChatPanelSurfaceAtom`.
- `src/engines/ChatPanel/ChatPanelContent.tsx:106` renders the actual branch chain.

Risk: this is a three-place parity contract. Adding a new ChatPanel surface must update all three or the header, surface publisher, and rendered content can disagree.

Recommended invariant for future changes:

- A new surface must add a `CHAT_PANEL_SURFACE_KIND` variant.
- `chatPanelNavigateAtom` must reset sibling state and set exactly one target.
- `activeChatPanelSurfaceAtom`, `useChatPanelContentState`, and `ChatPanelContent` must preserve the same priority position.
- Header publishing should be added deliberately, not by inheriting a fallback.

## 5. ChatView entry-point matrix

| Entry point                  | Caller                                    | Props       | Pipeline behavior                                                   | Workspace/file-review behavior                                    | Intended use                                                       |
| ---------------------------- | ----------------------------------------- | ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Primary ChatPanel session    | `ChatPanelContent.tsx:139`                | default     | claims `activeSessionIdAtom`                                        | `useFileReviewSync(sessionId, true)` and workspace sync when live | Main live chat in docked panel.                                    |
| WorkItem floating chat       | `panels/WorkItemPanelView.tsx:387`        | `secondary` | claims pipeline while mounted, releases on unmount if still current | file review/workspace sync disabled by `secondary` gates          | Inspect or interact with another session inside a work-item panel. |
| ProjectManager embedded chat | `ProjectManagerContentRouter.tsx:507`     | `secondary` | same secondary behavior                                             | same secondary gates                                              | Inspect session in project-manager context.                        |
| WorkStation chat tab         | `TabContent/renderers/chatSession.tsx:30` | `readOnly`  | does not claim pipeline                                             | no file review/workspace sync; no composer                        | Passive chat artifact in WorkStation.                              |
| CodeEditor tab renderer      | `TabContentRenderer/index.tsx:613`        | `readOnly`  | same read-only behavior                                             | same read-only gates                                              | Passive chat artifact in editor tab.                               |

Important `ChatView` rules confirmed from current code:

- `readOnly` returns early before setting `activeSessionIdAtom`.
- `secondary` claims `activeSessionIdAtom`, but the cleanup clears it only if it still points at that same session.
- `useFileReviewSync(sessionId, !readOnly && !secondary)` makes file-review sync primary-only.
- `useSessionWorkspaceSync` additionally excludes read-only, secondary, Cursor IDE/imported/remote history, and non-live historical sessions.

## 6. ChatView internal responsibility split

`ChatView.tsx` currently holds these responsibility zones:

| Zone                          | Lines / signal                                      | Responsibility                                                           | Risk level     |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| Session pipeline claiming     | mount effect near `ChatView.tsx:229`                | Writes/release `activeSessionIdAtom` depending on `readOnly`/`secondary` | 🔴 high        |
| Historical/source file impact | `impactFileChanges`, `getOrgtrackSessionSummary`    | Initial file-change display for Cursor/imported history                  | 🟡 medium      |
| Workspace sync gate           | `useSessionWorkspaceSync` around `ChatView.tsx:301` | Primary live session workspace synchronization                           | 🔴 high        |
| Plan approval surface         | `derivePlanApprovalViewState`                       | Current plan card visibility in composer                                 | 🟠 high-medium |
| Agent Org group chat          | run view + `useAgentOrgGroupChatController`         | Merged member events, member selection, pause/resume                     | 🔴 high        |
| Message queue projection      | queue atoms and `handleSendNow`                     | Shows and manipulates queued messages; dispatch is elsewhere             | 🔴 high        |
| Git diff affordances          | `useGitDiffActions`, `openAgentStationDiff`         | Opens WorkStation Diff and PR/commit actions                             | 🟠 high-medium |
| Composer section view model   | `useComposerSections`                               | Collapsible inline sections for queue/process/files/cards                | 🟡 medium      |
| History/context wiring        | `ChatSessionContext`, overrides, providers          | Selects normal vs group history feed                                     | 🔴 high        |
| Remote shared viewer input    | remote read-only banner/message send                | Guest viewer messaging                                                   | 🟡 medium      |
| Floating composer props       | `ChatFloatingComposer` prop assembly                | Large prop fan-out into input surface                                    | 🟠 high-medium |

This file is a candidate for view-model extraction, but only after tests cover entry-point parity. The safe extraction boundary is pure derivation, not side-effect hooks.

## 7. Term overloading table

| Term          | Usages                                 | Meanings                                                                              | Recommendation                                                                                                      |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `contentMode` | `CHAT_PANEL_CONTENT_MODE`              | Coarse ChatPanel slot mode: session / non-session / benchmark session group           | Keep, but do not use as the only surface identity.                                                                  |
| `surfaceKind` | `CHAT_PANEL_SURFACE_KIND`              | Discriminated concrete ChatPanel surface                                              | Prefer this for navigation/audit discussions.                                                                       |
| `viewMode`    | `useRouteViewMode()`                   | Route/workstation display mode such as `workStation`                                  | Do not confuse with content mode.                                                                                   |
| `displayMode` | `ChatHistoryDisplayMode`               | ChatHistory density: full / compact                                                   | Rename only if doing a focused UI terminology pass.                                                                 |
| `readOnly`    | `ChatView` prop                        | Passive ChatView; no pipeline claim, no composer                                      | High-signal prop; keep behavior stable.                                                                             |
| `secondary`   | `ChatView` prop                        | Interactive inspect surface; claims pipeline but does not persist workspace ownership | Name is accurate only if documented in callers.                                                                     |
| `sessionId`   | many                                   | Sometimes content session, sometimes pipeline session, sometimes queue session        | When touching ChatView, distinguish `sessionId`, `chatHistorySessionId`, `inputAreaSessionId`, `pipelineSessionId`. |
| `panel`       | ChatPanel, panel views, project panels | Can mean docked shell or non-session surface                                          | Prefer `surface` for concrete mode identity.                                                                        |
| `active`      | ChatPanel prop / session runtime atoms | Can mean visible panel or running session                                             | Avoid adding new `active` booleans without a noun suffix.                                                           |

## 8. Architecture-audit 10-layer findings

| Layer                      | Finding                                                                                            | Evidence / notes                                                                                                   | Severity |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| 1. Compilation correctness | This audit is doc-only; TypeScript baseline is known noisy.                                        | Use targeted diagnostics for changed TS in future; no TS changed here.                                             | 🟢       |
| 2. Dead code / duplication | The major duplication risk is surface precedence in three places, not unused code.                 | `useChatPanelContentState`, `activeChatPanelSurfaceAtom`, `ChatPanelContent`.                                      | 🟡       |
| 3. Naming consistency      | Several near-synonyms are valid but easy to confuse.                                               | `contentMode`, `surfaceKind`, `viewMode`, `displayMode`.                                                           | 🟡       |
| 4. Semantic overloading    | `sessionId` has multiple roles inside `ChatView`.                                                  | `chatHistorySessionId`, `inputAreaSessionId`, `pipelineSessionId` already make the split visible.                  | 🟠       |
| 5. Default branch analysis | Session fallback is intentional but can hide missing new-surface wiring.                           | `activeChatPanelSurfaceAtom` returns session at `chatPanelAtom.ts:644`; `ChatPanelContent` falls to empty content. | 🟡       |
| 6. Cross-domain leakage    | `ChatView` imports WorkStation simulator/diff atoms and Agent Org hooks.                           | This is intentional orchestration, but it makes ChatView a cross-domain seam.                                      | 🟠       |
| 7. New-developer confusion | `panels/` can look misplaced unless documented as ChatPanel mode surfaces.                         | Current directory shape is valid after prior cleanup.                                                              | 🟢       |
| 8. Wire / serialization    | Frontend card parsers adapt tool result payloads; no real payload dump done in this doc-only pass. | Future changes to `ToolCallBlock/helpers/cardParsers.ts` should test real result shapes.                           | 🟡       |
| 9. Init parity             | `ChatView` entry points intentionally differ by `readOnly`/`secondary`.                            | Matrix in §5 documents parity and exceptions.                                                                      | 🟠       |
| 10. Resolver symmetry      | Content/header surface resolution should remain symmetric.                                         | `useChatPanelContentState` and `activeChatPanelSurfaceAtom` are the key fallback chains.                           | 🟡       |

## 9. Risk-ranked cleanup opportunities

### 🟢 Low risk: documentation / guardrails

1. Keep this document up to date when adding a ChatPanel surface.
2. Add a short local comment near `activeChatPanelSurfaceAtom` or `useChatPanelContentState` that the precedence must stay aligned with `ChatPanelContent`.
3. Document each `ChatView` caller with why it uses default / `secondary` / `readOnly`.

Verification: docs review, `pnpm exec prettier --check <doc>` if markdown formatting is enforced.

### 🟡 Medium-low risk: pure view-model extraction

Candidate extractions from `ChatView` that should not change behavior:

- file impact derivation (`impactFileChanges`, `sourceImpactFileChanges`, `summaryImpactFileChanges`),
- composer file reload key derivation,
- plan surface state derivation wrapper,
- Git diff action view model assembly,
- queue display filtering and reorder index mapping.

Rules:

- Extract only pure derivation or tightly scoped hooks with identical dependency arrays.
- Keep side effects in place until tests cover all entry points.
- Do not change queue dispatch ownership.

Verification: targeted ESLint/TS diagnostics on touched files, plus relevant ChatPanel/queue tests.

### 🟠 Medium-high risk: surface state unification

There is a likely future improvement: make `activeChatPanelSurfaceAtom` the canonical concrete surface and derive more of `useChatPanelContentState` from it.

Do not do this casually because it touches:

- navigation command semantics,
- header visibility,
- start/create surfaces,
- non-session panel rendering,
- selected project/work item/workspace state.

A safe phase would first add parity tests for the current precedence chain, then replace one consumer at a time.

### 🔴 High risk: do not mechanically migrate

Avoid broad refactors in these paths without end-to-end coverage:

- `activeSessionIdAtom` claiming/release logic,
- queue send/force-send/reorder/edit path,
- group chat member/coordinator session routing,
- `ChatSessionContext` vs pipeline session selection,
- file review sync and workspace sync gates,
- composer dispatch and stop/send controls,
- WorkStation Diff opening from ChatPanel.

These paths cross SessionCore, WorkStation, Agent Org, and queue lifecycle; a visual-only refactor can become a runtime bug.

## 10. Suggested verification matrix for future code changes

| Change type                | Minimum verification                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Docs only                  | Read generated doc; optionally markdown prettier/check if configured.                                                           |
| ChatPanel shell/header     | `pnpm exec eslint src/engines/ChatPanel/index.tsx src/engines/ChatPanel/ChatPanelHeader.tsx` and manual route smoke test.       |
| Content surface precedence | Add/adjust unit coverage for `activeChatPanelSurfaceAtom` or a small derived-state test; smoke non-session + session surfaces.  |
| ChatView pure extraction   | ESLint on touched files; TypeScript path-filter against touched files; smoke default + readOnly + secondary caller if possible. |
| Queue/composer changes     | Queue-specific tests and manual Stop → Send Now → queued follow-up smoke; do not rely on visual rendering only.                 |
| Group chat changes         | Existing Agent Org group chat e2e/support flows; assert rendered group chat and member session routing.                         |
| Tool card parser changes   | `ToolCallBlock` helper tests, plus representative real result payload fixture.                                                  |

## 11. Current action items

1. Use this document as the first-stop map for ChatPanel architecture questions.
2. If a concrete refactor is desired, start with one 🟡 pure extraction from `ChatView`, not queue/group-chat/session pipeline code.
3. Before adding a new ChatPanel surface, add a small parity test or checklist covering: navigate atom, active surface atom, content state hook, renderer branch, header publishing.
