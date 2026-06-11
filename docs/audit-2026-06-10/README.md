# ORGII 全局架构审计报告 — 2026-06-10

**审计基准 commit**：`0e0da15b fix(workstation): hide caption bar when no active session`
**工作区状态**：clean（无 uncommitted 修改）
**审计方法**：`~/.cursor/skills/code-audit/SKILL.md`（12 类清单）+ `architecture-audit` skill（10 层 + 反模式 #1–#54）+ 3 个 explore subagent 并发分层审计（FE / BE / Cross-layer）+ 主上下文 spot-check
**审计范围**：`src/`、`src-tauri/src/`、`src-tauri/crates/`、`types/`、`tests/`、跨层 IPC / 事件 / DB
**已显式排除**：`packages/`（4 个独立 holding repo）、`mobile-pwa/`、`contrib/relay/`、`node_modules/`、`build/`、`target/`、`wiki/`

---

## 一、最终验收标准 (Acceptance Criteria) — 顶层 30 条

> 这是给 review 用的"最高验收"清单。**全部 ✅ = 全局架构通过验收**；任何 ❌ 或 ⚠️ 需进入下一轮整改。每条都对应一个 finding 和一组可 grep 的证据。

### A. FSM / 队列 / 控制流（反模式 #47–#54）

- [ ] **AC1** 仅一个 source of truth 决定"队列能否 flush" — 当前 `useQueueDispatch.ts` 只读 `getTurnPhase()` ✅；但 `holdSessionQueueForStopAtom` 仍作为 shadow boolean 与 FSM `stopping` 共存 ❌ **(F-CRIT-3)**
- [ ] **AC2** 每个 turn-ending 信号携带 monotonic `generation`，老信号被丢弃 — `turnLifecycle.ts:223-241` ✅
- [ ] **AC3** 没有多用途 atom — `userInitiatedCancelAtom` 同时承担"signal user Stop"+"trigger draft restore" ❌ **(F-HIGH-2)**
- [ ] **AC4** 用户 Stop 与程序 Force Send 分离 cancel API — `cancelTurnForTimelineBoundary(reason)` 区分 reason，但 BE 端 `CancelReason` 软校验未知 reason 静默 `None` ⚠️ **(F-HIGH-3)**
- [ ] **AC5** 没有 UI 直接调 transport — `useAgentControlPalette.ts:115` 直接 `invokeTauri("agent_send_message")`、`AgentErrorChatItem.tsx:114` 直接 `SessionService.sendMessage`，**完全绕过 FSM** ❌ **(F-CRIT-1)**
- [ ] **AC6** Provider event handler 不直接写 `runtimeStatus` — `setSessionRuntimeStatusAtom` 暴露给 10+ source 写入 ⚠️ **(F-MED-1)**

### B. 模块边界 / 死代码（反模式 #2、#29、#43）

- [ ] **AC7** 无 orphaned module tree — **`src-tauri/src/coding_agent/` 整棵树未注册到 `lib.rs`，含 broken `crate::osagent` 引用** ❌ **(F-CRIT-2)**
- [ ] **AC8** 无未注册的 Tauri command — **`src-tauri/src/benchmark.rs` 含 10+ 命令未出现在 `handler_list.inc`** ❌ **(F-HIGH-4)**
- [ ] **AC9** `engines/ChatPanel/` 根目录无 misplaced PanelView — 6 个错位文件仍在 ⚠️ **(F-MED-2)**
- [ ] **AC10** 无同 crate 内同名 struct 双定义 — `crates/advanced-search` 内 5 个 struct 在 `tantivy_index.rs` 与 `commands/stubs.rs` 各定义 1 次 ❌ **(F-HIGH-5)**

### C. 命名 / 语义（反模式 #4、#23、#30）

- [ ] **AC11** 无跨 crate / 跨模块同名不同 schema 的 struct — `ApiError` 3 处（`git-api/types.rs` + `git-api/error.rs` 同 crate 冲突 + `api-search/error.rs`） ❌ **(F-HIGH-6)**
- [ ] **AC12** `ProviderConfig` 同名 / 不同字段 / 不同语义 — `key-vault::provider_config.rs:12` vs `agent-core::core::providers::traits.rs:360` ❌ **(F-HIGH-7)**
- [ ] **AC13** 跨模块同名 23 处全部审计 — 见 [naming-collisions.md](./naming-collisions.md) ⚠️
- [ ] **AC14** 重载词全部有 glossary — `session/agent/tab/mode/pill/panel/event/block/creator/bridge/manager/handler/broadcast/gateway/provider/runtime/config` 仅 `session` 有 in-file glossary ❌ **(F-MED-3)**

### D. Wire 协议 / 跨层契约（反模式 #7、#8）

- [ ] **AC15** 所有 FE `invokeTauri(name, …)` 类型化 — 23+ 裸 command 名 ⚠️
- [ ] **AC16** FE/BE 共享 enum 从 Rust 单源生成 — status 在 FE 重复定义 5 处；AgentExecMode / 事件名 / session id prefix 全部手工双写 ⚠️ **(F-MED-4)**
- [ ] **AC17** `SessionStatus` enum 单源 — 当前 **4 套并存**：FE 16 变体、Rust agent-core 12 变体、Rust cli 6 变体、Rust DB 5 变体 ❌ **(F-CRIT-4)**
- [ ] **AC18** schemars 未触发 OpenAPI 字段污染 — 全部使用 derive（默认 draft07） ✅
- [ ] **AC19** 子 agent UI 嵌套 regex 与 Rust 前缀对齐 — `SPAWNED_SESSION_RE = /(?:agentsession|subagent)-…/` vs Rust `SUBAGENT_SESSION_PREFIX = "agent-"` **完全不匹配** ❌ **(F-CRIT-5)**

### E. Init parity / Resolver 对称（反模式 #9、#10）

- [ ] **AC20** session-create 入口初始化对称 — `launch_cli_agent` 静默丢 `agent_org_id` 等 7 字段 ❌ **(F-HIGH-1)**
- [ ] **AC21** `cli_agent_resume` 与 `cli_agent_create` 初始化对称 — resume 缺 `ensure_cli_account_key_fresh` ⚠️ **(F-MED-5)**
- [ ] **AC22** 多字段 resolver fallback 对称 — `resolveFilePayload.ts` 异步分支仍有空 fallback（live `[file-blank]` TEMP DIAG） ❌ **(F-CRIT-6 OPEN)**

### F. Panic / 错误处理 / Sync I/O

- [ ] **AC23** 生产 `unwrap()` ≤ 30 处 — **实际 177 处** ❌ **(F-HIGH-8)**
- [ ] **AC24** 启动路径无 `.unwrap_or_default()` 触发破坏性副作用 — `src-tauri/src/lib.rs:892` 一行解码失败 → 整个 file-history 被当成孤儿删除 ❌ **(F-CRIT-7)**
- [ ] **AC25** 异步路径无 sync `std::fs::*` — CLI runner ~18 处 ⚠️
- [ ] **AC26** `.expect("…must")` 仅在不可达分支 — `aggregation.rs` 4 处 + `cursor_ide_watch.rs:82,128,146` 含可达 poisoned-mutex panic ❌ **(F-HIGH-9)**

### G. UI / 调试残留 / 安全

- [ ] **AC27** 无 TEMP DIAG 残留 — **5 文件 25 行**，其中 `imperativeApi.ts` 是每次输入触发的 `console.trace` ❌ **(F-CRIT-8)**
- [ ] **AC28** `dangerouslySetInnerHTML` 仅用于可信源 — 13 处，6 处需审计 sanitizer ⚠️ **(F-MED-6)**
- [ ] **AC29** 无 `console.log` / `as any` / `@ts-ignore` 在生产 — 1 个真实 `console.log` + 30+ `as unknown as` 在生产 src/ ⚠️
- [ ] **AC30** 文件大小 ≤ 1000 行 — FE 1 处违规；**BE 15+ 处超 1500 行，最大 `cursor_native/provider.rs` 3220 行** ❌ **(F-MED-7)**

---

## 二、Critical / High Findings 总览表

| ID        | 严重度   | 标题                                                                 | 位置                                                                                     | 反模式    |
| --------- | -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| F-CRIT-1  | Critical | UI 直接调 transport，绕过 FSM                                        | `useAgentControlPalette.ts:115`、`AgentErrorChatItem.tsx:114`                            | #21 / #53 |
| F-CRIT-2  | Critical | `src/coding_agent/` 整棵 orphaned module tree                        | `src-tauri/src/coding_agent/**`                                                          | #29 / #43 |
| F-CRIT-3  | Critical | `holdSessionQueueForStopAtom` shadow FSM phase                       | `store/ui/messageQueueAtom.ts:139,151` 等                                                | #19 / #51 |
| F-CRIT-4  | Critical | `SessionStatus` 4 套并存                                             | FE 1 处 + Rust 3 处                                                                      | #4 / #30  |
| F-CRIT-5  | Critical | 子 agent UI regex 与 Rust 前缀不匹配                                 | `subagentTracking.ts:38` vs `crates/types/src/session.rs:26`                             | #1 / #38  |
| F-CRIT-6  | Critical | `resolveFilePayload.ts` fallback 不对称（OPEN bug）                  | `resolveFilePayload.ts:49,64,76`                                                         | #10       |
| F-CRIT-7  | Critical | 启动 `unwrap_or_default` 把单行解码失败放大成全 session 文件历史删除 | `src-tauri/src/lib.rs:892`                                                               | #6 / #33  |
| F-CRIT-8  | Critical | 5 文件 25 行 TEMP DIAG 残留                                          | `ComposerInput/imperativeApi.ts:106-120` 等                                              | —         |
| F-HIGH-1  | High     | `launch_cli_agent` 静默丢弃 7 字段                                   | `launch.rs:290-309`                                                                      | #9 / #38  |
| F-HIGH-2  | High     | `userInitiatedCancelAtom` 多 concern atom                            | `cliSessionStatusAtom.ts:174-175`                                                        | #22 / #54 |
| F-HIGH-3  | High     | BE `CancelReason` 软校验                                             | `cli/commands.rs:498-500`                                                                | #11       |
| F-HIGH-4  | High     | `benchmark.rs` 10+ unregistered Tauri command                        | `src-tauri/src/benchmark.rs`                                                             | #2        |
| F-HIGH-5  | High     | `advanced-search` crate 内 5 个 struct 双定义                        | `tantivy_index.rs` + `commands/stubs.rs`                                                 | #29       |
| F-HIGH-6  | High     | `ApiError` 3 处定义（含同 crate 冲突）                               | `git-api/{types,error}.rs` + `api-search/error.rs`                                       | #30       |
| F-HIGH-7  | High     | `ProviderConfig` 跨 crate 同名不同语义                               | `key-vault` + `agent-core`                                                               | #30       |
| F-HIGH-8  | High     | 177 处生产 `unwrap()`                                                | 全 BE                                                                                    | #33       |
| F-HIGH-9  | High     | 7 处 poisoned-mutex / resolver-init panic 可达                       | `aggregation.rs`、`cursor_ide_watch.rs`                                                  | #33       |
| F-HIGH-10 | High     | `extractors.rs:341` `_ => None` 吃掉新枚举变体                       | `event_pipeline/extractors/extractors.rs:341`                                            | #1        |
| F-HIGH-11 | High     | `useWorkspaceChat.ts` 8 个 dispatch site 集中                        | `useWorkspaceChat.ts:198-503`                                                            | #21       |
| F-HIGH-12 | High     | 4 套 anti-pattern #43 schema 迁移 trail（pre-user-stage 可清理）     | `cli/mod.rs`、`session_snapshots.rs`、`session-persistence/schema.rs`、`housekeeping.rs` | #43       |

完整 Medium / Low / Info finding 见 [findings-detail.md](./findings-detail.md)。

---

## 三、子报告索引

| 报告                                               | 范围                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| [fe-audit.md](./fe-audit.md)                       | 前端审计 — `src/` + `types/` 10 层 + sweep + memory verification               |
| [be-audit.md](./be-audit.md)                       | 后端审计 — `src-tauri/` 10 层 + sweep + crate 列表                             |
| [cross-layer-audit.md](./cross-layer-audit.md)     | 跨层审计 — Tauri command matrix / Event enum / Init parity / Resolver / Schema |
| [findings-detail.md](./findings-detail.md)         | 全 Finding 详单（含 Medium / Low / Info）+ sweep tables                        |
| [naming-collisions.md](./naming-collisions.md)     | 23 处跨模块同名 struct 汇总 + 重载词 glossary                                  |
| [memory-verification.md](./memory-verification.md) | 33+ memory file 校验结果                                                       |
| [remediation-roadmap.md](./remediation-roadmap.md) | 整改路线图 + 可并行 PR slice                                                   |

---

## 四、Top-5 立即整改优先级

按 "ROI / 严重度 / blast radius" 排序：

1. **F-CRIT-7** — `src-tauri/src/lib.rs:892` 一行修复，blast radius 最大（误删全用户 file history）
2. **F-CRIT-5** — `SPAWNED_SESSION_RE` 与 Rust 前缀对齐（子 agent UI 静默坏掉的高概率）
3. **F-CRIT-2** — `rm -rf src/coding_agent/`（一棵不会编译的死树 + `osagent` 幽灵）
4. **F-CRIT-1** — 2 处 UI bypass 改回经 `useMessageDispatch`（防 FSM 绕过）
5. **F-CRIT-8** — 5 文件 25 行 TEMP DIAG（含每输入触发的 `console.trace`）

详细 Phase 化路线图见 [remediation-roadmap.md](./remediation-roadmap.md)。

---

## 五、审计自检 — 验收的"最高标准"

| 维度                                              | 状态                 | 证据                                                                          |
| ------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| 10 层全覆盖                                       | ✅                   | FE / BE / Cross-layer 三份子报告每层均有 finding                              |
| 反模式 #1–#54 全量对应                            | ✅                   | findings-detail.md 的反模式列                                                 |
| Sweep（grep 全代码库）而非 spot-fix               | ✅                   | 每个 finding 含 sweep status                                                  |
| 文件 / 行级证据                                   | ✅                   | 所有 finding 含 `path:line`                                                   |
| Memory 校验                                       | ✅                   | 33 个 memory file → ACCURATE / DRIFT / STALE / OPEN                           |
| 不编辑代码                                        | ✅                   | `git status` 验证工作区仍 clean                                               |
| 未跑全 `tsc --noEmit` / `cargo check --workspace` | ✅（按 memory 约定） | `workspace_tsc_noemit_preexisting_noise.md` + `workspace_cargo_check_slow.md` |
| 独立可并行的 PR slice                             | ✅                   | remediation-roadmap.md                                                        |

**审计时间**：~25 min（3 个并发 subagent + 主上下文 spot-check）
**生成文档总字数**：~28K（按子报告分文件，避免单文件超限）

---

## 六、给 review 看的一句话总结

> **整体架构方向是对的**（FSM 已上线、turn lifecycle 已抽出、wire 协议有 zod 层）；但 8 个 Critical 表明 **"反模式 #1–#54 是过去吃过的亏，现在的代码里还有 8 处复发"**。
> **没有任何一个 Critical 是新颖问题**——全部对应一条已写下的反模式 + 一份已存在的 memory file。整改路径清晰、可并行、Phase 1 仅 8 个 PR 即可清零 Critical。
