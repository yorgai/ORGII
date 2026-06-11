# Findings 详细 — 2026-06-10

按严重度分组：Critical → High → Medium → Low / Info。
每个 finding 含：位置、问题、修复建议、Sweep 状态、对应反模式。

---

## CRITICAL

### F-CRIT-1 — UI 直接调 transport，绕过 FSM

- **位置**：
  - `src/scaffold/GlobalSpotlight/palettes/AgentControlPalette/useAgentControlPalette.ts:115` — `invokeTauri("agent_send_message", { sessionId, content, … })`
  - `src/engines/ChatPanel/ChatItems/AgentErrorChatItem.tsx:114` — `SessionService.sendMessage({ sessionId, content: "", isResume: true, … })` 直调（resume 按钮）
- **问题**：FSM 的 `beginTurnDispatch / markTurnTerminal` 是 `useMessageDispatch.dispatchMessageBySessionType` 与 `useQueueDispatch.dispatchMessage` 中唯一的 generation 来源。这两处直调跳过 `beginTurnDispatch`，导致后续 turn-end 信号 generation 不匹配 → 队列可能误判 idle 时仍在 working / 老 turn 终止信号污染新 turn。
- **修复**：把 spotlight palette 路径接入 `useMessageDispatch`；AgentErrorChatItem resume 改用 `useMessageDispatch` 或独立调 `beginTurnDispatch` + `markTurnRunning` 包住。
- **Sweep**：`SessionService.sendMessage` 共 11 处调用点，已逐一验证；其它 9 处都在 dispatch hook 内 / 已通过 FSM。
- **反模式**：#21 / #53。

### F-CRIT-2 — `src/coding_agent/` 整棵 orphaned module tree

- **位置**：`src-tauri/src/coding_agent/{mod.rs, commands.rs, config.rs, context.rs, modes.rs, permission.rs, persistence.rs, processor.rs, question.rs, tools.rs}`
- **问题**：
  1. `lib.rs:69-73` 无 `pub mod coding_agent;`
  2. `handler_list.inc` 内 0 引用
  3. 含 broken `use crate::agent_core::compaction::CompactionState`（line 33）、`use crate::agent_core::mcp::McpManager`（line 34）、`crate::osagent::providers::create_provider`（line 180） — 全部不可解析
  4. 含 10+ 死 `#[tauri::command]`
- **修复**：`git log src/coding_agent/` 确认是否被 `agent_core::state::commands::session::` 替代，`rm -rf` 删除全树。
- **Sweep**：grep `coding_agent::` 在 src-tauri/ 外 = 0 hits ✅。
- **反模式**：#29 + #43。

### F-CRIT-3 — `holdSessionQueueForStopAtom` 是 FSM `stopping` phase 的 shadow boolean

- **位置**：
  - `src/store/ui/messageQueueAtom.ts:139, 151`
  - `src/engines/SessionCore/control/sessionTimelineBoundary.ts:20, 132`
- **问题**：FSM 已经有 `stopping` phase 表达"用户已点 Stop，等终止信号"；`holdSessionQueueForStopAtom` 是平行 boolean，写在 `beginTimelineBoundary` 内。两者必须同步否则一边说 idle 一边说 hold → 队列 flush 延迟或重复 dispatch。
- **修复**：删 `holdSessionQueueForStopAtom`；改读 `getTurnPhase() === "stopping"`。或者把 "Stop 后即使 idle 也不要 auto-flush" 的语义并入 FSM 一个新 phase（如 `idle-after-stop`）。
- **Sweep**：grep `holdSessionQueueForStop` = 6 hits（含 test + 2 实现 + 1 timeline boundary）。
- **反模式**：#19 / #51。

### F-CRIT-4 — `SessionStatus` 4 套并存

- **位置**：
  - FE `src/types/session/session.ts:28`（16 变体含 cloud 专属 `queued / in_progress / error / killed`）
  - Rust `agent-core::session::SessionStatus`（`enums.rs:27`，12 变体）
  - Rust `agent_sessions::cli::SessionStatus`（`cli/types.rs:18`，6 变体）
  - Rust DB `AgentSessionStatus`（5 变体）
- **问题**：见 cross-layer-audit.md 表。Rust 端 abandoned / timeout / paused / waiting_for_user 经 CLI adapter 时 `cli/types.rs::SessionStatus::parse` 不识别 → wire 静默 drop；`cliAdapter.ts` 又用 `CliSessionStatus` 超集补回。
- **修复**：
  1. 单一 Rust 源：`agent-core::session::SessionStatus`
  2. CLI 端 `From<agent_core::SessionStatus>` 透传，不再独立定义
  3. DB 列保留 enum 字符串，但反序列化时复用 agent-core 解析
  4. FE 通过 Rust → TS 生成 enum
- **Sweep**：5 处 FE 重复字面量定义。
- **反模式**：#4 / #30。

### F-CRIT-5 — 子 agent UI 嵌套 regex 与 Rust 前缀完全不匹配

- **位置**：
  - FE `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts:38` — `SPAWNED_SESSION_RE = /(?:agentsession|subagent)-[a-f0-9-]+/`
  - Rust `crates/types/src/session.rs:26` — `SUBAGENT_SESSION_PREFIX = "agent-"`、`crates/types/src/session.rs:32` — `SHADOW_SESSION_PREFIX = "shadow-"`
- **问题**：regex 要 `agentsession-` 或 `subagent-` 开头；Rust 实际产 `agent-…` / `shadow-…`。两者 字符串字面 不重合 → `subagentTracking.ts` 永远不能识别子 agent，UI 嵌套链断。
- **修复**：要么改 regex 为 `/(?:agent|shadow|sde|os|cli)agent?-…/`（覆盖所有 prefix），要么 Rust 改 prefix（更大的改动）。memory `workspace_subagent_ui_visibility_regex.md` 此前说"唯一桥梁"是这条 regex — 当前是断的。
- **Sweep**：`SPAWNED_SESSION_RE` 在 6 个文件用（`subagentTracking.ts` + rustAgent eventHandlers）。
- **反模式**：#1 / #38。

### F-CRIT-6 — `resolveFilePayload.ts` 异步 fallback 不对称（OPEN bug）

- **位置**：`src/modules/WorkStation/CodeEditor/SessionReplay/resolveFilePayload.ts:49, 64, 76`
- **问题**：memory `workspace_sessionreplay_file_blank.md` 已记录；`[file-blank]` TEMP DIAG 仍在跑等用户复现。FILES READ 点击后 CodePanel 落到 `content === undefined` 分支。
- **修复**：见 memory；inline `op.content` 被 dedup 剥离后 `convertToFileOperation(op.event)` 提取分支需补 fallback。
- **反模式**：#10。

### F-CRIT-7 — `src-tauri/src/lib.rs:892` 一行 `unwrap_or_default` → 全用户 file-history 被删

- **位置**：`src-tauri/src/lib.rs:892`
- **问题**：`SELECT session_id FROM agent_sessions` 任一行 decode 失败 → `unwrap_or_default()` 返回空 `Vec<String>` → `agent_core::tools::file_history::prune_orphan_sessions(&[])` 把所有 session 当孤儿删除。
- **修复**：

```rust
let live = match query(…).await {
    Ok(v) => v,
    Err(e) => {
        tracing::warn!("failed to load live sessions for prune, skipping: {e:#}");
        return; // 不进 prune
    }
};
```

- **反模式**：#6 / #33。

### F-CRIT-8 — TEMP DIAG 残留 5 文件 25 行

- **位置**：
  - `src/components/ComposerInput/imperativeApi.ts:106-120` — 含 `console.trace`，每次 ComposerInput.setContent / clear 触发（**perf 税**）
  - `src/engines/ChatPanel/hooks/useInputArea/index.ts:359, 366, 380, 397, 408` — `[draft-bug]` ×5
  - `src/engines/ChatPanel/InputArea/components/ModePill.tsx:141, 142` — `[draft-bug]`
  - `src/modules/shared/layouts/AppLayout.tsx:206, 219` — `[ws-blank-diag]`
  - `src/modules/WorkStation/CodeEditor/SessionReplay/resolveFilePayload.ts:49, 64, 76, 85` — `[file-blank]`
- **问题**：3 套 OPEN bug 仍在等用户复现日志（memory `workspace_mode_switch_clears_draft.md`、`workspace_workstation_toggle_right_blank.md`、`workspace_sessionreplay_file_blank.md`）。`feedback_audit_before_commit.md` 已记录前一次 audit session 误把这些 commit 进去过。
- **修复**：保留 `console.warn`，删 `console.trace`；或者全部 gate 在 `window.__orgiiDiag` flag 后。
- **Sweep**：grep `\[draft-bug\]|\[ws-blank-diag\]|\[file-blank\]|TEMP DIAG` = 25 行。

---

## HIGH

### F-HIGH-1 — `launch_cli_agent` 静默丢 7 字段

见 cross-layer-audit.md。`launch.rs:265-309`。修复：reject 组合 or 透传 7 字段。

### F-HIGH-2 — `userInitiatedCancelAtom` 多 concern atom

- **位置**：`src/store/session/cliSessionStatusAtom.ts:174-175`
- **问题**：注释明说承担 (1) "用户 Stop"信号区分 vs Rust failure；(2) 触发 input restore；以及 (3) 经 `useQueueDispatch.ts:193` 在 force-send 时被清。每个 concern 应该有自己的 atom（反模式 #54）。
- **修复**：
  - `postStopDispatchEpisodeAtom`：仅"下一次 submit 是 post-Stop explicit dispatch"
  - `stopDraftRestorationPendingAtom`：仅"input restore 窗口开"
  - 各 concern 独立 writer / clearer
- **Sweep**：grep `userInitiatedCancelAtom` = 5 文件 8 处。
- **反模式**：#22 / #54。

### F-HIGH-3 — BE `CancelReason` 软校验

- **位置**：`src-tauri/src/agent_sessions/cli/commands.rs:498-500`
- **问题**：`cli_agent_cancel(session_id, reason: Option<CancelReason>)` — 未知 reason 反序列化为 `None`。memory 已警告，但实际仍 None-coerce 而非显式 reject。
- **修复**：手写反序列化，未知 reason 返 `Err("unknown cancel reason: …")`。
- **反模式**：#11。

### F-HIGH-4 — `benchmark.rs` 10+ unregistered Tauri command

见 be-audit.md。

### F-HIGH-5 — `advanced-search` crate 同 crate 5 struct 双定义

见 naming-collisions.md。

### F-HIGH-6 — `ApiError` 3 处定义

见 naming-collisions.md。

### F-HIGH-7 — `ProviderConfig` 跨 crate 同名不同语义

见 naming-collisions.md。

### F-HIGH-8 — 177 处生产 `unwrap()`

- **Sweep**：`grep -rE "^\s*\.unwrap\(\)" src-tauri/src src-tauri/crates/agent-core/src --include="*.rs" | grep -v test | wc -l` = 177。
- **修复**：分批清理；优先 `expect("…")` 显式说明假设；hot path 转 `Result` 返回。
- **反模式**：#33。

### F-HIGH-9 — 7 处 poisoned-mutex / resolver-init `.expect()` 可达

- **位置**：
  - `src-tauri/src/agent_sessions/unified_stats/aggregation.rs` 4 处 `.expect("agent metadata resolver initialized")`
  - `src-tauri/src/cursor_ide_watch.rs:82, 128, 146` `.expect("WatchHandlesState mutex poisoned")`
- **问题**：若 IoC slot 未装或 mutex 被另一线程 panic 污染，整 app 退出。反模式 #33 直接命中。
- **修复**：换 `lock().unwrap_or_else(|p| p.into_inner())` 或返回 `Err` 给调用方处理。

### F-HIGH-10 — `extractors.rs:341` `_ => None` 吞新枚举变体

见 be-audit.md。**Sweep**：本文件含 6 处 `_ =>`（行 72、341、929、1143、1491、1558），全部需 exhaustive 化。

### F-HIGH-11 — `useWorkspaceChat.ts` 8 dispatch site 集中

- **位置**：`src/engines/ChatPanel/hooks/useWorkspaceChat/useWorkspaceChat.ts:198, 386, 401, 418, 432, 445, 460, 503`
- **问题**：一个 hook 8 处调 `dispatchMessageBySessionType`；难追溯 user action → dispatch 的 1-to-1 关系。
- **修复**：consolidate 到一个 dispatcher 内并显式打 source tag（"submit" / "queue-flush" / "interactive-event" / "next-step-event" 等）。
- **反模式**：#21。

### F-HIGH-12 — Anti-pattern #43 工业级 schema 残留

见 cross-layer-audit.md。pre-user-stage 可清理为 canonical CREATE TABLE。

---

## MEDIUM

### F-MED-1 — `setSessionRuntimeStatusAtom` 多 source 写入

- **位置**：`src/store/session/cliSessionStatusAtom.ts:37-46`
- **问题**：`source` 字段 10 个值（`dispatch / queue / sync / timeline-boundary / planning / launch / interactive-event / repo-setup / session-reset / e2e`），但 setter 没有强制 source；只是 trace。反模式 #20 / #52 的边界值 — 现在尚未失控。
- **修复**：把 status 转为 FSM phase 的 derived 值（`getTurnPhase() → "idle" | "running" | …`），删 setter。

### F-MED-2 — `engines/ChatPanel/` 根目录 6 misplaced

见 fe-audit.md F-MED-2。

### F-MED-3 — 重载词缺 glossary

见 naming-collisions.md。建议在 `Documentation/` 加 `glossary.md`，每个重载词列含义 + 推荐用法 + 当前位置。

### F-MED-4 — FE 5 处重复定义 status / mode

见 cross-layer-audit.md & naming-collisions.md。建议加 `core-types/wire` 生成步骤。

### F-MED-5 — `cli_agent_resume` 缺 `ensure_cli_account_key_fresh`

见 cross-layer-audit.md & be-audit.md。

### F-MED-6 — `dangerouslySetInnerHTML` 13 处需 sanitizer 审计

- 高风险（LLM / 外部内容）：`engines/ChatPanel/blocks/primitives/BlockOutput.tsx:314`、`a2uiElements.tsx:9, 108`、`MermaidBlock.tsx:512, 589`、`GitHubDiff/DiffRow.tsx:110, 186, 210`、`DocxPreview/index.tsx:94`、`PagesPreview/index.tsx:120`
- 低风险（内部生成）：`useShikiHighlight.ts:132`（tokenizer 生成）、`TerminalCommand.tsx:110`、`ShellCssOutput.tsx:107`、`CopilotSessionSetup/index.tsx:343`
- **修复**：每个高风险点添加 DOMPurify 或同等 sanitizer，并在文件头注明 sanitization invariant。

### F-MED-7 — 文件大小超限

- FE：`cliAdapter.ts` 1000、`ChatHistory/index.tsx` 909、`EditorMainPane/index.tsx` 917、`CreateWorkItemView/index.tsx` 903、`Diff/SessionReplay/index.tsx` 902、`SessionCreator/variants/ChatPanel/index.tsx` 872、`BenchmarkPanel/index.tsx` 845、`CanvasApp.tsx` 793、`ComposerInput/index.tsx` 739、`spotlightActionDefinitions.ts` 737、`Tooltip/index.tsx` 732、`GitDiffContent/index.tsx` 723、`MessageReferenceCards.tsx` 710
- BE：`cursor_native/provider.rs` **3220**、`e2e-test/agent_org.rs` 3167、`cli/session_runner/session.rs` 2838、`benchmark.rs` 2746、`api/agent/test/agent_org.rs` 2744、`inbox_drain/mod.rs` 2330、`agent_org_runs.rs` 2260、`prompt/sections.rs` 2153、`e2e-test/harness.rs` 2067、`agent_org_tasks_and_exec_mode.rs` 2056、`agent_org_tasks.rs` 2003、`projects/commands/sync.rs` 1964、`dev-record/cursor_db_history.rs` 1854、`api/agent/test/sde.rs` 1811
- **修复**：每文件单独分模块；不在审计 scope 内强制拆。

### F-MED-8 — `agent-core` 11 处变体字面量泄漏

见 be-audit.md 层 6。

---

## LOW / INFO

| ID       | 标题                                                                  | 位置                                                                                      | 备注                                                                |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| F-LOW-1  | `osagent` 幽灵 EnvFilter                                              | `src-tauri/src/lib.rs:476`                                                                | F-CRIT-2 清理后可一并删                                             |
| F-LOW-2  | `MessageReferenceCards` test drift                                    | `src/engines/ChatPanel/blocks/__tests__/MessageReferenceCards.test.ts`                    | memory `workspace_message_reference_cards_drift.md`，需 vitest 确认 |
| F-LOW-3  | localStorage 7 个裸键                                                 | `themeInit`、`timezone`、`oauthRedirect_*` 等                                             | 部分约定俗成，OK                                                    |
| F-LOW-4  | 88 个 TS TODO / FIXME / HACK                                          | 散布                                                                                      | 多数为意图标记                                                      |
| F-LOW-5  | 37 个 Rust TODO                                                       | 散布                                                                                      | 同上                                                                |
| F-LOW-6  | cargo-machete allow-list 不全                                         | `src-tauri/Cargo.toml:170-171`                                                            | 仅 3/18 macro-only crate 入 allow-list                              |
| F-LOW-7  | 3 套 cancel 机制并存                                                  | `coding_agent::cancel_flags`（dead）、`agent_session_cancel`（live）、`CancellationToken` | 新人困惑；F-CRIT-2 清死代码后剩 2                                   |
| F-LOW-8  | 4 个 `*_bridge` 模块同名模式                                          | `agent_sessions::cli::agent_core_bridge` 等                                               | 模式一致，OK                                                        |
| F-LOW-9  | 3 处 `@ts-expect-error` 集中在 `eventPayload.ts`                      | `eventPayload.ts:63, 259, 355`                                                            | 局部可控                                                            |
| F-INFO-1 | Tauri 命令注册无 duplicate-name 编译期检测                            | `handler_list.inc`                                                                        | build-script lint diff 可加                                         |
| F-INFO-2 | 无 PR CI                                                              | `.github/workflows/` 仅 release.yaml                                                      | F-CRIT-2 / F-HIGH-4 / F-CRIT-7 都会被基础 CI 抓到                   |
| F-INFO-3 | `infrastructure/housekeeping.rs:218-226` 每次启动 DROP 7 legacy KG 表 | 反模式 #43，应记 migration version 一次性                                                 |
