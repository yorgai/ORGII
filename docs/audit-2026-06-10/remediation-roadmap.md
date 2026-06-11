# 整改路线图 — 2026-06-10

按 "blast radius / ROI / 反模式严重度 / 文件互不重叠" 排序。Phase 1 ~ 3 内的 slice 之间**无共享文件**，可全部并行 PR。

---

## Phase 1 — Critical 清零（8 个独立 PR，全部可并行）

> 目标：所有 F-CRIT-\* 解决；本 phase 结束即可 release。

| PR   | 标题                                                               | 文件                                                                  | 描述                                                                                                                                | 反模式    | 校验                                                                       |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| P1-1 | fix(startup): skip prune on session decode error                   | `src-tauri/src/lib.rs:892`                                            | `Err` 分支改成 `tracing::warn!` + `return;`，不再误删 file history                                                                  | #6 / #33  | 加 unit test：模拟 query 失败，断言 `prune_orphan_sessions` 未被调         |
| P1-2 | fix(ipc): align subagent UI regex with Rust prefixes               | `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts:38` | regex 改为 `/^(?:agent                                                                                                              | shadow    | sde                                                                        | os  | cli)agent?-[a-f0-9-]+/`；从 `crates/types/src/session.rs:7-32` 派生常量 | #1 / #38 | E2E：spawn 一个 builtin subagent，断言 UI nest 正确 |
| P1-3 | chore(cleanup): remove orphaned coding_agent tree                  | `src-tauri/src/coding_agent/**`                                       | `rm -rf`；删 `lib.rs:476` EnvFilter 内 `osagent` 字面量；`git log` 确认替代物已存在                                                 | #29 / #43 | `cargo check -p app` 通过；grep `coding_agent` 0 hit                       |
| P1-4 | fix(chat): route spotlight palette + error-resume through FSM      | `useAgentControlPalette.ts:115`、`AgentErrorChatItem.tsx:114`         | 改成调 `useMessageDispatch.dispatchMessageBySessionType`；或独立调 `beginTurnDispatch + markTurnRunning`                            | #21 / #53 | E2E：触发 spotlight send + resume，断言 FSM phase 转 dispatching → working |
| P1-5 | fix(queue): collapse holdSessionQueueForStopAtom into FSM stopping | `store/ui/messageQueueAtom.ts`、`sessionTimelineBoundary.ts`          | 删 atom；改读 `getTurnPhase() === "stopping"`。考虑加 `idle-after-stop` phase 表达"等用户显式 send-now"                             | #19 / #51 | vitest：模拟 Stop → 终止信号到达 → flush 时机正确                          |
| P1-6 | chore(diag): gate TEMP DIAG behind window flag                     | 5 文件（见 F-CRIT-8）                                                 | 全部 wrap `if (window.__orgiiDiag) { console.warn(…) }`；删 `console.trace`；保留 [draft-bug]/[ws-blank-diag]/[file-blank] tag 不变 | —         | 视觉确认 ComposerInput 性能无 trace；OPEN bug 仍可复现                     |
| P1-7 | fix(types): unify SessionStatus across FE+BE                       | `agent-core/.../enums.rs:27` + 3 FE 副本 + CLI/DB enum                | a) `cli::SessionStatus` 改 `From<agent_core::SessionStatus>`；b) FE 通过 build-script 从 Rust 生成；c) 删 FE 4 处重复字面量         | #4 / #30  | grep `"running"`、`"queued"` 等字面量 FE 单源                              |
| P1-8 | fix(resolve): fix resolveFilePayload async fallback                | `resolveFilePayload.ts`                                               | 沿用 `[file-blank]` diag 路径，等用户复现日志；本 PR 可拆为单独 hotfix 不进 Phase 1                                                 | #10       | OPEN bug 闭合                                                              |

---

## Phase 2 — High（10 个独立 PR）

| PR    | 标题                                                          | 文件                                                       | 描述                                                                          | 反模式    |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | ------------------------- | --- |
| P2-1  | refactor(launch): unify launch_cli_agent vs launch_rust_agent | `state/commands/session/launch.rs:265-309`                 | 拒绝 CLI + agent_org_id 组合 (typed error)；或者把 7 字段塞 `CliLaunchParams` | #9 / #38  |
| P2-2  | refactor(atom): split userInitiatedCancelAtom                 | `cliSessionStatusAtom.ts:174-175`                          | 分裂为 `postStopDispatchEpisodeAtom` + `stopDraftRestorationPendingAtom`      | #22 / #54 |
| P2-3  | fix(cancel): typed CancelReason parse                         | `cli/commands.rs:498-500`                                  | 未知 reason 显式 `Err`；不 None-coerce                                        | #11       |
| P2-4  | chore(benchmark): decide register-or-delete                   | `src-tauri/src/benchmark.rs`                               | a) 注册到 `handler_list.inc`；b) `git blame` 确认废弃后删模块                 | #2        |
| P2-5  | chore(advanced-search): delete stub duplicates                | `crates/advanced-search/src/commands/stubs.rs`             | 删 5 个 stub struct（与 `tantivy_index.rs` 重定义）                           | #29       |
| P2-6  | rename(api-error): split ApiError 3 处                        | `git-api/{types,error}.rs`、`api-search/error.rs`          | git-api 内统一一处；api-search rename `ApiSearchError`                        | #30       |
| P2-7  | rename(provider-config): split ProviderConfig 2 处            | `key-vault/provider_config.rs`、`agent-core/.../traits.rs` | `ProviderEnvDescriptor` + `ProviderClientConfig`                              | #30       |
| P2-8  | chore(rust): replace unreachable expects with safer fallbacks | `aggregation.rs` 4 处、`cursor_ide_watch.rs:82,128,146`    | 换 `lock().unwrap_or_else(                                                    | p         | p.into_inner())`或返`Err` | #33 |
| P2-9  | fix(extractors): exhaustive match for EventDisplayVariant     | `event_pipeline/extractors/extractors.rs:341`              | 删 `_ => None`；让编译器强制 exhaustive；本文件 6 处都 sweep                  | #1        |
| P2-10 | refactor(chat): consolidate useWorkspaceChat 8 dispatch sites | `useWorkspaceChat.ts:198-503`                              | 抽 single dispatcher hook，显式 source tag                                    | #21       |

---

## Phase 3 — Medium / Low（10+ 个独立 PR）

| PR    | 标题                                                                  | 文件 / 范围                                                                              | 反模式    |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| P3-1  | refactor(chatpanel): move misplaced PanelViews out of engine root     | `engines/ChatPanel/` 6 文件 → `features/` 或 `modules/`                                  | #6        |
| P3-2  | refactor(status): derive `setSessionRuntimeStatusAtom` from FSM phase | `cliSessionStatusAtom.ts`                                                                | #20 / #52 |
| P3-3  | chore(schema): canonicalize pre-user-stage CREATE TABLE               | `cli/mod.rs`、`session_snapshots.rs`、`session-persistence/schema.rs`、`housekeeping.rs` | #43       |
| P3-4  | feat(types): Rust → TS enum generation pipeline                       | build script + `types/wire/`                                                             | —         |
| P3-5  | fix(resume): cli_agent_resume runs ensure_cli_account_key_fresh       | `cli/commands.rs:592`                                                                    | #9        |
| P3-6  | docs: glossary.md for 17 重载词                                       | `Documentation/glossary.md`（新文件）                                                    | #4        |
| P3-7  | chore(diag): consolidate dangerouslySetInnerHTML sanitizer            | 6 高风险点                                                                               | #15 OWASP |
| P3-8  | chore(rust): unwrap reduction phase 1                                 | hot path 30 处 → `Result`                                                                | #33       |
| P3-9  | chore(rust): unwrap reduction phase 2                                 | 剩余 147 处                                                                              | #33       |
| P3-10 | refactor(naming): close 18 个跨 crate 同名 struct（非 critical 部分） | 见 naming-collisions.md                                                                  | #30       |

---

## Phase 4 — Info / 长尾

| 项目                                                            | 范围                               |
| --------------------------------------------------------------- | ---------------------------------- |
| 加 PR-level CI（lint + clippy + cargo check -p app + vitest）   | `.github/workflows/pr.yaml` 新文件 |
| Tauri 命令重复名 build-script lint                              | `src-tauri/build.rs`               |
| 文件大小拆分（cursor_native/provider.rs 3220 → ≤ 1000）         | `provider.rs` 拆                   |
| `infrastructure/housekeeping.rs:218` legacy KG 表 DROP 一次性化 | 加 `schema_migrations` 记录        |
| `agent-core` 11 处变体字面量 lift 到 `core-types::session`      | `prefix_lookup.rs` 等              |
| memory file 更新 sweep（见 memory-verification.md）             |                                    |

---

## 不在本路线图内（显式 out-of-scope）

| 项目                                         | 原因                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `OPEN` bug 三个的根因修复                    | 需用户复现日志（`feedback_stop_speculating_add_diagnostic.md`），不应在 audit 后立刻继续推测           |
| `packages/`、`mobile-pwa/`、`contrib/relay/` | 独立 deploy，单独 audit                                                                                |
| 完整 `tsc --noEmit` 基线降噪                 | memory `workspace_tsc_noemit_preexisting_noise.md` 已说明大量 pre-existing 错误，与本审计 finding 无关 |
| 大文件物理拆分                               | 不直接消除反模式；需求驱动再做                                                                         |
| Skill / agent definition 内容修改            | 不在工程范围                                                                                           |

---

## Phase 1 PR 互不重叠确认

| PR   | 主要文件                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | `src-tauri/src/lib.rs`                                                                                                            |
| P1-2 | `src/engines/SessionCore/sync/adapters/shared/subagentTracking.ts`                                                                |
| P1-3 | `src-tauri/src/coding_agent/` + `lib.rs:476` 一行                                                                                 |
| P1-4 | `src/scaffold/.../useAgentControlPalette.ts`、`src/engines/ChatPanel/ChatItems/AgentErrorChatItem.tsx`                            |
| P1-5 | `src/store/ui/messageQueueAtom.ts`、`src/engines/SessionCore/control/sessionTimelineBoundary.ts`                                  |
| P1-6 | 5 文件（不含 P1-2/P1-4/P1-5 改的）                                                                                                |
| P1-7 | `src/types/session/session.ts`、`agent-core/.../enums.rs` 等（**注意可能与 Cross-layer status 改动冲突**，建议 P1-7 单独 review） |
| P1-8 | `resolveFilePayload.ts`（仅本文件）                                                                                               |

**冲突点**：P1-1 与 P1-3 都改 `lib.rs`，但分别在 `:892` 与 `:476`；可以同一 PR 也可以分。其它 PR 完全独立。

---

## 验收门槛（每个 PR）

1. 修复点 grep 确认
2. 相关 sweep 命令 0 hit（见 findings-detail.md 每项 Sweep status）
3. 路径过滤 `tsc --noEmit` 仅显示 baseline
4. 路径过滤 `cargo check -p <crate>` 通过
5. memory 内 OPEN flag 关闭

---

## "最高验收标准" 总结（给 review）

✅ 全部 30 条 Acceptance Criteria 转 ✅；并且：

- F-CRIT-\* 全部闭合 → Phase 1 done
- F-HIGH-\* 全部闭合 → Phase 2 done
- 所有 sweep grep 0 hit
- README.md 内"审计自检"全 ✅
- 3 个 OPEN bug 在 diag 日志收齐后单独整改
