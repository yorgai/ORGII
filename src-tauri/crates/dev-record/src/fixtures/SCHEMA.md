# Cursor IDE state.vscdb — Reverse-Engineered Schema

> Probed from a real macOS install on 2026-05-02. Sample size: 62 composers,
> 10,041 bubbles. **All Cursor APIs are undocumented and may change in any
> Cursor release** — keep parsing lenient, ignore unknown fields.

## Database location

Mac: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
Linux: `~/.config/Cursor/User/globalStorage/state.vscdb`
Windows: `%APPDATA%\Cursor\User\globalStorage\state.vscdb`

Single table of interest: `cursorDiskKV(key TEXT, value BLOB)`.

## Key prefixes (observed)

| Prefix                             | Count\* | Notes                                               |
| ---------------------------------- | ------- | --------------------------------------------------- |
| `agentKv:`                         | 31101   | Agent KV scratchpad — ignore                        |
| `bubbleId:{composerId}:{bubbleId}` | 10041   | One per chat turn — **this is what we parse**       |
| `ofsContent:`                      | 720     | File-state snapshots — ignore for now               |
| `inlineDiff:`                      | 393     | Inline edit history — ignore                        |
| `composerData:{composerId}`        | 62      | Session envelope (already parsed by `cursor_db.rs`) |
| `composer.content.{hash}`          | many    | Content blob storage referenced by edits            |
| `checkpointId:`                    | 237     | Worktree checkpoints — ignore                       |

\*Counts are from one user's DB; only the prefixes themselves are stable.

## `composerData:{composerId}` value (top-level fields)

Already partially consumed by `cursor_db.rs::RawComposerData`. Fields we
additionally need for history rendering:

```jsonc
{
  "_v": 16,
  "composerId": "uuid",
  "name": "Fix clones atom cycle",         // session title
  "createdAt": 1777710752243,                // epoch ms
  "status": "completed" | "in_progress",
  "unifiedMode": "agent" | "ask" | "edit",   // string in composer; int in bubble
  "isAgentic": true,
  "modelConfig": { "modelName": "op-4.6-relay", ... },

  "fullConversationHeadersOnly": [
    { "bubbleId": "...", "type": 1|2, "grouping": { ... } },
    ...
  ],

  "contextTokensUsed": 79262,
  "totalLinesAdded": 130,
  "totalLinesRemoved": 81,
  "filesChangedCount": 6
}
```

`fullConversationHeadersOnly` is the **canonical bubble order** for the
session — bubbles must be replayed in this order, not sorted by `createdAt`
(timestamps within one turn can collide).

## `bubbleId:{composerId}:{bubbleId}` value

```jsonc
{
  "_v": 3,
  "type": 1 | 2,                            // 1 = USER, 2 = ASSISTANT
  "bubbleId": "uuid",
  "createdAt": "2026-05-02T08:32:32.293Z",  // ISO-8601 string
  "text": "...",                            // markdown body (may be empty)
  "unifiedMode": 0 | 1 | 2,                 // int in bubble; "agent"=2

  // Only present on assistant tool turns
  "capabilityType": 15,                     // tool category id (we don't decode)
  "toolFormerData": {
    "tool": 38,                             // numeric id, see table below
    "name": "edit_file_v2",                 // string id — preferred
    "toolCallId": "toolu_...",
    "status": "completed" | "running" | "error",
    "params": "<JSON STRING>",              // tool args, JSON-encoded as string
    "result": "<JSON STRING>",              // tool result, JSON-encoded as string
    "additionalData": {},
    "toolCallBinary": "<base64 protobuf>"   // ignore — no use to us
  },

  // Sometimes present
  "codeBlocks": [
    { "languageId": "ts", "content": "...", "uri": "file://...", ... }
  ],
  "allThinkingBlocks": [],                  // observed empty in this user's DB
  "tokenCount": { "inputTokens": 0, "outputTokens": 0 },
  "requestId": "..."
}
```

**Critical quirks:**

- `toolFormerData.params` and `toolFormerData.result` are **strings containing
  JSON**, not parsed objects. Parse with `serde_json::from_str` on the inner
  string.
- An assistant bubble may have neither `text` nor `toolFormerData` — these are
  empty bookkeeping bubbles. Skip them.
- `unifiedMode` is `int` in bubble payload but `string` in composer payload —
  do not unify the type.

## Cursor `toolFormerData.name` → canonical tool

Observed names in the wild, mapped to our `tool_names::*` constants:

| Cursor name               | Canonical name                                    | ChatBlock                                                                    |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `read_file_v2`            | `read_file`                                       | `ReadFile`                                                                   |
| `edit_file_v2`            | `edit_file_by_replace`                            | `Diff`                                                                       |
| `delete_file`             | `delete_file`                                     | `Diff`                                                                       |
| `run_terminal_command_v2` | `run_command_line`                                | `Shell`                                                                      |
| `glob_file_search`        | `glob_file_search`                                | `Glob`                                                                       |
| `ripgrep_raw_search`      | `grep`                                            | `Search`                                                                     |
| `semantic_search_full`    | `codebase_search`                                 | `Search`                                                                     |
| `todo_write`              | `manage_todo`                                     | `Todo`                                                                       |
| `web_fetch`               | `web_search` (close enough — single-URL fetch)    | `WebSearch`                                                                  |
| `task_v2`                 | `subagent`                                        | `Subagent`                                                                   |
| `read_lints`              | (no built-in equivalent)                          | `Fallback`                                                                   |
| `ask_question`            | `ask_user_questions`                              | (interactive widget — rendered by `AskQuestionEvent`, not via `CHAT_BLOCKS`) |
| `await`                   | (no built-in equivalent)                          | `Fallback`                                                                   |
| `update_current_step`     | (no built-in equivalent — internal planning step) | `Fallback`                                                                   |
| `mcp-*`                   | passthrough                                       | `Fallback`                                                                   |

Mapping is implemented as `cursor_tool_name_to_canonical()` in
`cursor_db_history.rs`. Unknown names fall through to `tool_call` (fallback
card), preserving the raw name as `function`.

### Per-tool field translations

Cursor uses its own field names; our frontend extractors expect canonical
names. `normalize_args_for_canonical` / `normalize_result_for_canonical` in
`cursor_db_history.rs` perform this translation at parse time:

| Cursor tool        | Cursor field (in/out)                                     | Canonical field                                                                             |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `read_file_v2`     | `params.targetFile`                                       | `args.target_file`                                                                          |
| `read_file_v2`     | `params.effectiveUri`                                     | `args.file_path`                                                                            |
| `read_file_v2`     | `result.contents`                                         | `result.content`                                                                            |
| `edit_file_v2`     | `params.relativeWorkspacePath`                            | `args.file_path`                                                                            |
| `edit_file_v2`     | `result.beforeContentId` → `composer.content.{hash}` body | `result.old_content`                                                                        |
| `edit_file_v2`     | `result.afterContentId` → `composer.content.{hash}` body  | `result.new_content`                                                                        |
| `delete_file`      | `params.relativeWorkspacePath`                            | `args.file_path`                                                                            |
| `glob_file_search` | `params.globPattern`                                      | `args.pattern`                                                                              |
| `glob_file_search` | `params.targetDirectory`                                  | `args.path`                                                                                 |
| `web_fetch`        | `params.url`                                              | also copied to `args.query` (for `WebSearchAdapter`)                                        |
| `todo_write`       | `result.finalTodos`                                       | `result.todos`                                                                              |
| `task_v2`          | `result.agentId`                                          | moved to `args.subagentSessionId` with `cursoride-` prefix; `result.success: true` injected |
| `ask_question`     | `params.questions[i].options[j].{id,label}`               | passed through unchanged — FE reads `prompt`/`options[].label` directly                     |
| `ask_question`     | `result.answers: [{questionId: "<opt id>"}]`              | rewritten to `result.answers: [["<option label>"]]` + `result.status: "answered"` injected  |

`composer.content.{hash}` keys in `cursorDiskKV` hold the **raw file body
as a plain string** (not JSON) — used for resolving edit before/after
content. We open these via `load_content_blob()`.

### Subagent composers (`task_v2`)

Each `task_v2` tool call spawns a **separate composer** identified by the
`agentId` in the result. That child composer is itself stored as a
`composerData:{agentId}` row, but with a `subagentInfo` envelope:

```jsonc
{
  "composerId": "<agentId>",
  "name": "Cleanup bucket A: agent_core/core",
  "subagentInfo": {
    "subagentType": 3,
    "subagentTypeName": "generalPurpose",
    "parentComposerId": "<parent composerId>",
    "rootParentConversationId": "<parent composerId>",
    "toolCallId": "toolu_..."        // matches the parent's task_v2 toolCallId
  },
  ...
}
```

In observed dev DBs, **subagent rows account for 40 of 74 composers (~54%)**
— if we listed them all, the sidebar would be half noise. We therefore:

1. **Hide them from the sidebar.** `list_cursor_ide_sessions()` in
   `cursor_db_history.rs` deserializes `subagentInfo` opaquely and skips
   any row where it's present (`Option<Value>` → `Some(_)` ⇒ drop).
2. **Render them inline in the parent and make them replayable.** The
   parent composer's `task_v2` bubble is mapped to canonical `subagent`,
   which routes to `SubagentBlock` / `SubagentAdapter`. `params.{description,
prompt}` already match the adapter's contract, so no arg translation is
   needed. `link_subagent_session` then **lifts** `result.agentId` onto
   `args.subagentSessionId` with the `cursoride-` prefix, so the same
   `useSessionEvents(subagentSessionId)` path that backs CLI/agent
   subagents can resolve cursor-history children too.
3. **Lazy-load the child's events on expand.** The frontend hook
   `useSessionEvents` calls `ensureCursorIdeEventsInStore(sessionId)` for
   `cursoride-*` ids before falling through to `es_load_from_cache`. That
   helper:
   - returns immediately if the EventStore already has events for the id,
   - otherwise fetches `cursor_ide_chunks(sessionId)` → `processChunksRust`
     → `eventStoreProxy.set(events, sessionId)`,
   - coalesces concurrent calls on the same id via an in-flight map.
     The child's events are pushed into the **in-memory** EventStore only
     (`es_set` does no SQLite write-through). Eviction by the Rust LRU is
     safe — we can always replay from `state.vscdb`. The sidebar therefore
     never sees these ids: nothing reads "all session ids in the EventStore"
     to populate `sessionsAtom`.
4. **No deep-link from the SubagentBlock header.** The "Locate" action in
   `SubagentBlock` would normally jump to the BACKGROUND_TASKS panel,
   which is fed from our `agent_sessions.db` and knows nothing about
   Cursor's composers. For `cursoride-*` ids we suppress the deep-link
   and let the header click only toggle expand/collapse; nested events
   still render inline via `useSessionEvents`.

## Numeric `tool` ids (informational only — we key off `name`)

| `tool` | `name`                    |
| ------ | ------------------------- |
| 0      | `update_current_step`     |
| 9      | `semantic_search_full`    |
| 11     | `delete_file`             |
| 15     | `run_terminal_command_v2` |
| 19     | `mcp-*` (varies)          |
| 30     | `read_lints`              |
| 35     | `todo_write`              |
| 38     | `edit_file_v2`            |
| 40     | `read_file_v2`            |
| 41     | `ripgrep_raw_search`      |
| 42     | `glob_file_search`        |
| 48     | `task_v2`                 |
| 51     | `ask_question`            |
| 57     | `web_fetch`               |
| 62     | `await`                   |

Numbers shift between Cursor versions; do **not** key dispatch off them.
The string `name` field is what we use.

## Fields we deliberately ignore

These are present but not useful for chat replay:

`approximateLintErrors`, `lints`, `codebaseContextChunks`, `commits`,
`pullRequests`, `attachedCodeChunks`, `assistantSuggestedDiffs`, `gitDiffs`,
`interpreterResults`, `images`, `attachedFolders`, `attachedFoldersNew`,
`userResponsesToSuggestedCodeBlocks`, `suggestedCodeBlocks`,
`diffsForCompressingFiles`, `relevantFiles`, `toolResults`, `notepads`,
`capabilities`, `multiFileLinterErrors`, `diffHistories`,
`recentLocationsHistory`, `recentlyViewedFiles`, `isAgentic`,
`fileDiffTrajectories`, `existedSubsequentTerminalCommand`,
`existedPreviousTerminalCommand`, `docsReferences`, `webReferences`,
`aiWebSearchResults`, `attachedFoldersListDirResults`, `humanChanges`,
`attachedHumanChanges`, `summarizedComposers`, `cursorRules`,
`cursorCommands`, `cursorCommandsExplicitlySet`, `pastChats`,
`pastChatsExplicitlySet`, `contextPieces`, `editTrailContexts`,
`diffsSinceLastApply`, `deletedFiles`, `supportedTools`,
`attachedFileCodeChunksMetadataOnly`, `consoleLogs`, `uiElementPicked`,
`isRefunded`, `knowledgeItems`, `documentationSelections`, `externalLinks`,
`projectLayouts`, `capabilityContexts`, `todos`, `mcpDescriptors`,
`workspaceUris`, `conversationState`.

## Fixture files in this directory

| File                         | Captured from                              | Purpose                                                    |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `composer.json`              | one rich composer (anonymized)             | parser test for envelope + ordering                        |
| `bubble_user.json`           | one user-type bubble                       | parser test for `type=1` path                              |
| `bubble_assistant_text.json` | one assistant bubble with text only        | parser test for plain message                              |
| `bubble_assistant_tool.json` | one assistant bubble with `toolFormerData` | parser test for tool call (with `toolCallBinary` stripped) |

All fixtures are anonymized: real `/Users/$USER/...` paths replaced with
`/Users/test_user/...`. The base64 `toolCallBinary` field was stripped
from the tool fixture because it embedded un-anonymizable absolute paths
and we never decode it.
