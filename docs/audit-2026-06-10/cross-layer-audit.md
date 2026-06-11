# 跨层架构审计 — 2026-06-10

**范围**：Tauri IPC、`Channel<String>` 每 session 事件流、WebSocket 桥、外部 CLI fork/parse（`src/agent_sessions/cli/`）、SQLite schema、skills/agents config、mobile-pwa relay
**约束**：read-only
**方法**：架构-audit skill 层 8 / 9 / 10 重点

---

## Executive summary

> Top 5 跨层问题：
>
> 1. **F-CRIT-5** — `SPAWNED_SESSION_RE` 与 Rust `SUBAGENT_SESSION_PREFIX = "agent-"` 完全不匹配；子 agent UI 嵌套可能静默坏。
> 2. **F-CRIT-4** — `SessionStatus` 4 套并存（FE 16 + Rust 12/6/5）。
> 3. **F-HIGH-1** — `launch_cli_agent` 静默丢 7 字段（init parity 不对称）。
> 4. **F-HIGH-12** — `ALTER TABLE` 工业级残留（4 处 schema 文件）。
> 5. **F-MED-4** — FE 5 处重复定义 status 字面量；无 Rust → TS 单源生成。

---

## Tauri Command Matrix（前 20 高频）

| #   | Command                        | FE call site                                              | BE 签名                                                                    | args 漂移                                                   | return 漂移     | 错误                                         | 判定        |
| --- | ------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- | -------------------------------------------- | ----------- |
| 1   | `session_launch`               | `useSessionCreator/useSessionLaunch/launchPayload.ts:154` | `state/commands/session/mod.rs:205` → `launch.rs:31` `SessionLaunchParams` | –                                                           | –               | `Result<_, String>`                          | ✅ OK       |
| 2   | `agent_send_message`           | `useAgentControlPalette.ts:115`（直 invokeTauri！）       | agent-core                                                                 | 未深查全签名                                                | –               | `Result<_, String>`                          | ⚠️ 未深查   |
| 3   | `cli_agent_create`             | E2E only                                                  | `cli/commands.rs:42`                                                       | wrapper key `params:`                                       | –               | `Result<CodeSession, String>`                | ✅ OK       |
| 4   | `cli_agent_run`                | internal                                                  | `cli/commands.rs:196`                                                      | –                                                           | –               | –                                            | ✅ Internal |
| 5   | `cli_agent_message`            | `cliAdapter.ts:941`                                       | `cli/commands.rs:301`                                                      | –                                                           | –               | `Result<(), String>`                         | ✅ OK       |
| 6   | `cli_agent_cancel`             | `cliAdapter.ts:998`                                       | `cli/commands.rs:498` `sessionId, reason?: CancelReason`                   | FE 传 `"user_stop"`；BE 未知 reason 静默 `None`（line 500） | –               | `Result<_, String>`                          | ⚠️ F-HIGH-3 |
| 7   | `cli_agent_status`             | `cliAdapter.ts:151`                                       | `cli/commands.rs:476`                                                      | –                                                           | –               | –                                            | ✅ OK       |
| 8   | `cli_agent_chunks`             | `cliAdapter.ts:336`                                       | `cli/commands.rs:517`                                                      | –                                                           | –               | –                                            | ✅ OK       |
| 9   | `cli_agent_approval_response`  | adapter                                                   | `cli/commands.rs:461`                                                      | –                                                           | –               | –                                            | ⚠️ Sampled  |
| 10  | `subscribe_session_events`     | `useSessionChannel.ts:215`、`useOSAgentIDEActions.ts:164` | `api/websocket_handler.rs:377` `sessionId, onEvent: Channel<String>`       | –                                                           | `u64` channelId | –                                            | ✅ OK       |
| 11  | `unsubscribe_session_events`   | `useSessionChannel.ts:220`                                | `websocket_handler.rs:386`                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 12  | `agent_load_messages`          | `rpc/procedures/agentSession.ts:24`                       | agent-core                                                                 | zod 校验                                                    | –               | –                                            | ✅ OK       |
| 13  | `agent_get_session`            | `agentSession.ts:28`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 14  | `agent_list_all_sessions`      | `agentSession.ts:32`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 15  | `agent_question_response`      | `agentSession.ts:61`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 16  | `agent_permission_response`    | `agentSession.ts:79`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 17  | `agent_plan_approval_response` | `agentSession.ts:93`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 18  | `agent_session_cancel`         | `agentSession.ts:14`                                      | agent-core                                                                 | –                                                           | –               | –                                            | ✅ OK       |
| 19  | `mobile_remote_pair_init`      | `mobileRemote/index.ts:71`                                | `mobile_remote::pairing::commands::mobile_remote_pair_init`                | –                                                           | –               | `Result<_, MobileRemoteError>`（**typed!**） | ✅ 标杆     |
| 20  | `cli_agent_history_mutation`   | E2E only                                                  | `cli/commands.rs`                                                          | –                                                           | –               | –                                            | ✅ OK       |

**结论**：生产命令经 zod RPC layer，shape 漂移会被 FE 早捕获。E2E helper 绕过 zod 不算风险。`mobile_remote_pair_init` 是唯一用 typed error 的命令，其它 ~900 全部 `Result<T, String>` — 反模式 #11（"frontend has to string-match error messages"）。

---

## Event / Status enum 对齐

### `SessionStatus` — F-CRIT-4

| 变体              | FE `src/types/session/session.ts:28` | Rust `agent-core::session::SessionStatus`（`enums.rs:27`） | Rust `agent_sessions::cli::SessionStatus`（`cli/types.rs:18`） | Rust DB `AgentSessionStatus` | 漂移                               |
| ----------------- | ------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| pending           | ✅                                   | ✅                                                         | ✅                                                             | ❌                           | DB collapse                        |
| idle              | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| running           | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| waiting_for_user  | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI/DB 缺                          |
| waiting_for_funds | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI/DB 缺                          |
| paused            | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI 缺                             |
| **queued**        | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only（cloud）**               |
| **in_progress**   | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only（cloud）**               |
| completed         | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| failed            | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| **error**         | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only（`failed` 的同义双写）** |
| cancelled         | ✅                                   | ✅                                                         | ✅                                                             | ✅                           | OK                                 |
| abandoned         | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI 缺                             |
| timeout           | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI 缺                             |
| **killed**        | ✅                                   | ❌                                                         | ❌                                                             | ❌                           | **FE-only（cloud）**               |
| archived          | ✅                                   | ✅                                                         | ❌                                                             | ❌                           | CLI 缺                             |

**风险**：Rust `Abandoned/Timeout/Paused/WaitingForUser` 走 CLI adapter 到 FE 时 `cli/types.rs::SessionStatus::parse`（line 32）不识别 → wire 静默 drop。`cliAdapter.ts` 单独维护 `CliSessionStatus` 超集（`src/types/session/session.ts:67`）再补。**3 套 source of truth 应该 1 套**。

### `AgentExecMode`

| 变体                     | FE picker `AGENT_EXEC_MODES` | FE wire `ALL_AGENT_EXEC_MODES` | Rust `AgentExecMode`（`enums.rs:153`） | 漂移                                                                              |
| ------------------------ | ---------------------------- | ------------------------------ | -------------------------------------- | --------------------------------------------------------------------------------- |
| build / ask / plan       | ✅ ✅ ✅                     | ✅                             | ✅                                     | OK                                                                                |
| debug / review / wingman | ❌ 隐藏                      | ✅                             | ✅                                     | **Intentional split**（memory `workspace_agent_exec_mode_display_wire_split.md`） |

`sessionCreatorConfig.ts:60-68` 有显式 guard 注释，代码用 `ALL_AGENT_EXEC_MODES` 验证 wire payload — 不会 collapse `wingman/review` 到 `build`。Memory 校验 ✅。

### 事件名（`agent:*`、`code_session.*`）

| 事件                                                                          | Rust emit            | FE consume                       | 对齐 |
| ----------------------------------------------------------------------------- | -------------------- | -------------------------------- | ---- |
| `code_session.activity`                                                       | `cli/session_runner` | `cliAdapter.ts:858`              | ✅   |
| `code_session.status_changed`                                                 | `commands.rs:283`    | `cliAdapter.ts:862`              | ✅   |
| `code_session.worktree_created`                                               | `commands.rs:168`    | `cliAdapter.ts:872`              | ✅   |
| `code_session.merge_result`                                                   | session_runner       | `cliAdapter.ts:884`              | ✅   |
| `code_session.token_usage_updated`                                            | session_runner       | `cliAdapter.ts:867`              | ✅   |
| `agent:message_delta / tool_call / tool_result / complete / error`            | agent-core emitter   | `subagentHandlers.ts:31-46`      | ✅   |
| `agent:streaming_complete`                                                    | agent-core           | `cliAdapter.ts:860`              | ✅   |
| `agent:plan_ready_for_approval` / `exit_plan_mode` / `plan_approval_archived` | agent-core           | `cliAdapter.ts:852-857`          | ✅   |
| `agent:interaction_finalized`                                                 | agent-core           | `cliAdapter.ts:850`              | ✅   |
| `agent:setup_repo_update`                                                     | agent-core           | `fileChangeHandlers.test.ts:144` | ✅   |
| `agent:heartbeat / turn_summary / context_usage`                              | agent-core           | sessionHandlers tests            | ✅   |

无字面量漂移 ✅。

---

## Init Parity Matrix

| 入口                                       | 路径                                                                  | 关键步骤                                                                                                                                                                   | 缺失                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Production `SessionCreator`                | FE `buildSessionLaunchPayload` → `session_launch` → category dispatch | auto-name / key/account resolve / mode 持久化 / IDE context / work-item / worktree（RUST only via `WorkspaceLaunchTarget`）/ CLI key freshness check / persist / broadcast | 无                                                                              |
| Direct `cli_agent_create`（E2E）           | `e2e/helpers/sessionConfig.ts:367`                                    | worktree、proxy alloc                                                                                                                                                      | 无 auto-name / IDE / work-item / agent-org — by design                          |
| WorkStation new tab                        | mount empty → 首次输入 `session_launch`                               | 同 production                                                                                                                                                              | OK                                                                              |
| `cli_agent_resume`（`commands.rs:592`）    | re-spawn runner，复用 `cli_session_id`                                | –                                                                                                                                                                          | **缺 `ensure_cli_account_key_fresh`** — OAuth token 过期 resume 失败 ⚠️ F-MED-5 |
| 测试 helper `e2e/helpers/sessionConfig.ts` | 直 `cli_agent_create`                                                 | 子集                                                                                                                                                                       | by design                                                                       |
| Gateway HTTP `/agent/test/*`               | `api/agent/test/workspace.rs:205` → 复用 `session_launch_impl`        | ✅ 走 slow path                                                                                                                                                            |
| Standalone bins（`bin-gateway-chat-cli`）  | 不在 Tauri 命令集                                                     | –                                                                                                                                                                          | rustls 安装 / env 一致性未审 ⚠️                                                 |

### F-HIGH-1 `launch_cli_agent` 字段丢

`launch.rs:265-309` 只传 CLI-relevant 字段进 `CliLaunchParams`，**丢弃** 7 字段：`agent_org_id`、`agent_org_member_overrides`、`apply_agent_org_member_overrides_for_future`、`work_item_id`、`agent_role`、`project_slug`、`agent_definition_id`。`launch_rust_agent` 保留全部 7 字段。

**修复**：要么 reject `AgentOrg + CLI` 组合（typed error），要么把 7 字段塞 `CliLaunchParams`。

---

## Resolver Fallback Matrix

| 字段                | FE 链                                                | BE 链                                                               | 对称？           |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | ---------------- |
| model               | `advancedConfig.model → none`                        | `params.model → AgentDef default → none`                            | ⚠️ FE 缺 default |
| account_id          | `advancedConfig.selectedAccountId → none`            | `params.account_id → cli resume table → previous`                   | OK               |
| workspace_path      | `effectiveSource.repoPath → none`                    | `params.workspace_path → unwrap_or_default("")`                     | ⚠️ BE 默认 `""`  |
| branch              | `resolvedKeys.branch ?? effectiveSource.branch`      | `params.branch → git symbolic-ref HEAD`                             | OK               |
| agent_definition_id | `selectedAgentDefId` if not AgentOrg                 | passed through                                                      | OK               |
| **agent_org_id**    | `selectedAgentOrgId` if AgentOrg picker              | **CLI 丢；RUST 保留**                                               | ❌ F-HIGH-1      |
| native_harness_type | `advancedConfig.nativeHarnessType`（仅 isRustAgent） | `params.native_harness_type`（Rust path only）                      | OK               |
| key_source          | `resolvedKeys.keySource`                             | `params.key_source → reject unknown`                                | OK               |
| hosted_token        | `getOrRefreshHostedToken()`                          | `params.hosted_token → proxy alloc`                                 | OK               |
| mode                | `agentExecMode`                                      | `params.mode → DB persist → effective_mode lookup next turn`        | OK               |
| ide_context         | `WorkspaceSnapshot` from React                       | `params.ide_context → injected into prompt`（`cli/commands.rs:18`） | OK               |

**Worktree 双入口**：Rust 路径 `WorkspaceLaunchTarget::Worktree`（`launch.rs:162`）+ CLI 路径 `isolate` flag（`cli/commands.rs:97`）— 两条路都调 `worktree::create_session_worktree`，规则分叉风险。

---

## SQLite schema vs FE assumption

### Anti-pattern #43 — `ALTER TABLE` 工业级残留（F-HIGH-12）

| 表                         | DDL 位置                                                               | 残留 migration                                                                          | 备注                                                                                        |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `code_sessions`            | `cli/mod.rs:30`                                                        | 15+ `ALTER ADD COLUMN`，1 destructive `DROP COLUMN` on `code_session_chunks.stage_name` | doc comment（`mod.rs:5`）**说谎**：写 `cli_agent_sessions`，实际 `code_sessions`            |
| `agent_sessions`           | `crates/agent-core/src/foundation/persistence/session_snapshots.rs:71` | 17+ `try_migrate(ALTER TABLE … ADD COLUMN)`                                             | 测试 fixture（`lifecycle.rs:583`、`messages/insert_tests.rs:30`）定义不同列集 — schema 碎片 |
| `events`                   | `crates/session-persistence/src/schema.rs:23`                          | 3 trailing migration + destructive `DROP COLUMN stage_name`                             | pre-user-stage 可清理                                                                       |
| `session_turn_index_state` | `schema.rs:104`                                                        | `ADD COLUMN index_version`（line 114）                                                  | 应入 CREATE                                                                                 |
| `agent_messages`           | `session_snapshots.rs:82`                                              | `ADD COLUMN images`（line 129）                                                         | 应入 CREATE                                                                                 |
| Legacy KG                  | `infrastructure/housekeeping.rs:218-226`                               | 启动每次 DROP 7 张表（IF EXISTS）                                                       | 应记 migration version 一次性                                                               |

### FE 列名假设（采样）

| 表                    | FE 读取方式                                                               | 风险                                      |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| `code_sessions`       | `cli_agent_status / list` → `CodeSession` struct                          | Low — 经 serde                            |
| `agent_sessions`      | `agent_get_session / agent_list_all_sessions` → `SessionMeta/SessionInfo` | Low — 经 serde                            |
| `session_turns`       | `es_load_initial_turn_window`、`cache_load_session_turn_body`             | OK — wire DTO                             |
| `events`              | `es_get_events`、`cache_load_event_payload`                               | OK                                        |
| `agent_messages`      | `agent_load_messages` → `SessionMessage[]`                                | OK                                        |
| `agent_snapshots`     | `agent_get_snapshots` → `SnapshotRecord[]`                                | OK；列名 `hash` 实际存 UUID — schema 说谎 |
| `code_session_chunks` | `cli_agent_chunks` → `ActivityChunk[]`                                    | OK                                        |

**FE 从不直接拼 SQL** ✅ — 这是正确架构，隔离 BE schema 漂移。风险全在 DTO 层。

详细 cross-cutting sweep（magic strings、kebab/snake、localStorage 重叠、DEFAULT_PINNED）见 [cross-layer-audit-part2.md](./cross-layer-audit-part2.md)。
