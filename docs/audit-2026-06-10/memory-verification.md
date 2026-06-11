# Memory file 校验 — 2026-06-10

3 个 explore subagent 与主上下文交叉校验。结论分为：

- ✅ **ACCURATE** — 与现况一致
- ⚠️ **PARTIAL** — 部分内容已变
- ❌ **STALE** — 全 stale，需重写
- 🔓 **OPEN** — 描述的 bug 仍未解决，diag 日志仍活
- ❌ **DRIFT** — memory 描述的契约/regex 与代码已脱钩

---

## 跨层 / 共享

| Memory                                            | 状态         | 备注                                                                                     |
| ------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `workspace_two_agent_execution_paths.md`          | ✅ ACCURATE  | 用户 chat = forked external CLI；agent-core turn_executor 仅 builtin subagents           |
| `workspace_agent_events_via_websocket.md`         | ✅ ACCURATE  | `websocket_handler.rs:284` `broadcast()` 双 dispatch；WS 是 debug tee                    |
| `workspace_tauri_command_registration.md`         | ✅ ACCURATE  | `handler_list.inc` + `build.rs` 注册；Tauri pinned `=2.10.3`                             |
| `workspace_agent_cli_crate_name_trap.md`          | ✅ ACCURATE  | `crates/agent-cli/` ≠ runtime；runtime 在 `src/agent_sessions/cli/`                      |
| `workspace_agent_exec_mode_display_wire_split.md` | ✅ ACCURATE  | picker 与 wire union 分离已落实                                                          |
| `workspace_subagent_ui_visibility_regex.md`       | ❌ **DRIFT** | `SPAWNED_SESSION_RE` 与 Rust 当前 `SUBAGENT_SESSION_PREFIX = "agent-"` 不匹配 → F-CRIT-5 |
| `workspace_packages_and_mobile_split.md`          | ✅ ACCURATE  | 4 holding；contrib/relay；mobile-remote                                                  |
| `workspace_ci_only_release.md`                    | ✅ ACCURATE  | 只有 release.yaml                                                                        |
| `workspace_env_keys_feature_map.md`               | ✅ PROBABLE  | 未直接验证                                                                               |
| `workspace_browser_standalone_fails.md`           | ✅ PROBABLE  | webpack 端口 1998 匹配                                                                   |
| `workspace_default_pinned_actions_gap.md`         | ❌ **STALE** | DEFAULT_PINNED 已 migrate；setup-repo 现为 builtin action + skill；gap 已闭合            |

---

## 前端 / UI

| Memory                                                 | 状态                                                                 | 备注                                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace_chatpanel_engine_panel_view_bloat.md`       | ⚠️ PARTIAL                                                           | StickyNotes 已删；6 misplaced 仍在 → F-MED-2                                                                                                                                                                                   |
| `workspace_tab_systems_inventory.md`                   | ✅ ACCURATE                                                          | 8 套 tab 系统                                                                                                                                                                                                                  |
| `workspace_force_send_queue_dispatch.md`               | ❌ **STALE 全部**                                                    | `showQueuedMessageOptimistically / forceSendPendingQueueAtom / isQueueRuntimeStillWorking / hasTurnBlockingRunningEventForSession / markQueueTurnSettled` 全部不存在；`useQueueDispatch.ts` 已基于 `turnLifecycle.ts` FSM 重写 |
| `workspace_composer_bar_shared.md`                     | ✅ ACCURATE                                                          | ComposerBar 仍 shared                                                                                                                                                                                                          |
| `workspace_chat_input_surfaces_matrix.md`              | ⚠️ PARTIAL                                                           | EditorArea max-height 已从 `(isChatPanel ? 140 : 300)` 改回 `(isChatPanelFullScreen ? 200 : 300)`                                                                                                                              |
| `workspace_terminalblock_loading_shimmer_weak.md`      | ✅ ACCURATE                                                          | 4 surface shimmer 全在                                                                                                                                                                                                         |
| `workspace_askquestion_streaming_returns_null.md`      | ✅ ACCURATE                                                          | `isStreaming` + `QuestionCardLoadingShell` 仍存                                                                                                                                                                                |
| `workspace_session_row_working_indicator_weak.md`      | ⚠️ 未深查                                                            | 未列为 OPEN                                                                                                                                                                                                                    |
| `workspace_inline_canvas_size_limit.md`                | ✅ ACCURATE                                                          | 本次审计写文档触发了同样的 18KB 截断                                                                                                                                                                                           |
| `workspace_a2ui_element_types.md`                      | ✅ ACCURATE                                                          | 未变                                                                                                                                                                                                                           |
| `workspace_create_plan_subagent_wiring_bug.md`         | ⚠️ 未在 FE 验证                                                      | BE 风险                                                                                                                                                                                                                        |
| `workspace_diff_app_vs_file_review_data_sources.md`    | ⚠️ 未深查                                                            |
| `workspace_workstation_placeholder_icons.md`           | ⚠️ 未深查                                                            |
| `workspace_source_control_sidebar_seam.md`             | ⚠️ 未深查                                                            |
| `workspace_workstation_pr_eligibility.md`              | ⚠️ 未深查                                                            |
| `workspace_pullrequest_i18n_key_missing.md`            | ⚠️ 未深查                                                            |
| `workspace_pinned_actions_bar_overflow.md`             | ⚠️ 未深查                                                            |
| `workspace_composer_pill_context_prefix_extension.md`  | ⚠️ 未深查                                                            |
| `workspace_dom_element_pill_json_shape.md`             | ⚠️ 未深查                                                            |
| `workspace_user_chat_item_truncation.md`               | ⚠️ 未深查                                                            |
| `workspace_editor_area_max_height.md`                  | ⚠️ 未深查；可能与 `workspace_chat_input_surfaces_matrix.md` 漂移有关 |
| `workspace_chat_markdown_table_overflow.md`            | ✅ 历史性 finding                                                    |
| `workspace_chatpanel_chat_block_content_typography.md` | ⚠️ 未深查                                                            |
| `workspace_chat_block_header_scope_trap.md`            | ⚠️ 未深查                                                            |
| `workspace_composer_input_compact_nowrap.md`           | ⚠️ 未深查                                                            |
| `workspace_plan_todo_pinbar_resurrect.md`              | ✅ FIXED 标记                                                        |
| `workspace_subagent_card_failed_flash.md`              | ✅ FIXED 标记                                                        |
| `workspace_interactions_tab_bubble_shrink.md`          | ✅ FIXED 标记                                                        |
| `workspace_terminalblock_loading_shimmer_weak.md`      | ✅ FIXED                                                             |
| `workspace_session_row_working_indicator_weak.md`      | ✅ FIXED                                                             |

---

## OPEN bug（diag 日志仍活）

| Memory                                        | 状态          | TEMP DIAG 位置                                                                                                                                       |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_mode_switch_clears_draft.md`       | 🔓 OPEN       | `[draft-bug]` 在 `ModePill.tsx:141-142`、`useInputArea/index.ts:359,366,380,397,408`、`ComposerInput/imperativeApi.ts:106,119`（含 `console.trace`） |
| `workspace_workstation_toggle_right_blank.md` | 🔓 OPEN       | `[ws-blank-diag]` 在 `AppLayout.tsx:206,219`                                                                                                         |
| `workspace_sessionreplay_file_blank.md`       | 🔓 OPEN       | `[file-blank]` 在 `resolveFilePayload.ts:49,64,76,85`                                                                                                |
| `workspace_message_reference_cards_drift.md`  | ⚠️ 部分 stale | `MessageReferenceCards.tsx:62` 已 emit `git_commit` — 实现可能与测试对齐了；需 vitest 确认                                                           |

---

## 后端

| Memory                                       | 状态                                                                                            | 备注 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| `workspace_cargo_check_slow.md`              | ✅ 接受（未重测）                                                                               |
| `workspace_cargo_package_underscore_name.md` | ✅ ACCURATE                                                                                     |
| `workspace_tauri_command_registration.md`    | ✅ ACCURATE                                                                                     |
| `workspace_two_agent_execution_paths.md`     | ✅ ACCURATE                                                                                     |
| `workspace_agent_events_via_websocket.md`    | ✅ ACCURATE                                                                                     |
| `workspace_dead_code_scan_landscape.md`      | ✅ FE 视角接受；BE 新增 2 树（coding_agent / benchmark）— 建议增 `workspace_be_dead_modules.md` |
| `workspace_tsc_noemit_preexisting_noise.md`  | ✅ 遵守（未跑全 tsc）                                                                           |

---

## 流程 / feedback memory

| Memory                                              | 状态                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `feedback_audit_before_commit.md`                   | ✅ 遵守 — 已加 scope 清单、不动 untracked、用 cursor skill 12 类输出 |
| `feedback_audit_split_skill_workflow.md`            | ✅ 遵守 — 本次属于 audit 单 deliverable，未走 split-to-prs           |
| `feedback_terse_choice_decisive.md`                 | ✅ 遵守 — 用户开放式指令直接做最具体的事                             |
| `feedback_explain_architecture_findings_plainly.md` | ✅ 遵守 — 提供分层 README + 子报告 + 优先级 + 验收清单               |
| `feedback_stop_speculating_add_diagnostic.md`       | ✅ 遵守 — 未对 OPEN bug 重新推测，建议保留 diag 日志等用户复现       |
| `feedback_verify_subagent_cross_cutting_claims.md`  | ✅ 遵守 — 3 subagent 报告差异由主上下文验证                          |
| `feedback_refactor_plan_shape.md`                   | ✅ 遵守 — Phase + 独立 slice + 显式 not-in-scope                     |
| `feedback_plan_mode_research_budget.md`             | N/A — 本次非 plan mode                                               |
| `feedback_disambiguate_screenshot_bugs_early.md`    | N/A                                                                  |
| `feedback_clarify_then_verify_refactor.md`          | N/A — 仅 audit，未 refactor                                          |
| `feedback_scope_tiers_for_global_changes.md`        | N/A — 用户直接说"全局"                                               |
| `feedback_parallel_explore_for_repo_overview.md`    | ✅ 遵守 — 派 3 subagent                                              |
| `feedback_cite_code_not_comments.md`                | ✅ 遵守 — 所有 finding 引代码位置                                    |
| `feedback_jsx_classname_template_space.md`          | N/A                                                                  |
| `feedback_tsx_ternary_jsx_parse_trap.md`            | N/A                                                                  |
| `feedback_flag_unverifiable_runtime_ui.md`          | ✅ 适用 — 本审计未跑 WebView 验证                                    |
| `feedback_askuser_timeout_proceed.md`               | N/A                                                                  |
| `feedback_plan_mode_post_approval.md`               | N/A                                                                  |

---

## 建议 memory 更新清单

| Memory                                                      | 动作                 | 说明                                                                           |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `workspace_subagent_ui_visibility_regex.md`                 | **重写**             | 与 Rust 前缀 drift；附上当前 regex + Rust 常量 + 修复路径                      |
| `workspace_default_pinned_actions_gap.md`                   | **删除或归档**       | gap 已闭合；DEFAULT_PINNED 已 migrate                                          |
| `workspace_force_send_queue_dispatch.md`                    | **重写**             | 全 stale；新内容应基于 `turnLifecycle.ts` FSM + `useQueueDispatch.ts` 当前实现 |
| `workspace_chat_input_surfaces_matrix.md`                   | **校准**             | EditorArea max-height 数字已变                                                 |
| `workspace_chatpanel_engine_panel_view_bloat.md`            | **校准**             | StickyNotes 已删；6 misplaced 仍在                                             |
| `workspace_message_reference_cards_drift.md`                | **校验后归档或更新** | 跑 vitest 看实现是否已对齐 test                                                |
| **新增** `workspace_be_dead_modules.md`                     | **创建**             | 记录 `coding_agent/` orphan 树 + `benchmark.rs` 未注册                         |
| **新增** `workspace_session_status_quadruple_definition.md` | **创建**             | 4 套 SessionStatus，附 4 处行号 + 统一方案                                     |
| **新增** `workspace_naming_collisions_23.md`                | **创建**             | 跨 crate 同名 struct 23 处汇总                                                 |
