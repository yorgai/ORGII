# 后端架构审计 — 2026-06-10

**范围**：`src-tauri/src/`、`src-tauri/crates/`（43 个 sub-crate）、`build.rs`、`proto/`、`model/`
**约束**：read-only；不跑全 `cargo check`（按 `workspace_cargo_check_slow.md`，~2m30s）
**方法**：架构-audit skill 10 层 + 反模式 #1–#54 sweep
**入口追溯起点**：`src-tauri/src/lib.rs`、`src-tauri/src/commands/handler_list.inc`（1159 行 / ~900 命令）

---

## Executive summary

> Top 5（按严重度）：
>
> 1. **`src-tauri/src/coding_agent/` 整棵树 orphaned** — 未在 `lib.rs` 声明，含 broken `use crate::osagent::*`；revival 需重写。
> 2. **`benchmark.rs` 10+ `#[tauri::command]` 未注册到 `handler_list.inc`** — 命令对 FE 不可达；模块仍在 `pub mod`。
> 3. **`ProviderConfig` 跨 crate 同名不同语义** — `key-vault` 与 `agent-core` 内含完全不同的字段集。
> 4. **`extract_session_id` 静默吞 agent 事件** — IPC 分发回退路径，事件没有 `session_id` 字段时直接 drop。
> 5. **`lib.rs:892` 一行 `unwrap_or_default` → 整个用户 file-history 被删** — 一次解码失败把空 Vec 当成"所有 session 都已孤立"。

---

## 层 1 — 编译正确性

按 memory 不跑全 `cargo check`（成本 ~2m30s）。Spot-check：

- `coding_agent/` 若加 `pub mod coding_agent;` 会编译失败（`use crate::osagent::*` 与 `crate::agent_core::compaction::CompactionState` 路径不存在）。
- `benchmark.rs` 编译通过，仅命令未注册。

---

## 层 2 — 死代码 / 重复

### F-CRIT-2 `src/coding_agent/` 整棵 orphaned

- 路径：`src-tauri/src/coding_agent/{mod.rs, commands.rs, config.rs, context.rs, modes.rs, permission.rs, persistence.rs, processor.rs, question.rs, tools.rs}`
- `lib.rs:69-73` 只声明 `agent_sessions / api / benchmark / cursor_ide_watch / infrastructure`，无 `coding_agent`。
- 含 10+ `#[tauri::command]`（`coding_agent_create`、`coding_agent_send_message`、`coding_agent_permission_response` 等）— 全部在 `handler_list.inc` 零引用。
- 含 broken `use crate::agent_core::compaction::CompactionState;`（line 33）和 `crate::osagent::providers::create_provider`（line 180）— 这些路径在当前 crate 上不存在（`agent_core` 已抽到 workspace crate；`osagent` 已被重命名/删除）。
- **修复**：`git log` 确认它是否被 `agent_core::state::commands::session::` 替代；如是，`rm -rf`。

### F-HIGH-4 `benchmark.rs` 未注册命令

- 路径：`src-tauri/src/benchmark.rs`（2746 行）
- 含 10+ `#[tauri::command] pub async fn …`：`benchmark_swe_create_session`、`benchmark_swe_run_session`、`benchmark_terminal_create_session` 等（行 331、354、362、384、402、458、470、502、642、657、…）
- `rg "benchmark::" handler_list.inc` → 0 hits。
- **修复**：选择 a) 注册命令；b) `git blame` 确认是否已被废弃，删模块。

### F-HIGH-5 `advanced-search` crate 同 crate 5 struct 双定义

- 路径：`crates/advanced-search/src/commands/stubs.rs` + `crates/advanced-search/src/tantivy_index.rs`
- `SearchHit`、`MatchingLine`、`IncrementalResult`、`TantivyIndexStats`、`TantivyIndexInfo` — 同 crate 内 2 处定义。
- 反模式 #29 + #30 直接命中。

### F-HIGH-6 `ApiError` 3 处定义

- `git-api/src/types.rs` + `git-api/src/error.rs` — **同 crate 内冲突**
- `api-search/src/error.rs` — 第 3 处

### F-HIGH-7 `ProviderConfig` 跨 crate 同名不同义

- `key-vault/src/provider_config.rs:12` — `{ api_key_env_var, base_url_env_var, supports_base_url, default_base_url }`：FE settings UI 的"如何显示 provider env vars" 描述
- `agent-core/src/core/providers/traits.rs:360` — `{ api_key, api_base, extra_headers, is_azure }`：runtime credential payload
- **修复**：`key_vault::ProviderEnvDescriptor` + `agent_core::ProviderClientConfig`

### Info：cargo-machete allow-list 仅覆盖 3 个 macro-only crate

- `src-tauri/Cargo.toml:170-171` 列了 `agent_cli / cursor_bridge_app / db_clients`
- 实际 macro-consumed crates ~15 个（`browser / git / lsp / perf_utils / system_services / db_browser / terminal / test_runner / mobile_remote / inbox / dev_record / key_vault / project_management / session_persistence / container / ui_indexer / file_ops / git_api / api_search`）— allow-list 不全；machete 若开启会噪声爆炸。

---

## 层 3 — 命名一致性

- `osagent` 幽灵：`coding_agent/mod.rs:180` 引用 `crate::osagent::providers::create_provider`，`lib.rs:476` EnvFilter 默认 `app_lib::osagent=debug`。
- `AgentVariant::` 在 `src-tauri/src/` 0 hit；rename 在 runtime 侧完成 ✅。
- `agent_sessions/cli` ≠ `crates/agent-cli`：memory `workspace_agent_cli_crate_name_trap.md` 已记录。

---

## 层 4 — 语义重载（BE）

| 词          | 含义数 | 主要位置                                                                                                                                                                                                     |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session`   | **8**  | CLI 子进程 / Rust agent / IPC subscribe / PTY / LSP / wingman / cursor-bridge / browser webview                                                                                                              |
| `agent`     | **8**  | `AgentDefinition`（config）/ `ResolvedAgent`（runtime）/ `AgentAppState`（Tauri singleton）/ `AgentSession`（session_runtime.rs:105）/ `AgentRunTarget` / "CLI agent" 子进程 / `AgentKind` enum / `AgentOrg` |
| `gateway`   | 4      | `agent_core::integrations::gateway::commands::gateway_start` / Azure-OpenAI as gateway / `bin-gateway-chat-cli` / mobile-remote-relay 说的 gateway                                                           |
| `provider`  | 4      | `LLMProvider` trait / `ProviderConfig` ×2 / `key_vault::provider_config` / `rustls::default_provider`（TLS）                                                                                                 |
| `runtime`   | 4      | `coding_agent::SessionRuntime`（dead）/ `tokio::runtime::Runtime` / "CLI runtime" / `tauri::async_runtime`                                                                                                   |
| `config`    | 6+     | `CodingAgentConfig`（dead）/ `CodingAgentSession` config / `IntegrationsConfig`（disk JSON）/ `agent_core::config::*` / `ResolvedAgent`（"config"）/ `handler_list.inc` doc 说 "command list config"         |
| `manager`   | 8      | `QuestionManager / PermissionManager / RepoWatchManager / LspManager / McpManager / IndexManager / BridgeSupervisor / SessionStoreManager`                                                                   |
| `handler`   | 6      | `websocket_handler.rs`（文件名）/ `handle_socket`（axum）/ `handler_list.inc`（Tauri commands）/ `mobile_remote_host` / `MemberShutdownHook` / `channel_handler/`                                            |
| `broadcast` | 4      | `websocket_handler::broadcast`（实为 dispatch to channels）/ `tokio::sync::broadcast::channel` / `git::hooks::register_websocket_broadcast` / `agent_core::bus::broadcast_event`                             |
| `bridge`    | 6      | `agent_core_bridge` ×3 / `git_api::lineage_bridge` / `session_bridge` / `cursor_bridge`                                                                                                                      |

---

## 层 5 — 默认分支（生产）

总 `_ =>` 匹配 ~90 处，多数 match `serde_json::Value`（safe — Value 是 sealed）或 error 字符串（return Err）。需要审计的：

### F-HIGH-10 `extractors.rs:341` 吞新 `EventDisplayVariant`

- 路径：`agent_sessions/event_pipeline/extractors/extractors.rs:321-342`
- `match event.display_variant { Thinking|Message|Session|ToolCall|Error => …, _ => None }`
- 新 variant 加入后 FE 会收到 `extracted: None`，rendered 成 raw JSON。
- **修复**：删 `_ =>`，让编译器强制 exhaustive。
- **Sweep**：本文件含 6 处 `_ =>`（行 72、341、929、1143、1491、1558），全部需 exhaustive 化。

### Medium：`websocket_handler.rs:252 _ => /* Ignore */`

- 当前 `axum::extract::ws::Message` 是 exhaustive，安全。注释诚实标注。

---

## 层 6 — 跨域泄漏

### Medium：`agent-core` 内引用变体专属字面量

- `crates/agent-core/src/core/definitions/prefix_lookup.rs:136, 169` — `sdeagent-` 字面量
- `crates/agent-core/src/core/session/session_id.rs:29` — session id prefix
- `crates/agent-core/src/state/commands/channel_handler/slash.rs:168`
- `crates/agent-core/src/integrations/gateway/commands.rs:154`
- `crates/agent-core/src/core/providers/cursor_native/provider.rs:2009-2011` — provider-specific user-agent
- `crates/agent-core/src/core/tools/impls/coding/manage_todo.rs:560`
- **修复**：lift 到 `core-types::session`（memory 说已部分开始）。
- **Sweep**：11 字面量。

---

## 层 7 — 新开发者困惑

1. `cli_agent_create`（`cli/commands.rs:42`）签名是 `mut CreateCodeSessionParams → CodeSession`，但函数体 fork 子进程、创 worktree、写 3 张表。`mut` 暗示 in-place mutation 难从签名看出。
2. `websocket_handler::broadcast`（`api/websocket_handler.rs:284`）— 名字与文件名都"误导"，主要是 per-session IPC channel dispatch；建议 rename `dispatch_session_event`，留 `pub use` backward。
3. `app_lib::run()`（`lib.rs`）712 行同步 setup，12 个 `register_*` IoC 调用（行 387-441）。顺序约束在 type system 外，仅注释里写（line 426-430 警告 `register_session_event_extractor` 必须在第一次 event ingest 之前）。

---

## 层 8 — Wire 协议

- 17 处 schemars `derive(JsonSchema)`，无 `SchemaSettings::openapi3()`（反模式 #7 已避免 ✅）。
- `extract_session_id` fallback：`websocket_handler.rs` 内事件如缺 `session_id` 字段会被 dispatch 失败，需要逐事件审计是否 always 含。**待深查**。

---

## 层 9 — Init parity

| 入口                                           | 路径                                                                       | 步骤                                                                                      | 缺失                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Production `SessionCreator`                    | FE `buildSessionLaunchPayload` → `session_launch_impl` → category dispatch | auto-name / key resolve / mode / IDE context / work-item / worktree / persist / broadcast | OK                                                                            |
| Tauri `cli_agent_create`（E2E only）           | `cli/commands.rs:42`                                                       | worktree、proxy alloc                                                                     | 无 auto-name / IDE / work-item / agent-org（by design）                       |
| Resume `cli_agent_resume`（`commands.rs:592`） | re-spawn runner                                                            | –                                                                                         | **缺 `ensure_cli_account_key_fresh`** — Claude / Codex OAuth token 过期会失败 |
| Gateway HTTP `/agent/test/*`                   | `api/agent/test/workspace.rs:205` → `session_launch_impl`                  | ✅ 共享 slow path                                                                         |
| Standalone bins                                | `bin-*`                                                                    | 未审计 rustls 安装、env 一致性                                                            | **待深查**                                                                    |

### F-HIGH-1 `launch_cli_agent` 静默丢字段

- `launch.rs:265-309` 仅传 CLI-relevant 字段进 `CliLaunchParams`，**丢弃**：`agent_org_id`、`agent_org_member_overrides`、`apply_agent_org_member_overrides_for_future`、`work_item_id`、`agent_role`、`project_slug`、`agent_definition_id`。
- `launch_rust_agent` 保留全部 7 字段 → init parity 不对称。
- **修复**：要么 reject CLI + agent_org_id 组合（typed error），要么把 7 字段塞到 `CliLaunchParams`。

---

## 层 10 — Resolver 对称

见 [cross-layer-audit.md](./cross-layer-audit.md) 的 Resolver fallback matrix。BE 侧专属 finding：

### F-CRIT-7 `lib.rs:892` startup unwrap_or_default

- `let live = …unwrap_or_default();` — `SELECT session_id FROM agent_sessions` 任一行 decode 失败 → `Vec` 为空 → `prune_orphan_sessions(&[])` 把所有 session 当孤儿删除。
- **修复**：`Err` 分支 log + `return;`，不进入 prune。

### F-HIGH-9 `aggregation.rs` 4 处 `.expect("resolver initialized")`

- `unified_stats/aggregation.rs` 4 处 `.expect("agent metadata resolver initialized")` — 反模式 #33。若 IoC slot 未装就 panic。
- `cursor_ide_watch.rs:82, 128, 146` `.expect("WatchHandlesState mutex poisoned")` — 可达 poisoned-mutex 路径。

---

## Sweep 表

| Pattern                                | Hits                      | 主要位置                                                                                                                                                                                                                                           | 判定                       |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `unwrap()` 生产                        | **177**                   | 全 BE                                                                                                                                                                                                                                              | ❌ F-HIGH-8                |
| `expect("…must")` 生产                 | 多处                      | `aggregation.rs`、`cursor_ide_watch.rs`、`session_runner/session.rs:1981`                                                                                                                                                                          | ❌ F-HIGH-9                |
| `unwrap_or_default()` 生产             | ~95                       | hotspot：`cli/session_runner/session.rs`（7 处）、`extractors.rs`（~24 处）、`git_artifacts.rs`（9 处）、`benchmark.rs`（dead）、`lib.rs:892`                                                                                                      | ❌ F-CRIT-7 + 大量错误吞没 |
| `std::fs::*` 在 async                  | ~25                       | `agent_core_bridge.rs:168`（plan 读取）+ `cli/session_runner/session.rs`（18）                                                                                                                                                                     | ⚠️                         |
| `.build().unwrap_or` HTTP TLS          | 0                         | TLS 统一 `ring`（`lib.rs:450`）                                                                                                                                                                                                                    | ✅                         |
| `Arc::clone(&x)` before move-closure   | 12 检查                   | 全部正当（parent Arc 复用）                                                                                                                                                                                                                        | ✅                         |
| Raw SQL concat                         | 30                        | 全部是 `format!("Failed to update …")` 错误格式化                                                                                                                                                                                                  | ✅                         |
| 多步 DB write                          | `cli/commands.rs:125-164` | 有 best-effort rollback；返回值未消费                                                                                                                                                                                                              | Low                        |
| `schemars::` / `JsonSchema`            | 17+ derive                | 默认 draft07                                                                                                                                                                                                                                       | ✅                         |
| `ALTER TABLE` / `legacy` / `migration` | 多                        | `cli/mod.rs`、`session_snapshots.rs`、`schema.rs`、`housekeeping.rs`                                                                                                                                                                               | ❌ F-HIGH-12（反模式 #43） |
| 跨 crate 同名 struct                   | 23                        | 见 [naming-collisions.md](./naming-collisions.md)                                                                                                                                                                                                  | ⚠️                         |
| TODO / FIXME / LEGACY / deprecated     | 37                        | 散布；`cli/parsers/types.rs:57` 唯一 `#[deprecated]`                                                                                                                                                                                               | Low                        |
| 大文件 ≥ 1500 行                       | **15+**                   | 最大 `cursor_native/provider.rs` 3220、`e2e-test/agent_org.rs` 3167、`cli/session_runner/session.rs` 2838、`benchmark.rs` 2746、`api/agent/test/agent_org.rs` 2744、`inbox_drain/mod.rs` 2330、`agent_org_runs.rs` 2260、`prompt/sections.rs` 2153 | ❌ F-MED-7                 |
| cancel API 一致性（#50）               | 3 套                      | `coding_agent::cancel_flags`（dead）、`agent_session_cancel`（live）、`cursor_ide_watch::CancellationToken`                                                                                                                                        | ⚠️                         |

---

## Memory file 校验（BE 视角）

| Memory                                       | 校验结果                                                                                                     | 证据 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| `workspace_cargo_check_slow.md`              | ✅ 接受（未重测）                                                                                            |
| `workspace_cargo_package_underscore_name.md` | ✅ ACCURATE                                                                                                  |
| `workspace_tauri_command_registration.md`    | ✅ ACCURATE — `build.rs:32-45`；Tauri pinned `=2.10.3` 确认                                                  |
| `workspace_agent_events_via_websocket.md`    | ✅ ACCURATE — `websocket_handler.rs:284-297` `broadcast()` 调 `WS_BROADCASTER.send` + `dispatch_to_channels` |
| `workspace_two_agent_execution_paths.md`     | ✅ ACCURATE — `state/commands/session/launch.rs:118-122` category 分支                                       |
| `workspace_agent_cli_crate_name_trap.md`     | ✅ ACCURATE                                                                                                  |
| `workspace_ci_only_release.md`               | ✅ ACCURATE — `.github/workflows/` 仅 `release.yaml`                                                         |

---

## 重大遗留

- **Tauri 命令注册**：1159 行 `handler_list.inc`，无结构性 duplicate-name 检测（仅 macro 编译时检测，full `cargo check -p app` 慢）。建议 build-script lint diff。
- **PR CI 缺位**：memory `workspace_ci_only_release.md` 说明只有 release tag CI。3 个 finding（`coding_agent/` 死树、`benchmark.rs` 未注册、`lib.rs:892` 陷阱）若有基础 CI matrix 都会被发现。
- **`infrastructure/housekeeping.rs:218-226`** 启动时每次 DROP 7 张 legacy KG 表（`IF EXISTS`）— 反模式 #43；应记录 migration version 后只跑一次。
