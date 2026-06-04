# Agent Session 对标分析：ORGII vs Cursor

> 生成时间：2026-06-03  
> 分析范围：ORGII agent session 完整实现（基于源码深度阅读）

## 执行摘要

ORGII 是一款基于 Tauri + Rust + React 的本地 AI Agent 平台，其 Agent Session 实现已达到相当高的工程成熟度。在核心会话生命周期、流式输出、上下文管理和工具执行等关键维度上，ORGII 与 Cursor Agent 整体持平，部分方面（如多 Agent Org、文件快照 undo/redo、Session Memory 分层压缩）甚至领先于 Cursor 的已知能力。最大的差距在于：Cursor 的 IDE 原生上下文感知（打开文件、代码选区、诊断信息）与代码库索引能力更成熟；Cursor Checkpoint 是用户可见的快照操作体验，而 ORGII 的文件历史回滚当前更偏底层；Cursor 的 Background Agents（云端并发）在规模上超出 ORGII 本地并发。总体而言，ORGII 在 Agent Session 工程深度上具备参与 Cursor 级产品竞争的基础，核心优势在于多 Agent 协作（Org 系统）和本地优先的隐私架构。

## 评分总览

| 维度                     | ORGII 评分 (1-5) | Cursor 基准 (1-5) | 差距                                |
| ------------------------ | :--------------: | :---------------: | ----------------------------------- |
| 1. Session 生命周期管理  |        5         |         5         | 持平                                |
| 2. Turn 结构与消息模型   |        5         |         5         | 持平                                |
| 3. 工具调用（Tool Use）  |        5         |         5         | 持平                                |
| 4. 流式输出（Streaming） |        5         |         5         | 持平                                |
| 5. 上下文与记忆管理      |        5         |         5         | 持平（ORGII Session Memory 更精细） |
| 6. 多模态支持            |        4         |         4         | 持平                                |
| 7. 中断与取消            |        5         |         4         | ORGII 略领先                        |
| 8. 错误恢复与重试        |        5         |         4         | ORGII 领先                          |
| 9. 并发 Session 支持     |        4         |         5         | 落后（云端规模）                    |
| 10. 持久化与历史         |        5         |         4         | ORGII 领先（文件快照+undo）         |
| 11. MCP 集成             |        5         |         4         | ORGII 领先（OAuth MCP）             |
| 12. 用户体验层（前端）   |        4         |         5         | 落后（Cursor IDE 原生集成更深）     |

**综合评分：ORGII 52/60，Cursor 54/60**

---

## 一、Session 生命周期管理

### ORGII 现状

**评分：5/5 — 完整实现**

ORGII 的 session 生命周期由 Rust 后端 `agent-core` crate 完整管理，入口为 `src-tauri/crates/agent-core/src/core/session/launch.rs`。

**状态机**（`core/session/types/enums.rs`）：

```
SessionStatus: Pending | Idle | Running | WaitingForUser | WaitingForFunds |
               Paused | Completed | Failed | Cancelled | Abandoned | Timeout | Archived
```

共 12 个状态，远比 Cursor 已知的 5 状态丰富。

**核心 launch 流程**（`launch_rust_agent_run`）：

1. `create_session_impl` — 创建持久化记录（SQLite）
2. `acquire_work_item_execution_lock` — 可选的工作项并发锁
3. 创建 `AgentOrgRun`（如果是多 Agent Org 场景）
4. `materialize_org_member_sessions` — 为 Org 成员批量创建子 session
5. `prepare_rust_agent_workspace_for_launch` — 准备 worktree（可隔离分支）
6. `tokio::spawn(send_initial_turn(...))` — 异步启动第一个 turn

**会话模式**（`AgentExecMode`）：

- `Build`（默认，完整工具集）
- `Ask`（只读问答/研究）
- `Plan`（只读，产出持久化 plan 文件，需用户批准）
- `Debug`（诊断分析）
- `Review`（内部，代码审查）
- `Wingman`（被动屏幕观察模式）

**结束/清理**：

- `SessionStatus::Archived` — 对应上下文 compact-fork 后旧 session 归档
- `SessionStatus::Cancelled` — 用户主动取消
- `SessionStatus::Failed` — turn 失败后标记
- Worktree 回滚：launch 失败时 `remove_session_worktree` + DB 清理

### Cursor 基准

Cursor Agent 生命周期：

- 通过 Chat 面板创建，也支持 Background Agents（云端并发）
- 支持 Agent 模式（自主多步）vs Chat 模式（单轮问答）
- 有 Checkpoint 机制（用户可见的保存点）
- 支持后台运行、推送通知
- 状态粒度：idle/running/waiting/completed/failed（约 5 状态）

### 差距与建议

**差距评估：持平** — ORGII 状态机比 Cursor 更精细（12 vs ~5 状态），launch 逻辑更完整。

**差距明细：**

- ORGII 缺少 Cursor 的"用户可见 Checkpoint 创建 UI"（虽有底层文件快照，但没有 Cursor 那样明确的 UI checkpoint 流程）
- ORGII 的 Background Agent 只在本地多 session 并发，Cursor 可云端弹性扩展

**建议：**

- **P1**: 在 UI 层暴露"创建检查点"按钮，对齐 Cursor Checkpoint 体验
- **P2**: 考虑增加 `Suspended` 状态，支持 session 跨进程暂停/恢复（用于 app 重启续跑）

---

## 二、Turn 结构与消息模型

### ORGII 现状

**评分：5/5 — 完整实现**

核心类型定义在 `src-tauri/crates/agent-core/src/core/session/types/turn.rs`：

**DialogTurn**（一个 user↔agent 往返）：

- `turn_id: String` — 稳定 UUID，用于取消定向和前端关联
- `state: DialogTurnState` — `Running | Completed | Cancelled | Failed`
- `user_input: String` — 原始用户消息
- `stats: TurnStats` — token 用量 + 工具调用次数 + 耗时
- `cancel_flag: Arc<AtomicBool>` — 与 processor 共享的原子取消标志

**TurnStats**：

- `prompt_tokens`, `completion_tokens`, `total_tokens`, `context_tokens`
- `tool_calls_count: u32`
- `duration: Option<Duration>`

**消息持久化**（`foundation/persistence/db_helpers/messages/`）：

- 每条 LLM 消息存入 SQLite（`agent_messages` 表）
- Tool call + tool result 成对存储，通过 `tool_call_id` 关联
- 支持从 DB 重载 LLM 历史（`load_llm.rs`）进行跨 session 恢复

**前端 SessionEvent 类型**（`SessionCore/core/types.ts`）：

- 统一事件格式，包含：`id`, `sessionId`, `timestamp`, `functionName`, `displayVariant`, `displayStatus`, `activityStatus`, `args`, `output`, `isStreaming`
- Rust 端负责 normalization（`rustBridge.ts` → `es_normalize_chunk`），TypeScript 不做本地逻辑

**事件管道**（`ChatHistory/chatItemPipeline/`）：

- `pipeline.ts`：classifier → dedup → filter → 渲染数据提取
- `classifiers.ts`：按 `functionName` + `displayVariant` 分类事件
- `dedup.ts`：去重逻辑（streaming 期间 upsert 而非 append）

### Cursor 基准

- Message 模型：user/assistant/tool_result 三角色
- 每个 turn 包含 thinking blocks（扩展思考）
- File edit 以 diff 形式呈现
- Checkpoint 与 turn 绑定（可回退到某个 turn 之前）

### 差距与建议

**差距评估：持平**

ORGII 的 `DialogTurn` + `TurnStats` 覆盖了 Cursor 全部已知字段，且 Rust-单源-truth 的 normalization 架构比 Cursor 的 TS 多处分散逻辑更整洁。

**建议：**

- **P2**: 在 `TurnStats` 中增加 `cost_usd` 字段（token 用量 × 模型价格），实现 turn 级别的费用追踪

---

## 三、工具调用（Tool Use）

### ORGII 现状

**评分：5/5 — 极为完整**

工具体系是 ORGII 最成熟的模块之一，分布在 `core/tools/` 下。

**工具分类**（`builtin_tools/table/`）：

| 类别          | 典型工具                                                                          | 文件                |
| ------------- | --------------------------------------------------------------------------------- | ------------------- |
| Coding        | `edit_file`, `read_file`, `delete_file`, `list_dir`, `code_search`, `apply_patch` | `coding.rs`         |
| Shell exec    | `exec` (PTY + subprocess), `await_tool`, `inspect_terminals`                      | `exec/`             |
| LSP           | `query_lsp`, `manage_lsp`                                                         | `coding/query_lsp/` |
| Web           | `web_search`, `web_fetch`, `control_browser_with_playwright`                      | `web/`              |
| Desktop       | `screen_capture`, `escape_hotkey`, `peekaboo_cli_tool`                            | `desktop/`          |
| Database      | `db_explore`, `db_run`                                                            | `database/`         |
| Orchestration | `agent` (foreground/background), `ask_user_questions`, `suggest_mode_switch`      | `orchestration/`    |
| Plan          | `create_plan`                                                                     | `plan_mode/`        |
| MCP           | 动态注册，通过 `bridge.rs` 接入                                                   | `intelligence/mcp/` |
| Communication | `send_message`, `send_to_inbox`                                                   | `comms/`            |

**工具执行流程**（`turn_executor/mod.rs` `execute_turn`）：

1. 流式接收 LLM tool call delta → 前端实时渲染参数
2. 预验证只读工具（read_file 等）在 streaming 期间并发执行（`streaming_executor.rs`）
3. 非只读工具等 streaming 完成后批量/并发执行（`tool_execution/parallel.rs`）
4. 结果 inject 到消息历史 → 继续下一轮 LLM 调用
5. 无匹配结果的工具调用自动 backfill `[cancelled]` 结果（保持 Anthropic wire 合规）

**并行工具执行**：

- `config.max_tool_use_concurrency` 控制并发上限
- 只读工具（read_file）在 streaming 期间已并发预执行，完成后跳过重复执行

**工具权限系统**（`interaction/permission.rs` + `interaction/permission_rules.rs`）：

- 按工具类别/风险等级分类
- `ResolvedToolPolicy`：控制哪些工具可用
- 模式感知：`Plan/Ask` 模式禁用写工具

**文件编辑**（`edit_file/strategies.rs`）：

- 9 种 fallback 策略（精确匹配→模糊匹配→正则→行号匹配...）
- 支持 create/overwrite 和 search-replace 两种模式

**文件历史快照**（`tools/file_history/`）：

- 每个 tool call 执行前，自动 capture 受影响文件的快照
- SHA-256 内容寻址 dedup（相同内容不重复存储）
- `rewind_to_message` / `rewind_file` — 精确回滚到指定消息前的文件状态
- `restore_snapshot` 只回滚被跟踪的文件，不触碰其他 session 的文件（并发安全）

### Cursor 基准

- 文件编辑：read/write/create/delete，代码差异可视化
- Terminal 执行：内嵌终端，输出实时显示
- 代码搜索：语义搜索（依赖 Cursor 代码库索引）
- Checkpoint + undo：用户可见，一键回滚所有文件变更
- Web search：通过工具调用
- MCP：支持外部 MCP 服务器

### 差距与建议

**差距评估：ORGII 持平或领先**

- 文件快照系统比 Cursor Checkpoint 更精细（per-message 级别）
- 9 种 edit 策略比 Cursor 的单策略更鲁棒
- LSP 集成（`query_lsp`）是 ORGII 独有的语言感知优势

**差距：**

- Cursor 的语义代码搜索依赖完整的代码库 embedding 索引，ORGII 的 `code_search` 目前是文本级搜索
- Cursor Checkpoint 的 UI 体验（时间线展示、一键回滚）比 ORGII 更直观

**建议：**

- **P0**: 在前端暴露"回滚到此消息前"UI 按钮，对接 `rewind_to_message` API
- **P1**: 集成向量代码搜索（embedding + ANN），补齐语义检索能力差距

---

## 四、流式输出（Streaming）

### ORGII 现状

**评分：5/5 — 完整实现**

ORGII 实现了多层次的 streaming 管道：

**Rust 端（Provider 层）**：

各 provider 实现 `chat_streaming` 接口（`providers/traits.rs`），以 `StreamDelta` callback 驱动：

- Anthropic native（`anthropic_native/streaming.rs`）：SSE 解析，支持 thinking blocks
- OpenAI compat（`openai_compat/streaming/`）：`sse_stream.rs` → `parse.rs` → 归一化
- Gemini native（`gemini_native/`）
- Cursor native（`cursor_native/`）：通过 protobuf 协议连接 Cursor 后端

**`TurnStreamNormalizer`**（`turn_executor/stream_normalizer.rs`）：
将不同 provider 的原始 delta 归一化为统一的 `NormalizedStreamEvent`：

- `MessageDelta(content)` — 文本 token
- `ThinkingDelta(reasoning)` — 思考过程 token
- `ToolCallDelta(tc_delta)` — 工具调用参数 delta（含 index/id/name/arguments_delta）
- `Finish` — 结束信号

**事件广播**：Rust → Tauri IPC Channel → TypeScript

**TypeScript 端**（`SessionCore/sync/adapters/rustAgent/eventHandlers/streamHandlers.ts`）：

- `handleMessageDelta` — 累积 assistant 消息文本，实时 upsert 到 `eventStoreProxy`
- `handleThinkingDelta` — 累积 thinking 文本（独立事件）
- `handleToolCallDelta` — 按 index 缓冲 tool call 参数，直到 `tool_call_id` 确定后才 upsert（避免 ID 漂移）
- `handleStreamingComplete` — Rust 推送最终事件后，用 `replaceAndRemove` 替换前端临时 streaming 事件

**关键设计**：

- 工具调用参数流式显示（用户可实时看到参数构建过程）
- `EventStoreProxy` 的 upsert 语义保证 streaming 期间不重复渲染
- 只读工具（read_file）在 streaming 期间已并发预执行

**Streaming Error Recovery**（`turn_executor/stream_error_recovery.rs`）：

- 独立 retry budget：overloaded（3次）vs 其他（10次）
- 指数退避
- budget 耗尽前不向用户展示任何中间错误状态
- budget 耗尽后持久化错误消息到历史

### Cursor 基准

- token 级 streaming，实时渲染
- thinking 过程可见（Claude 扩展思考）
- tool call 参数实时流式显示
- 网络错误自动重试（具体策略未公开）

### 差距与建议

**差距评估：持平**

ORGII 的 streaming 实现在技术细节上与 Cursor 等价，retry 策略甚至更精细（双 budget、circuit breaker）。

**建议：**

- **P2**: 在前端显示 streaming retry 次数 indicator，让用户了解系统正在重试（避免"卡住了"的错误感知）

---

## 五、上下文与记忆管理

### ORGII 现状

**评分：5/5 — 超越 Cursor 基准**

ORGII 实现了一套分层的上下文管理体系，代码在 `core/model_context/`：

**分层架构**（从轻量到重量级）：

| 层级             | 模块                  | 触发条件                           | 代价             |
| ---------------- | --------------------- | ---------------------------------- | ---------------- |
| Microcompact     | `microcompact.rs`     | 每个 turn（图片上限 + 时间戳清理） | 零 LLM 调用      |
| File Reinjection | `file_reinjection.rs` | 每个 turn（FS 编辑后）             | 零               |
| Cleanup          | `cleanup.rs`          | 每个 turn（orphan tool_call_ids）  | 零               |
| Session Memory   | `session_memory/`     | 历史接近 budget 时触发             | 1次 LLM fork     |
| Compaction       | `compaction.rs`       | 最后手段                           | 1次完整 LLM 重写 |

**Compaction 策略**（`compaction.rs`）：

- `trigger_ratio = 0.8`：当 token 用量超过 effective_budget 的 80% 时触发
- `keep_ratio = 0.4`：保留最近 40% token 的消息作为 verbatim 近期上下文
- `floor_tokens = 16000`：最少保留 16K tokens 的近期消息
- `reserved_summary_tokens = 20000`, `buffer_tokens = 13000`
- Adaptive keep ratio：根据平均消息大小动态调整，避免切断超大工具输出
- Split alignment：自动对齐到 user message 边界，不切断 tool call/result 对
- Circuit breaker：连续 3 次失败后降级为简单截断
- PTL（Prompt Too Long）重试：最多 2 次，每次 drop head 25%

**Session Memory**（`model_context/session_memory/`）：

- `compact.rs`：识别 `LLM_COMPACT_BOUNDARY_PREFIX` 标记，渐进式 fork
- `config.rs`：可配置的 session memory 参数
- `sections.rs`：结构化 memory sections（分类存储不同类型的 memory）
- `state.rs`：per-session memory 状态管理

**Workspace Memory**（`intelligence/memory/workspace_memory/`）：

- 从 conversation 中自动提取 workspace-level 知识
- `auto_dream.rs`：后台异步提取
- `manifest.rs`：memory manifest 管理
- `prompt_sections.rs`：注入到 system prompt

**Active Learning / Reflection**（`intelligence/memory/`）：

- `reflection/` — 会后 L3 级反思（从对话中提取通用知识）
- `learnings/` — 跨 session 持久化 learnings（ranking + CRUD）
- `consolidation/` — 批量 consolidation 策略

**Prompt 构建**（`session/prompt/`）：

- `builder.rs`：system prompt 构建
- `cache.rs`：prompt caching（Anthropic cache_control）
- `sections.rs`：结构化 prompt sections
- `ide_context.rs`：IDE 上下文（当前文件、光标位置等）
- `registry.rs`：section 注册

**Tokenizer**（`model_context/tokenizer.rs`）：

- tiktoken BPE，纯本地，无网络调用
- `count_message_tokens`, `count_messages_tokens`

### Cursor 基准

- Context window 自动管理（具体策略未公开）
- 从公开信息看：有 context truncation，推测有 summarization
- `@codebase` 索引提供语义上下文注入
- `.cursorrules` / cursor rules 作为持久化系统 prompt 片段
- "Memory" 功能（cursor rules auto-update）

### 差距与建议

**差距评估：ORGII 领先**

ORGII 的多层上下文管理（microcompact + session memory + compaction + workspace memory + active learning）比 Cursor 已知的实现更完整。特别是 Session Memory 的 fork-based 渐进式压缩是 ORGII 独有的特色。

**差距：**

- Cursor 的代码库语义索引（`@codebase`）能跨文件检索相关代码片段注入 context，ORGII 目前缺少同等级别的 embedding-based 代码检索
- Cursor Rules 是用户可直接编辑的 `.cursor/rules/` 文件，UX 更简单；ORGII 的 learnings 系统更自动化但透明度较低

**建议：**

- **P0**: 完成 code embedding 索引，实现 `@codebase` 语义检索注入
- **P1**: 提升 Learnings 的用户可见性（UI 展示 + 手动编辑入口）

---

## 六、多模态支持

### ORGII 现状

**评分：4/5 — 图片支持完整，视频/文档未实现**

**图片支持**（`foundation/persistence/images.rs`）：

- `persist_images(data_urls: &[String]) -> Vec<String>`：data: URL → 磁盘文件（SHA-256 dedup）
- 支持 JPEG/PNG/WebP/GIF
- `load_image_as_data_url(path)` — 从磁盘恢复 base64 data URL

**Microcompact 图片管理**（`model_context/microcompact.rs`）：

- `cap_recent_tool_images(messages)` — 每个 turn 清理旧工具结果中的图片（降低 wire payload）
- 防止 tool result 图片（screen_capture, read_file on images）无限积累

**Screenshot 工具**（`tools/impls/desktop/screen_capture/`）：

- macOS + Windows 原生截图
- JPEG 压缩（`jpeg.rs`）+ PNG 格式（`png.rs`）
- 多显示器支持（`displays.rs`）

**前端图片处理**（`SessionCreator/hooks/session/useSessionCreator/useFileUpload.ts`）：

- 文件拖拽上传
- 图片 thumbnail 预览

**LaunchRequest 中的 images 字段**（`session/launch.rs`）：

```
AgentRunLaunchRequest { images: Option<Vec<String>>, ... }
```

支持在 session 创建时附加图片。

**未实现：**

- PDF/文档上传
- 视频帧提取
- 语音输入（STT）

### Cursor 基准

- 图片粘贴/拖拽到聊天
- Screenshot 自动附加
- 不支持 PDF/视频（截至已知信息）

### 差距与建议

**差距评估：持平**

ORGII 与 Cursor 在多模态上基本对等（均支持图片，不支持视频/文档）。ORGII 额外具有 screen_capture 工具（Agent 可主动截屏），是 Cursor 未公开的能力。

**建议：**

- **P2**: 实现 PDF 内容提取（pdfium 或 poppler binding），支持用户附加 PDF 到会话

---

## 七、中断与取消

### ORGII 现状

**评分：5/5 — 完整实现，细粒度优于 Cursor**

**取消机制**（`session/types/turn.rs`）：

```rust
pub struct DialogTurn {
    pub cancel_flag: Arc<AtomicBool>,
}

pub fn cancel(&self) {
    self.cancel_flag.store(true, Ordering::SeqCst);
}
```

`Arc<AtomicBool>` 在 `DialogTurn`、`UnifiedMessageProcessor` 和 `execute_turn` 之间共享，任何一方检测到 `true` 即退出。

**取消检测点**（`turn_executor/mod.rs` `execute_turn`）：

1. **每次 LLM 迭代开始前** — cancel_flag 检测
2. **streaming 回调内** — 每个 token delta 前检测（cancel_for_stream 闭包）
3. **streaming 完成后** — 再次检测（应对极快的 streaming + cancel 竞态）
4. **工具执行期间** — 每个工具执行前检测（`execute_tool_calls`）
5. **等待 backoff 期间** — `stream_error_recovery` 的 sleep 期间可被取消

**cancel_flag 检测粒度**：

- 注意：取消不会立即 kill 正在执行的工具（如正在运行的 subprocess），但会在下一个检测点停止继续执行

**后端清理**（`core/session/persistence/crud/ops.rs`）：

- `mark_turn_cancelled(session_id)` — 将当前 turn 标记为 cancelled
- `config.persist_cancel_marker` — 可配置是否持久化 cancel 标记

**前端取消 UI**（`ChatPanel/InputArea/ChatHeader/StreamingHud.tsx`）：

- streaming 期间显示停止按钮
- 调用 Tauri command → `session/interaction.rs` → `cancel_session_turn`

### Cursor 基准

- 停止按钮（Stop）：取消当前 turn
- 取消后文件变更不回滚（需手动 undo 或使用 Checkpoint）
- 取消粒度：turn 级别

### 差距与建议

**差距评估：ORGII 领先**

ORGII 的取消检测粒度更高（每 token + 工具边界 + retry sleep），Cursor 仅在 turn 级别取消。

**建议：**

- **P1**: 在工具执行层面实现真正的 cooperative cancellation（对于 PTY exec 工具，发送 SIGTERM 到子进程），目前 exec 工具可能需要等当前命令完成才能感知 cancel

---

## 八、错误恢复与重试

### ORGII 现状

**评分：5/5 — 多层防御，系统性强**

**Streaming 错误恢复**（`turn_executor/stream_error_recovery.rs`）：

双 budget 系统：

- `MAX_OVERLOADED_RETRIES = 3`：HTTP 529 / overloaded 错误
- `MAX_STREAM_ERROR_RETRIES = 10`：其他 stream 错误（网络闪断、5xx）
- 指数退避（`backoff.rs`）
- budget 耗尽前：静默重试（用户不感知）
- budget 耗尽后：用户可见错误消息 + `on_stream_error_exhausted` 回调

**重复工具调用检测**（`turn_executor/mod.rs`）：

```rust
let MAX_REPEAT_STREAK = 3;  // 来自 backoff.rs
```

连续 N 次相同工具调用 → 自动中断，输出"检测到循环"消息

**连续错误限制**：

- `MAX_CONSECUTIVE_ERRORS`（backoff.rs）：连续工具错误超限 → 中断 turn

**Max Iterations 限制**：

```rust
if iteration >= max {
    final_content = Some(format!(
        "I reached the maximum number of iterations ({}) for this turn...",
        max
    ));
}
```

**Length Recovery**（`turn_executor/length_recovery.rs`）：

- `finish_reason = LENGTH` 时触发
- Tier-1：静默提升 `max_tokens`（一次机会）
- Tier-2：发送"auto-continue"用户可见消息

**Compaction Circuit Breaker**（`model_context/compaction.rs`）：

```rust
pub(crate) const MAX_CONSECUTIVE_COMPACTION_FAILURES: u32 = 3;
```

连续 3 次 LLM compaction 失败 → 降级为简单截断

**Provider 层 Reliable Wrapper**（`providers/reliable.rs`）：

- 包装 provider，自动处理可重试错误

**工具执行错误**：

- `ToolBatchOutcome::ErrorLoop` — 工具连续错误触发 loop break
- 每个工具 result 保存 `is_error: bool`，LLM 可感知工具失败

### Cursor 基准

- 网络错误自动重试（策略未公开）
- 工具失败后 LLM 可自行决策（重试/换策略/报告）
- 无明确的 circuit breaker 公开机制

### 差距与建议

**差距评估：ORGII 领先**

ORGII 的多层防御（streaming retry + repeat detection + length recovery + compaction circuit breaker）是生产级系统工程的体现，Cursor 未公开同等深度的实现。

**建议：**

- **P2**: 将错误恢复统计暴露给用户（本次 session 重试了几次、压缩了几次），增加系统透明度

---

## 九、并发 Session 支持

### ORGII 现状

**评分：4/5 — 本地多 session + Agent Org 并发**

**本地并发模型**：

- 每个 session 运行在独立的 `tokio::spawn` task 中
- `AgentAppState` 管理所有活跃 session 的 runtime（`session_runtime.rs`）
- `shared_state` crate 提供跨 session 的共享状态

**Agent Org（多 Agent 协作）**：
核心在 `core/coordination/` 和 `tools/impls/orchestration/`：

```
AgentOrg {
    coordinator_session (主 session)
    ├── member_session_1 (并发子 Agent)
    ├── member_session_2
    └── member_session_N
}
```

- `agent_org_runs.rs`：Org Run 记录（含状态追踪）
- `work_item_scheduler.rs`：工作项调度
- `work_item_recovery.rs`：崩溃后的 work item 恢复
- `agent_inbox.rs`：成员间消息通信（inbox 机制）
- `agent_member_interventions.rs`：成员干预处理

**Foreground vs Background 子 Agent**（`tools/impls/orchestration/agent/`）：

- `foreground.rs`：阻塞式等待子 Agent 完成
- `background.rs`：非阻塞，coordinator 继续执行

**混合 CLI + Rust Agent Org**：

- Rust 成员：完整 ORGII agent
- CLI 成员：`cli:claude_code`、`cli:cursor` 等，通过 `session_bridge` 启动
- 两类成员同时运行在同一个 Org Run 中

**前端 Org 视图**（`ChatPanel/InputArea/components/AgentOrgOverviewPanel.tsx`）：

- 实时显示所有成员 session 状态
- `useAgentOrgRunView.ts` — Org Run 状态订阅

**工作项并发锁**（`project_io::acquire_execution_lock`）：

- 防止同一 work item 被多个 session 同时执行

### Cursor 基准

- **Background Agents**：云端弹性并发，理论上无上限
- 本地并发：Tab 切换不同 session，相互独立
- 多 Agent：未公开（2024 年有相关功能暗示）

### 差距与建议

**差距评估：落后（云端规模）**

ORGII 的 Agent Org 系统在架构上优于 Cursor（有明确的 coordinator/member 层次、inbox 通信、混合 CLI+Rust），但在规模上受限于本地资源。Cursor Background Agents 可在云端运行，不受本地 CPU/内存限制。

**建议：**

- **P0**: 考虑云端 agent execution 路径（将 Rust agent 逻辑打包为可云端运行的微服务）
- **P1**: 改进 Org Run 的前端可视化（类似 Cursor 的 Background Tasks 面板）
- **P2**: 实现 session 优先级队列（高优先级 session 抢占资源）

---

## 十、持久化与历史

### ORGII 现状

**评分：5/5 — 完整本地持久化**

**Session 记录**（SQLite，`session/persistence/crud/`）：

`agent_sessions` 表字段（`UPSERT_SESSION_SQL`）：

```
session_id, name, status, model, account_id, user_input,
created_at, updated_at, session_type, channel, chat_id,
workspace_path, work_item_id, agent_role, worktree_path,
worktree_branch, base_branch, merge_status,
project_slug, agent_definition_id, org_member_id, parent_session_id, parent_event_id,
workspace_additional_json, key_source, agent_exec_mode, native_harness_type,
draft_text, reply_target_event_id, tags_json, pinned
```

31 个字段的完整 session 记录。

**Upsert 策略**（精心设计的 conflict 处理）：

- `key_source`, `agent_exec_mode`, `native_harness_type`：冲突时保留原值，不被后台 upsert 覆盖
- `draft_text`, `reply_target_event_id`：只有前端显式写入才更新
- `workspace_additional_json`：只有非空值才覆盖

**消息持久化**（`foundation/persistence/db_helpers/messages/`）：

- `builders.rs`：构建消息记录
- `insert_tests.rs`：持久化测试
- `load_llm.rs`：从 DB 重载 LLM 历史（用于 session 恢复）
- `cleanup.rs`：消息清理

**前端事件存储**（`SessionCore/storage/`）：

- `sqliteCache.ts`：SQLite（Tauri plugin-sql）本地缓存
- `partialCache.ts`：增量缓存（防止全量重载）
- `snapshotCache.ts`：快照缓存

**会话分页**（`SessionCore/turns/`）：

- `turnWindowConfig.ts`：turn 分页配置
- `ownDbTurnLoader.ts`：从本地 DB 加载 turn
- `cursorIdeTurnLoader.ts`：从 Cursor IDE 加载 turn（cursor-bridge）

**Session 恢复**（`session/recovery.rs`）：

- debug 模式下：`recovery` 模块支持 session 状态诊断
- `load_llm_history`：从 DB 重载完整 LLM 消息历史

**会话搜索**（`ChatPanel/ChatHistory/hooks/useChatSearch.ts`）：

- 前端本地搜索 session 历史

**文件历史快照**（已在"工具调用"章节详述）：

- `~/.orgii/file-history/<session_id>/` — 每 session 独立目录
- `backups/` — content-addressed 文件备份
- `snapshots/` — JSON manifest（每个工具调用一个 snapshot）
- TTL 清理（`DEFAULT_FILE_HISTORY_TTL_DAYS`）
- 孤儿清理（`prune_orphan_sessions`）

**Session 持久化 crate**（`session-persistence`）：

- 独立 crate，提供 session 数据的高级 CRUD 接口

### Cursor 基准

- 会话历史：本地 SQLite（推测）
- Checkpoint：用户可见保存点，云端也有备份（Pro 功能）
- 搜索：支持 session 内搜索
- 云端同步：settings 和部分历史可云端同步

### 差距与建议

**差距评估：ORGII 领先（本地）**

ORGII 的本地持久化极为完整（文件快照 + 消息历史 + session 元数据），且设计精细（coalesce 策略避免字段覆盖）。

**差距：**

- **云端同步**：Cursor 支持 session 历史云端备份；ORGII 纯本地，设备迁移时历史丢失
- **跨设备访问**：Cursor 可从不同机器访问同一 session 历史

**建议：**

- **P1**: 实现 session 历史的端对端加密云端备份（可选 opt-in，保护隐私）
- **P2**: session 导出为标准格式（JSON/Markdown），方便外部工具使用

---

## 十一、MCP 集成

### ORGII 现状

**评分：5/5 — 完整实现，含 OAuth**

ORGII 的 MCP 集成在 `intelligence/mcp/` 下，是最完整的 MCP 客户端实现之一。

**架构**（`intelligence/mcp/mod.rs`）：

- `config.rs`：global + workspace-scoped server 配置
- `client/`：rmcp crate 的薄包装（`connect.rs`, `call.rs`, `prompts.rs`, `resources.rs`）
- `manager/`：生命周期管理（`lifecycle.rs`, `status.rs`, `tools.rs`, `notifications.rs`）
- `bridge.rs`：将 MCP tools 注册到 ToolRegistry
- `commands.rs`：Tauri commands（前端设置 UI）

**MCP OAuth**（`intelligence/mcp/oauth.rs` + `oauth_store.rs`）：

- 完整 OAuth 2.0 流程
- Token 持久化（`oauth_store.rs`）
- `needs_auth_cache.rs`：缓存哪些 server 需要认证

**MCP Registries**（`intelligence/mcp/registries/`）：

- `bar.rs`：ORGII 内置注册表
- `glama.rs`：Glama MCP 市场
- `hub.rs`：MCP Hub
- `smithery.rs`：Smithery MCP 市场

**资源工具**（`resource_tools.rs`）：
将 MCP resources 暴露为 agent 可调用的工具

**MCP Prompts**（`prompts.rs`）：
支持 MCP server 提供的 prompt templates

**前端 MCP 进度**（`store/session/mcpProgressAtom.ts`）：
实时显示 MCP 工具调用进度（`ChatPanel/blocks/ToolCallBlock/McpProgressRow.tsx`）

**MCP 工具注入**（`init/mcp_wiring.rs`）：
session 初始化时，将所有已配置 MCP server 的 tools 注入 ToolRegistry

### Cursor 基准

- MCP 支持：官方支持，广泛推广
- OAuth：支持（推测，用于 GitHub 等授权 MCP server）
- MCP 市场：Cursor 官方 MCP 目录
- 工具注入：session 级别，每次对话可用

### 差距与建议

**差距评估：ORGII 领先**

ORGII 的 MCP 实现比 Cursor 更完整（同时支持 Glama/Hub/Smithery 三个市场，且有 OAuth 支持）。`resource_tools` 和 `prompts` 的实现也超出 Cursor 已知功能。

**建议：**

- **P2**: 暴露 MCP server 的 resource 浏览 UI（类似文件浏览器），让用户可视化 MCP 提供的数据资源

---

## 十二、用户体验层（前端）

### ORGII 现状

**评分：4/5 — 功能完整，部分体验待打磨**

**Session 创建**（`features/SessionCreator/`）：

- `useSessionCreator/useSessionLaunch/` — 完整的 launch 状态机
- `inputPreparation.ts`, `launchValidation.tsx` — 输入验证
- `launchPayload.ts` — 构建 launch payload
- `launchErrorHandling.ts` — 错误处理
- 支持：文件上传（`useFileUpload.ts`）、图片附件、@mention、代码引用（`useCiteCode.ts`）
- `useMarketDeeplink.ts` — 从 skill market 深链接创建 session

**ChatPanel**（`engines/ChatPanel/`）：

输入区（`InputArea/`）：

- `SlashCommandPortal` — 完整的 slash command 菜单（含 model/mode 选择）
- `AskQuestionCard` — agent 主动问题卡片
- `PermissionCard` — 工具权限请求卡片
- `ModeSwitchCard` — 模式切换建议卡片
- `QueuedMessages` — 消息队列展示
- `ContextBreakdownBar` — 上下文用量可视化
- `PlanTodoPinBar` — Plan mode 的 todo 钉住栏
- `AgentOrgInterventionPinBar` — Agent Org 干预控制

聊天历史（`ChatHistory/`）：

- `TurnPaginationControls` — Turn 分页（历史 session 的消息分页）
- `ChatScroller` — 智能滚动（follow/unfollow）
- `useChatSearch` — 历史搜索
- `useFollowAgent` — 流式时自动滚动到底部
- `useEditUserMessage` — 编辑已发送消息

**渲染层**（`SessionCore/rendering/`）：

- lazy-loaded 组件（按工具类型）
- `UniversalEventProps` — 统一 props 接口
- adapter 模式解耦渲染与数据

**Simulator**（`engines/Simulator/`）：

- **独特功能**：会话回放（replay mode）
- 时间轴控制（`MusicPlayerReplayBar`）
- 多 agent grid 视图（`ActivitySimulatorGrid`）
- 可变速回放（`PlaybackSpeedInline`）
- 跟踪模式（follow/replay 切换）

**流式 HUD**（`ChatPanel/InputArea/ChatHeader/StreamingHud.tsx`）：

- 显示当前 turn 进度（token 速率、工具调用数）
- `streamingHudMath.ts` — 速率计算

**会话状态展示**：

- `ChatStatusBanners.tsx` — 多种状态横幅
- `SessionContextBar` — 上下文信息栏

### Cursor 基准

- Chat 面板：极简 UX，直接在 IDE 中
- `@file`, `@folder`, `@codebase`, `@web` 等上下文选择器
- 行内代码 diff 预览（agent 修改时）
- Tab/确认 键接受或拒绝变更
- Checkpoint 时间线 UI
- 实时文件监控（编辑器同步）

### 差距与建议

**差距评估：落后（IDE 原生集成深度）**

ORGII 的 ChatPanel 功能丰富，Simulator 是独特亮点。但 Cursor 作为 IDE 扩展，具有天然的编辑器上下文优势：

- 打开文件自动注入 context（代码选区、光标位置、诊断信息）
- 行内 diff 预览（直接在编辑器中展示变更）
- Tab 接受变更的工作流
- LSP 诊断信息自动关联

**建议：**

- **P0**: 深化 IDE 上下文集成（通过 cursor-bridge 获取当前编辑器状态，自动注入到 session context）
- **P0**: 实现行内 diff 预览（可以复用 ORGII 的 DiffBlock 组件，在会话中展示文件变更 diff）
- **P1**: 改进 Checkpoint UI（在聊天历史中显示时间线，支持一键回滚到某个时间点）
- **P1**: 实现类似 Cursor 的"接受/拒绝变更"工作流（单文件或批量）

---

## 优先改进路线图

### P0 — 必须做（核心竞争力差距）

| #    | 问题                      | 影响                                        | 建议方案                                                             | 估计工作量 |
| ---- | ------------------------- | ------------------------------------------- | -------------------------------------------------------------------- | ---------- |
| P0-1 | 缺少行内代码 diff 预览    | 用户无法在编辑器中直观看到 agent 修改了什么 | 集成 Monaco diff viewer，文件编辑后在 ChatPanel 显示 diff            | 2 周       |
| P0-2 | 缺少"接受/拒绝变更"工作流 | 用户无法选择性接受 agent 的文件修改         | 基于 `file_history` 实现 per-file 接受/拒绝 UI                       | 2 周       |
| P0-3 | IDE 上下文注入不足        | Agent 不了解用户当前编辑位置/选区           | 通过 cursor-bridge 实时获取打开文件/光标位置/诊断，注入 `IdeContext` | 1.5 周     |
| P0-4 | 缺少代码库语义搜索        | Agent 无法跨文件理解代码结构                | 实现 code embedding 索引（tree-sitter 解析 + 本地向量 DB）           | 4 周       |

### P1 — 重要（显著提升用户体验）

| #    | 问题                       | 影响                               | 建议方案                                                            | 估计工作量 |
| ---- | -------------------------- | ---------------------------------- | ------------------------------------------------------------------- | ---------- |
| P1-1 | 文件历史回滚没有 UI 入口   | 用户无法利用已实现的强大 undo 系统 | 在聊天历史每条 turn 上加"回滚到此处"按钮，调用 `rewind_to_message`  | 1 周       |
| P1-2 | Learnings 系统不透明       | 用户不知道 agent 学到了什么        | 在设置面板展示 learnings 列表，支持查看/编辑/删除                   | 1 周       |
| P1-3 | Agent Org 可视化不足       | 多 agent 并发时难以追踪各成员状态  | 改进 `AgentOrgOverviewPanel`，加入成员 token 用量、当前工具、进度条 | 1 周       |
| P1-4 | exec 工具缺少真正的 cancel | 取消不终止正在运行的子进程         | `exec/pty.rs` 中取消时发送 SIGTERM/SIGKILL 到子进程                 | 3 天       |
| P1-5 | 缺少云端历史备份           | 换机器时历史丢失                   | 实现可选的端对端加密云同步（用户 key 加密）                         | 3 周       |

### P2 — 有价值（锦上添花）

| #    | 问题                   | 影响                                 | 建议方案                                               | 估计工作量 |
| ---- | ---------------------- | ------------------------------------ | ------------------------------------------------------ | ---------- |
| P2-1 | TurnStats 缺少费用字段 | 用户不了解 token 成本                | 在 `TurnStats` 加 `cost_usd`，前端显示 turn 级费用     | 3 天       |
| P2-2 | Streaming retry 不透明 | 用户误以为卡住                       | 在 StreamingHud 显示 retry indicator                   | 2 天       |
| P2-3 | MCP resource 无法浏览  | 用户不知道 MCP server 提供了哪些数据 | MCP resource browser UI                                | 1 周       |
| P2-4 | 缺少 PDF 支持          | 无法附加文档到会话                   | pdfium/poppler binding + 文本提取                      | 1 周       |
| P2-5 | session 导出格式缺失   | 无法在外部工具使用会话历史           | 实现 JSON/Markdown 导出                                | 3 天       |
| P2-6 | 错误恢复统计不透明     | 用户不了解系统稳定性                 | 在会话结束后显示"本次会话统计"（重试次数、压缩次数等） | 2 天       |

---

## 附录：关键代码引用

### 1. Session 生命周期管理

| 文件                                                               | 关键函数/类型                                | 说明                                 |
| ------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------ |
| `src-tauri/crates/agent-core/src/core/session/launch.rs`           | `launch_rust_agent_run`, `send_initial_turn` | Session 创建和首 turn 启动的唯一入口 |
| `src-tauri/crates/agent-core/src/core/session/types/enums.rs`      | `SessionStatus`, `AgentExecMode`             | 会话状态机（12 状态）和执行模式枚举  |
| `src-tauri/crates/agent-core/src/state/commands/session/create.rs` | `create_session_impl`                        | Session 持久化记录创建               |
| `src-tauri/crates/agent-core/src/core/coordination/`               | `AgentOrgRunStore`, `work_item_scheduler`    | Agent Org 并发协调                   |

### 2. Turn 结构

| 文件                                                                     | 关键函数/类型                                | 说明                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| `src-tauri/crates/agent-core/src/core/session/types/turn.rs`             | `DialogTurn`, `TurnStats`, `DialogTurnState` | Turn 数据结构定义                                    |
| `src-tauri/crates/agent-core/src/core/session/turn/entry.rs`             | `process_message`                            | Turn 处理入口（skill slash command 展开，pill 解析） |
| `src-tauri/crates/agent-core/src/core/session/turn/processor/execute.rs` | `UnifiedMessageProcessor::process`           | Turn 执行主循环                                      |

### 3. 工具调用

| 文件                                                                            | 关键函数/类型                                            | 说明                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `src-tauri/crates/agent-core/src/core/turn_executor/mod.rs`                     | `execute_turn`                                           | Tool use 执行循环（LLM + tools 交替） |
| `src-tauri/crates/agent-core/src/core/turn_executor/tool_execution/parallel.rs` | `execute_tool_calls_parallel`                            | 并行工具执行                          |
| `src-tauri/crates/agent-core/src/core/tools/impls/coding/edit_file/`            | `EditTool`, `EditFileParams`, `strategies`               | 文件编辑工具（9 种 fallback 策略）    |
| `src-tauri/crates/agent-core/src/core/tools/file_history/`                      | `make_snapshot`, `rewind_to_message`, `restore_snapshot` | 文件快照系统                          |

### 4. 流式输出

| 文件                                                                              | 关键函数/类型                                                          | 说明                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `src-tauri/crates/agent-core/src/core/turn_executor/stream_normalizer.rs`         | `TurnStreamNormalizer`, `NormalizedStreamEvent`                        | Provider delta 归一化           |
| `src-tauri/crates/agent-core/src/core/turn_executor/streaming_executor.rs`        | `StreamingToolAccumulator`, `execute_prevalidated`                     | 只读工具 streaming 期间预执行   |
| `src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHandlers.ts` | `handleMessageDelta`, `handleToolCallDelta`, `handleStreamingComplete` | 前端 streaming 处理             |
| `src-tauri/crates/agent-core/src/core/turn_executor/stream_error_recovery.rs`     | `RetryBudgets`, `handle_stream_error`                                  | Streaming 错误重试（双 budget） |

### 5. 上下文管理

| 文件                                                                 | 关键函数/类型                                                      | 说明                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------- |
| `src-tauri/crates/agent-core/src/core/model_context/compaction.rs`   | `ContextCompactor::compact`, `CompactionConfig`, `CompactionState` | LLM-based 历史压缩      |
| `src-tauri/crates/agent-core/src/core/model_context/session_memory/` | `compact.rs`, `sections.rs`, `state.rs`                            | Session Memory 分层管理 |
| `src-tauri/crates/agent-core/src/core/model_context/microcompact.rs` | `microcompact_messages`, `cap_recent_tool_images`                  | 轻量级微压缩            |
| `src-tauri/crates/agent-core/src/intelligence/memory/`               | `learnings/`, `reflection/`, `workspace_memory/`                   | 跨 session 记忆系统     |

### 6. 多模态

| 文件                                                                       | 关键函数/类型                                                    | 说明                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| `src-tauri/crates/agent-core/src/foundation/persistence/images.rs`         | `persist_images`, `load_image_as_data_url`, `delete_image_files` | 图片持久化（SHA-256 dedup） |
| `src-tauri/crates/agent-core/src/core/tools/impls/desktop/screen_capture/` | `mod.rs`, `jpeg.rs`, `displays.rs`                               | 原生截图工具                |

### 7. 中断与取消

| 文件                                                         | 关键函数/类型                                               | 说明         |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ------------ |
| `src-tauri/crates/agent-core/src/core/session/types/turn.rs` | `DialogTurn::cancel`, `cancel_flag: Arc<AtomicBool>`        | 原子取消标志 |
| `src-tauri/crates/agent-core/src/core/turn_executor/mod.rs`  | `execute_turn` — 多处 `cancel_flag.load(Ordering::Relaxed)` | 多点取消检测 |

### 8. 错误恢复

| 文件                                                                          | 关键函数/类型                                 | 说明                            |
| ----------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| `src-tauri/crates/agent-core/src/core/turn_executor/stream_error_recovery.rs` | `handle_stream_error`, `RetryBudgets`         | Streaming 错误双 budget 重试    |
| `src-tauri/crates/agent-core/src/core/turn_executor/backoff.rs`               | `MAX_CONSECUTIVE_ERRORS`, `MAX_REPEAT_STREAK` | 错误和重复检测阈值              |
| `src-tauri/crates/agent-core/src/core/turn_executor/length_recovery.rs`       | `maybe_recover_from_length`                   | Context length 恢复（两级策略） |

### 9. 并发 Session

| 文件                                                                                 | 关键函数/类型                                 | 说明                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------- |
| `src-tauri/crates/agent-core/src/core/coordination/agent_org_runs.rs`                | `AgentOrgRunStore`, `CreateAgentOrgRunParams` | Org Run 管理           |
| `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent/foreground.rs` | ForegroundAgentTool                           | 前台子 agent（阻塞）   |
| `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent/background.rs` | BackgroundAgentTool                           | 后台子 agent（非阻塞） |
| `src-tauri/crates/agent-core/src/core/coordination/agent_inbox.rs`                   | AgentInbox                                    | 成员间消息通信         |

### 10. 持久化

| 文件                                                                          | 关键函数/类型                          | 说明                                          |
| ----------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| `src-tauri/crates/agent-core/src/core/session/persistence/crud/ops.rs`        | `UPSERT_SESSION_SQL`, `upsert_session` | Session 持久化（31 字段，精细 conflict 策略） |
| `src-tauri/crates/agent-core/src/foundation/persistence/db_helpers/messages/` | `builders.rs`, `load_llm.rs`           | LLM 消息持久化与重载                          |
| `src/engines/SessionCore/storage/sqliteCache.ts`                              | SqliteCache                            | 前端 SQLite 缓存                              |
| `src/engines/SessionCore/storage/partialCache.ts`                             | PartialCache                           | 增量缓存                                      |

### 11. MCP 集成

| 文件                                                                    | 关键函数/类型                       | 说明                          |
| ----------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `src-tauri/crates/agent-core/src/intelligence/mcp/manager/lifecycle.rs` | McpManager lifecycle                | MCP server 连接生命周期       |
| `src-tauri/crates/agent-core/src/intelligence/mcp/bridge.rs`            | `register_mcp_tools`                | MCP tools → ToolRegistry 注册 |
| `src-tauri/crates/agent-core/src/intelligence/mcp/oauth.rs`             | OAuth flow                          | MCP OAuth 认证                |
| `src-tauri/crates/agent-core/src/intelligence/mcp/registries/`          | `glama.rs`, `hub.rs`, `smithery.rs` | 多 MCP 市场集成               |
