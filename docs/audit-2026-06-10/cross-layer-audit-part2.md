# 跨层架构审计 — Part 2（Sweep / Memory / 验收）

接 [cross-layer-audit.md](./cross-layer-audit.md)。

---

## 跨层 Sweep

### 同时出现在 FE / BE 的 magic string（候选单源生成）

| 字符串                                                                                               | FE 处                                                                                                                                                                 | BE 处                                                                                | 应该是                      |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `"running" / "completed" / "failed" / "cancelled"` …                                                 | `types/session/session.ts:28`、`WorkItems/constants.ts:57`、`TaskKanban/config.ts:175`、`AgentOrgOverviewPanel.tsx:34`、`AgentOrgTaskList.tsx:19`（**5 处 FE 重复**） | `agent-core/.../enums.rs:62` (`as_str`)、`agent_sessions/unified_stats/status.rs:13` | Rust → TS 生成的 const 模块 |
| `"build" / "ask" / "plan" / "debug" / "review" / "wingman"`                                          | `config/sessionCreatorConfig.ts:70`                                                                                                                                   | `enums.rs:172` `AgentExecMode::as_str`                                               | 同                          |
| `"code_session.activity"`、`"agent:tool_call"` …                                                     | `cliAdapter.ts:858+`、多测试                                                                                                                                          | `cli/commands.rs:168,283,…`、agent-core                                              | EventType 生成              |
| `"own_key"`、`"hosted_key"`                                                                          | `api/tauri/session.ts` (KEY_SOURCE)                                                                                                                                   | `cli/types.rs::KeySource::parse`                                                     | 单源                        |
| `"rust_agent"`、`"cli_agent"`（session category）                                                    | `api/tauri/session.ts` (DISPATCH_CATEGORY)                                                                                                                            | `launch.rs:118-120` (SESSION*CATEGORY*\*)                                            | OK — 双端 const，未生成     |
| `"cliagent-"`、`"sdeagent-"`、`"osagent-"`、`"wingman-"`、`"agent-"`、`"shadow-"`（session id 前缀） | `src/util/session/sessionCategory.ts`                                                                                                                                 | `crates/types/src/session.rs:7-32`                                                   | 生成 TS const from Rust     |
| Cancel reasons `"user_stop"`、`"force_send"` 等                                                      | `api/tauri/agent/session.ts:42-48`                                                                                                                                    | `agent-core/src/state/control_flow.rs::CancelReason`                                 | 生成 / zod-validate         |

**结论**：`rpc/zod` layer 已覆盖 shape 验证但不约束 value sets。`core-types/wire` 生成步骤已在 `CliAgentType`（`resolveKeys.ts:9`）用过 — 模式存在，只是没扩展到上述项目。

### kebab-case / snake_case IPC 参数

无漂移。两边一致用 camelCase：Rust 结构 `#[serde(rename_all = "camelCase")]`，FE JS keys camelCase。`launch.rs:86` 含 `#[serde(alias = "additional_directories")]` 单一防御别名。Tauri 内置自动 snake↔camel 处理 ✅。

### localStorage / sessionStorage vs SQLite

| FE storage key                                     | 内容                                          | BE 列                                   | 漂移      |
| -------------------------------------------------- | --------------------------------------------- | --------------------------------------- | --------- |
| `orgii:pinnedActions`（`pinnedActionsAtom.ts:48`） | 用户 pinned slash items                       | 无                                      | OK        |
| `orgii:dispatch:*` / agentCategory                 | 上次 picker 选择                              | `agent_sessions.dispatch_category` etc. | ⚠️ 未深查 |
| Agent definitions                                  | None on FE                                    | `agent_definitions` 表                  | OK        |
| Settings                                           | None on FE（BE 拥有 ~/.orgii/settings.jsonc） | –                                       | OK        |

**无 duplicate-truth-of-source 漂移**（采样范围内）。

### DEFAULT_PINNED 列表（memory 校验）

`src/store/session/pinnedActionsAtom.ts:28`：

- `"Setup Repo"`（category `action`、source `builtin`）— **builtin action**，非 slash skill
- `"manage-skills"`（skill）— **shipped as builtin** at `crates/agent-core/src/intelligence/skills/builtin_data/manage-skills/SKILL.md`
- `"manage-agents-and-orgs"`（skill）— **shipped as builtin** at same path

`migrate()`（line 56-60）**清理**老用户 localStorage 中遗留的 `setup-repo` skill 入口。

**Memory `workspace_default_pinned_actions_gap.md` STALE** — 描述的 gap 已闭合。

### Skill IDs

- `setup_repo`（下划线）— Rust 端 tool/event 名（`agent:setup_repo_update`）
- `setup-repo`（连字符）— slash command skill
- 两套独立标识，相似名 — memory 已记录，目前无 collision。

---

## Memory file 校验（cross-layer 视角）

| 文件                                              | 判定                                          | 证据                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_two_agent_execution_paths.md`          | ✅ **ACCURATE**                               | `agent_sessions/cli/commands.rs` 是生产 user chat；`agent-core::turn_executor` 只驱动 builtin subagent。验证：`session_launch_impl → launch_cli_agent → cli_agent_create → session_runner::run_session` |
| `workspace_agent_events_via_websocket.md`         | ✅ **ACCURATE**                               | `websocket_handler.rs:284` `broadcast()` 调 `dispatch_to_channels`（主路径）+ `WS_BROADCASTER.send`（debug tee）。`MAX_CONSECUTIVE_FAILURES = 3`（line 40）。`subscribe_session_events` line 377        |
| `workspace_tauri_command_registration.md`         | ✅ **ACCURATE**                               | `handler_list.inc` 1159 行；`build.rs:32-45` `tauri::generate_handler!`；Tauri pinned `=2.10.3`（`package.json:83`）                                                                                    |
| `workspace_agent_cli_crate_name_trap.md`          | ✅ **ACCURATE**                               | `crates/agent-cli/` 是配置；runtime 在 `src/agent_sessions/cli/`。`handler_list.inc:755`（config）+ `:476`（runtime）双注册                                                                             |
| `workspace_agent_exec_mode_display_wire_split.md` | ✅ **ACCURATE**                               | `config/sessionCreatorConfig.ts:60-85` 用 `ALL_AGENT_EXEC_MODES` 强制 split；Rust `AgentExecMode::parse`（`enums.rs:191`）拒绝未知                                                                      |
| `workspace_subagent_ui_visibility_regex.md`       | ⚠️ **DRIFT / STALE**                          | regex `(?:agentsession                                                                                                                                                                                  | subagent)-`与 Rust`SUBAGENT_SESSION_PREFIX = "agent-"`（`crates/types/src/session.rs:26`）**完全不匹配**。子 agent UI nesting 可能静默坏。**HIGH severity 如果确认** |
| `workspace_packages_and_mobile_split.md`          | ✅ **ACCURATE**                               | `packages/README.md` 4 个 holding；root `package.json` 无 `workspaces`；`contrib/relay/` 有 Dockerfile + systemd unit；`crates/mobile-remote/` + `crates/orgii-mobile-relay/`                           |
| `workspace_ci_only_release.md`                    | ✅ **ACCURATE**                               | `.github/workflows/` 仅 `release.yaml`                                                                                                                                                                  |
| `workspace_env_keys_feature_map.md`               | ✅ **PROBABLE**（未直接验证 .env 加载器）     |
| `workspace_browser_standalone_fails.md`           | ✅ **PROBABLE**（webpack dev 端口 1998 匹配） |
| `workspace_default_pinned_actions_gap.md`         | ❌ **STALE**                                  | DEFAULT_PINNED 已经不再 pin `setup-repo` skill；`migrate()` 清理老入口；setup-repo 现为 builtin **action**，也作为 builtin skill 提供                                                                   |

---

## 跨层 Acceptance Criteria 自检

- [x] Wire 协议 matrix ≥ 20 个命令 × {args 漂移、return 漂移、错误、判定} — done
- [x] Init parity matrix 覆盖所有 session-create 入口 — done；F-HIGH-1 flagged
- [x] Resolver symmetry matrix — done；agent_org_id 非对称 flagged
- [x] Status / Mode / Event enum 对齐 — done；4 FE-only + 1 BE-only paused collapse on CLI
- [x] SQLite schema vs FE assumption — done；FE 不直接读 schema（好）；BE F-HIGH-12 anti-pattern #43 工业级残留
- [x] Magic string 单源分析 — done；6 类列出
- [x] Memory file 校验 — 1 STALE / 1 DRIFT / 9 ACCURATE
- [x] verified-vs-memory-claim 区分 — done
- [x] file:line 引用 — done
- [x] 无文件修改 — confirmed

---

## 待深查（"needs deeper investigation"）

1. `cli_agent_resume`（`commands.rs:592`）全体读取，确认是否真的缺 `ensure_cli_account_key_fresh` + proxy_token 重新分配（涉及 ~30 行额外阅读）。
2. `agent_send_message` 全签名，跨层 shape 由 zod gate 防护，漂移概率低 — 但未深查。
3. Standalone bins（`bin-gateway-chat-cli` 等）的 rustls 安装与 env 一致性。
4. `extract_session_id` 静默 drop：需逐 agent 事件类型确认是否 always 含 `session_id`。
