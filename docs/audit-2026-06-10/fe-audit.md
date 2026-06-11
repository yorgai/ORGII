# 前端架构审计 — 2026-06-10

**范围**：`src/`、`types/`（含 `tests/` 仅作覆盖参考）
**约束**：read-only；不跑全 `tsc --noEmit`（按 `workspace_tsc_noemit_preexisting_noise.md`）
**方法**：架构-audit skill 10 层 + 反模式 #1–#54 sweep
**入口追溯起点**：`src/index.tsx`、`src/App.tsx`、`src/router/`、`src/windows/`

---

## Executive summary

> Top 5（按严重度）：
>
> 1. **`engines/ChatPanel/` 边界泄漏** — 根目录 6 个 misplaced PanelView + 跨 engine import（`ChatPanel` 内 import 自 `modules/MainApp/AgentOrgs/store`）— 层 6 漏洞。
> 2. **多 dispatch 路径 + UI 直接调 transport** — `useWorkspaceChat.ts` 一个 hook 内 8 处调 `dispatchMessageBySessionType`；`useAgentControlPalette.ts:115` 与 `AgentErrorChatItem.tsx:114` 完全绕过 FSM。
> 3. **多 concern atom 仍存活** — `userInitiatedCancelAtom` 承担"signal user Stop"+"trigger draft restore"；`holdSessionQueueForStopAtom` 与 FSM `stopping` shadow 并存。
> 4. **TEMP DIAG 残留 5 文件 25 行** — 含 `imperativeApi.ts` 的 `console.trace`（每次 setContent / clear 触发）。
> 5. **3 套 OPEN bug 仍带活的诊断日志在跑** — ModePill draft wipe、Workstation 右侧白边、SessionReplay 文件查看器空白。

---

## 层 1 — 编译正确性

未跑全 tsc（基准 ~240s）。Spot-check LSP 主要文件。所有审计修改对象仅作 read。

- **路径过滤命令模板**：`pnpm exec tsc --noEmit 2>&1 | grep -E "(FileA|FileB)" | head -40`

---

## 层 2 — 死代码 / 重复

**入口追溯**：`src/index.tsx` → `App.tsx` → `router/`、`scaffold/`、`engines/`、`modules/`、`features/`。

### Finding F-MED-2：`engines/ChatPanel/` 根目录 6 个 misplaced PanelView

- **位置**：`engines/ChatPanel/ProjectPanelView.tsx`、`WorkItemPanelView.tsx`、`WorkspaceDashboardPanelView.tsx`、`WorkspaceExplorePanelView.tsx`、`WorkspaceOverviewPanelView.tsx`、`BenchmarkRunBuilder.tsx`、`LinkSessionToWorkItemModal.tsx`、`useBenchmarkSessionCreatorSlots.tsx`
- **问题**：memory `workspace_chatpanel_engine_panel_view_bloat.md` 已记录，至今未清理。`ChatPanelContent.tsx` 仍 import 5 个；StickyNotes 已删除（memory 部分 stale）。
- **修复**：移到 `features/` 或 `modules/`；零行为修改。
- **Sweep**：grep 全 ChatPanel 内 `*PanelView.tsx`，6 处全部在根，深层模块无错位。

### Finding：`engines/ChatPanel/index.tsx:18` 从 `modules/MainApp/AgentOrgs/store` import

- **位置**：`src/engines/ChatPanel/index.tsx:18`
- **问题**：engine 层不应反向依赖 modules 层（层 6 cross-domain leakage）。
- **修复**：把所需 atom 提到 `store/`。
- **Sweep status**：已 grep `from "@src/modules` 在 `engines/`，2 处。

### Finding：`MessageReferenceCards.tsx:62` 跨 engine import Simulator types

- **位置**：`src/engines/ChatPanel/blocks/MessageReferenceCards.tsx:62`
- **问题**：Harry's in-flight file（memory `workspace_message_reference_cards_drift.md` 已记录）。
- **Sweep**：需 vitest 跑确认是否 still drift（3 个 test 中 2 fail）。

### 死代码候选（与 `workspace_dead_code_scan_landscape.md` 一致）

- `localStorage.ts`、`apiTracker.ts`、`gitBundle.ts`、`deferredInit.ts`、多个 `*ActionDialog`。
- `AskUserChatItem/` 整目录可删（memory `workspace_askquestion_streaming_returns_null.md` 记 `ChatItems/AskUserChatItem/` 已 dead）。

---

## 层 3 — 命名一致性

- `SecondaryPanelHeader → PanelTabBar` rename 完成。
- `getTerminalPillTexts` 仍叫 terminal，但已被复用到多种 pill — 命名不再精确。
- `terminal-pill-click` 事件名在非 terminal 场景被复用。

---

## 层 4 — 语义重载（FE 视角）

| 词        | Usage 1                                      | Usage 2                                      | Usage 3                                           | 判定                 |
| --------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------- | -------------------- |
| `session` | `activeSessionIdAtom`（pipeline 订阅）       | `workstationActiveSessionIdAtom`（UI 记忆）  | `sessionCreatorDraftListAtom`（pre-launch 草稿）  | 3 概念 1 词          |
| `agent`   | `api/tauri/agent/`（Rust IPC）               | `modules/MainApp/AgentOrgs/`（多 agent org） | `osagent/useBrowserAutomation`（OS browser 驱动） | 重载严重             |
| `tab`     | `WorkStation/shared/TabBar`（#1）            | `EditorBottomPanel/tabs/`（#3）              | `SessionReplay/ReplayTabBar`（#5）                | 共 8 套 tab 系统     |
| `pill`    | `ModePill`（agent exec mode）                | `SidebarTabButton`（segmented control）      | `ComposerPill`（@ context）                       | 3 独立 UI primitive  |
| `block`   | `engines/ChatPanel/blocks/`（chat content）  | "turn-blocking event"（sync 层）             | `collapseStateAtom`（每 block 折叠）              | 大致 OK              |
| `mode`    | `agentExecMode`                              | `stationMode`                                | `chatPanelContentModeAtom`                        | 3 个独立状态机       |
| `panel`   | `PermissionCard/`（左边缘 card）             | `*PanelView.tsx`（workspace overview）       | `PanelTabBar/`（panel chrome）                    | "PanelView" 名字误导 |
| `creator` | `features/SessionCreator/`（启动新 session） | `creatorDraftAtom`（保存的 draft）           | `creatorStateAtom`（当前选择）                    | 同概念               |

---

## 层 5 — 默认分支

- StationMode 三元链 `mode === "agent-station" ? … : mode === "my-station" ? … : null` 多处，新 mode 会静默掉到 `null` — 反模式 #1。
- AgentExecMode ternary 在 `useSessionExecModeField` 内：✅ 已用 `ALL_AGENT_EXEC_MODES` 防御。
- `cliSessionStatusAtom.ts:225-230` `status === "running" || "installing" || "waiting_for_user" || "waiting_for_funds"` — 新 status 不会被识别为 active；但当前所有 FE-only status（queued/in_progress）都不在这个分支里，可能是 by design。

---

## 层 6 — 跨域泄漏

| 出现地                                                           | 泄漏内容                                      | 风险                      |
| ---------------------------------------------------------------- | --------------------------------------------- | ------------------------- |
| `engines/ChatPanel/index.tsx:18`                                 | import from `modules/MainApp/AgentOrgs/store` | engine → modules 反向依赖 |
| `engines/ChatPanel/blocks/MessageReferenceCards.tsx:62`          | import Simulator types                        | engine ↔ engine 横向耦合  |
| `engines/ChatPanel/` 根 6 个 misplaced                           | feature 层文件错放 engine 层                  | 见 F-MED-2                |
| `engines/SessionCore/rendering/registry/initToolRegistry.ts:311` | `as any` 跨 engine cast                       | 反模式 #15                |

---

## 层 7 — 新开发者困惑

- `ChatPanel` vs `ChatHistory` vs `ChatView` vs `ChatItems` — 4 个相邻命名，承担不同职责。
- `engines/ChatPanel/InputArea/PermissionCard/` vs `engines/ChatPanel/InputArea/AskQuestionCard/` vs `engines/ChatPanel/InputArea/ModeSwitchCard/` — 3 个 "Card" 都是 input bar 顶部的 inline card；统一命名 `InputBarOverlayCard` 更直白。
- `useWorkspaceChat` 的名字暗示 workspace 关联，但实际是统一的 chat hook（多 session category）。

---

## 层 8 — Wire 协议（FE 侧）

| 项目                                         | 状态                                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| 23 处 `invokeTauri("name", …)` 裸 command 名 | ⚠️ 未类型化（rpc layer 仅覆盖部分）                     |
| zod RPC layer `src/api/tauri/rpc/`           | ✅ 用 zod 验证 shape，但未约束 value（status 字面量等） |
| Status enum FE 单源                          | ❌ 5 处 FE 重复定义（见 cross-layer 报告）              |

---

## 层 9 — Init parity（FE 入口）

| 入口                              | 路径                                                                   | 备注                                 |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| SessionCreator → `session_launch` | `useSessionLaunch/launchPayload.ts`                                    | 生产路径，含 7 字段对齐              |
| WorkStation new tab               | mount empty session → 首条消息触发 `session_launch`                    | OK                                   |
| Resume from `.jsonl`              | `cli_agent_resume`                                                     | 缺 `ensure_cli_account_key_fresh` ⚠️ |
| E2E helper                        | `cli_agent_create` 直调                                                | 子集字段，by design                  |
| Spotlight AgentControl            | `useAgentControlPalette.ts:115` 直 `invokeTauri("agent_send_message")` | **绕过 FSM** ❌                      |
| AgentErrorChatItem resume         | `SessionService.sendMessage` 直调                                      | **绕过 FSM** ❌                      |

---

## 层 10 — Resolver 对称

| 字段           | FE 链                                     | BE 链                                             | 对称？          |
| -------------- | ----------------------------------------- | ------------------------------------------------- | --------------- |
| model          | `advancedConfig.model → none`             | `params.model → AgentDef default → none`          | FE 缺 default   |
| account_id     | `advancedConfig.selectedAccountId → none` | `params.account_id → cli resume table → previous` | OK              |
| workspace_path | `effectiveSource.repoPath → none`         | `params.workspace_path → unwrap_or_default("")`   | ⚠️ BE 默认 `""` |
| agent_org_id   | `selectedAgentOrgId`                      | RUST 保留；**CLI 丢**                             | ❌ F-HIGH-1     |
| key_source     | `resolvedKeys.keySource`                  | `params.key_source → reject unknown`              | OK              |

---

## Sweep 表（全 FE 代码库）

| Pattern                                 | Hits                                                                    | 主要文件                                                                                                                                                                                                 | 判定                                       |
| --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `dispatchMessage`、`sendMessage` 调用点 | ~16                                                                     | `useWorkspaceChat.ts`（8 处）、`useMessageDispatch.ts`、`SessionService.ts`、`useQueueDispatch.ts`、`useModeSwitchActions.ts`、`InputActions.tsx`、`AgentErrorChatItem.tsx`、`useAgentControlPalette.ts` | **反模式 #21 / #53**，F-HIGH-11 / F-CRIT-1 |
| `runtimeStatus`、`isRunning` 写入点     | ~70                                                                     | 多 source；`setSessionRuntimeStatusAtom` 的 source 字段含 10 种                                                                                                                                          | ⚠️ F-MED-1                                 |
| 多 concern atom 名                      | `userInitiatedCancelAtom`                                               | `cliSessionStatusAtom.ts:174-175`                                                                                                                                                                        | ❌ F-HIGH-2                                |
| TODO / FIXME / HACK / LEGACY            | 30                                                                      | 散布                                                                                                                                                                                                     | 多数为意图标记                             |
| 跨模块重复 type                         | `SessionInfo`（store + service）、`AgentMessage`、`ChatItem*`（多版本） | 见 [naming-collisions.md](./naming-collisions.md)                                                                                                                                                        | ⚠️                                         |
| `localStorage.*Item` 裸键               | 7                                                                       | `themeInit`、`timezone`、`serviceAuth oauthRedirect_*`、`SetupWalkthrough`、`AuthCallback`、`headers.ts`、`AppearanceState`                                                                              | ⚠️ 部分 OK                                 |
| `@ts-ignore`、`@ts-expect-error`        | 3                                                                       | `eventPayload.ts:63,259,355`                                                                                                                                                                             | ✅ 局部                                    |
| `as any` / `as unknown as`              | ~80                                                                     | hotspot：`HoverAnimatedIcon.tsx`（7）、`BrowserCore/index.tsx`（4）、`RulesMemoryEvolution/useAutomationRules.ts`（3）、e2e helpers 大量                                                                 | ⚠️ 生产 src/ 30+                           |
| `console.log` 生产                      | 3                                                                       | `CanvasPreview`（DevTools）、`ModePill`（TEMP DIAG）、`useEmbeddedWebview:84`（真实泄漏）                                                                                                                | ⚠️ 1 处真实                                |
| TEMP DIAG                               | 25 行 / 5 文件                                                          | `ComposerInput/imperativeApi.ts:106-120` (`console.trace`！)、`useInputArea/index.ts`（5 处）、`AppLayout.tsx`（`[ws-blank-diag]`）、`ModePill.tsx`、`resolveFilePayload.ts`（3 处）                     | ❌ F-CRIT-8                                |
| `dangerouslySetInnerHTML`               | 13                                                                      | LLM 输出路径含 `BlockOutput`、`a2uiElements`、`MermaidBlock`、`GitHubDiff/DiffRow`；外部文档含 `DocxPreview`、`PagesPreview`                                                                             | ⚠️ F-MED-6                                 |
| 重复 status 字面量定义                  | 5 处                                                                    | `types/session/session.ts`、`ProjectManager/WorkItems/constants.ts`、`TaskKanban/config.ts`、`AgentOrgOverviewPanel.tsx`、`AgentOrgTaskList.tsx`                                                         | ❌ F-MED-4                                 |
| `setTimeout` / `setInterval` 未清理     | ~80 hit                                                                 | hotspot：`cliAdapter.ts`（5）、`api/realtime/websocket/client.ts`（4）；多数有 cleanup                                                                                                                   | ⚠️ sampled                                 |
| 大文件 ≥ 700 行                         | 12 处                                                                   | `cliAdapter.ts` 1000、`ChatHistory/index.tsx` 909、`MessageReferenceCards.tsx` 710                                                                                                                       | ⚠️ F-MED-7                                 |

---

## Memory file 校验（FE 视角）

| Memory                                            | 校验结果                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `workspace_chatpanel_engine_panel_view_bloat.md`  | **部分 stale**：StickyNotes 已删；6 个 misplaced 仍在                                                                                                                                                                                                                       |
| `workspace_tab_systems_inventory.md`              | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_force_send_queue_dispatch.md`          | ❌ **全 stale**：`showQueuedMessageOptimistically`、`forceSendPendingQueueAtom`、`isQueueRuntimeStillWorking`、`hasTurnBlockingRunningEventForSession`、`markQueueTurnSettled` 全部不存在；`useQueueDispatch.ts` 已经基于 `turnLifecycle.ts` FSM 重写 — **必须重写 memory** |
| `workspace_composer_bar_shared.md`                | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_chat_input_surfaces_matrix.md`         | ⚠️ **部分 stale**：EditorArea max-height 已从 `(isChatPanel ? 140 : 300)` 改回 `(isChatPanelFullScreen ? 200 : 300)` — 需更新 memory                                                                                                                                        |
| `workspace_subagent_ui_visibility_regex.md`       | ❌ **DRIFT**：regex `(?:agentsession                                                                                                                                                                                                                                        | subagent)-`不匹配 Rust 当前`SUBAGENT_SESSION_PREFIX = "agent-"`与`SHADOW_SESSION_PREFIX = "shadow-"` — F-CRIT-5 |
| `workspace_terminalblock_loading_shimmer_weak.md` | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_askquestion_streaming_returns_null.md` | ✅ ACCURATE                                                                                                                                                                                                                                                                 |
| `workspace_mode_switch_clears_draft.md`           | OPEN — `[draft-bug]` 8 处 trace 仍在                                                                                                                                                                                                                                        |
| `workspace_workstation_toggle_right_blank.md`     | OPEN — `[ws-blank-diag]` 仍在                                                                                                                                                                                                                                               |
| `workspace_sessionreplay_file_blank.md`           | OPEN — `[file-blank]` 仍在                                                                                                                                                                                                                                                  |
| `workspace_message_reference_cards_drift.md`      | ⚠️ 部分 stale，需 vitest 跑确认                                                                                                                                                                                                                                             |
| `workspace_default_pinned_actions_gap.md`         | ❌ **STALE**：DEFAULT_PINNED 已不再 pin skill 形式的 setup-repo，含 `migrate()` 清理 — 已被 cross-layer 确认                                                                                                                                                                |

完整 memory 校验见 [memory-verification.md](./memory-verification.md)。
