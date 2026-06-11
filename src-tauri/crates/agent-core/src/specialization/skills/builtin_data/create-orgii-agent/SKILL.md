---
name: create-orgii-agent
description: Create or modify a custom ORGII agent definition (and the org it belongs to). Use when the user wants to create, configure, retune, rename, or delete an agent, define an agent's soul / capabilities / tools, organise agents into an org, or asks about agent-definitions.json.
---

# Creating Agents (and Orgs) in ORGII

The canonical way to create or modify an agent is the **`manage_agent_def`**
tool. It is gated by `ManagementCapability` — if it is in your tool list,
use it. Hand-editing `~/.orgii/agent-definitions.json` is a fallback for
sessions that lack that capability.

The same tool also manages **agent organizations** (the team groupings shown
in the Members panel). Agents and orgs share the same surface because most
"create an agent" requests imply "and put it in an org".

## Before You Touch Anything

1. **`list` first.** Always call `manage_agent_def` with `action: "list"`
   (and `"list_orgs"` if relevant) before creating. The tool warns about
   similar names, but you should know the existing roster anyway.
2. **`get` before `update`.** Update is a full replace for the fields you
   pass — read the current definition first so you don't accidentally wipe
   `soul_content`, `tools`, or `skills_config`.
3. **Confirm intent in one short turn.** Name the proposed agent back to
   the user with its `name`, `description`, capabilities, inheritance, and
   any tool excludes. Then create. No "I'll just create it and we'll see".

## Gather From the User

1. **Name & purpose** — what is it called, what does it do?
2. **Soul (system prompt)** — tone, expertise, persona, hard limits.
3. **Inheritance** — does it extend `builtin:sde` (coding), `builtin:os`
   (desktop), or `builtin:base` (minimal)? Default is `builtin:sde`.
4. **Capabilities** — coding only? Plus desktop? Browser? Data? Gateway?
   Default is "coding + core" — do not grant the others unless asked.
5. **Tool excludes** — any built-in or MCP tools to deny?
6. **Skills** — should the agent ship with specific skills enabled /
   disabled, or inherit the global skill list?
7. **Org placement** — should it slot into an existing org, a new one, or
   stand alone?

If the user has already given you context (a previous turn, a workflow
description), infer these and confirm — don't re-ask everything.

## Primary Path — the `manage_agent_def` Tool

### Actions

| Action       | Purpose                                      |
| ------------ | -------------------------------------------- |
| `list`       | List all custom agents                       |
| `get`        | Read one agent by `agent_id`                 |
| `create`     | Create a new custom agent                    |
| `update`     | Update fields on an existing custom agent    |
| `remove`     | Delete a custom agent                        |
| `list_orgs`  | List all agent organizations                 |
| `get_org`    | Read one org by `org_id`                     |
| `create_org` | Create a new org                             |
| `update_org` | Update an org (rename, change members, etc.) |
| `remove_org` | Delete an org                                |

### Minimal `create` call

```json
{
  "action": "create",
  "name": "Research Assistant",
  "description": "Deep research agent for technical topics. Use for researching libraries, comparing tools, or summarizing documentation.",
  "soul_content": "You are a technical research assistant. Your job is to research, compare, and summarize technical topics clearly. Always cite your sources when using web search. Structure responses with headers and bullet points for easy scanning.",
  "temperature": 0.4,
  "max_tokens": 8000,
  "context_window": 128000
}
```

This produces a custom agent that inherits the SDE defaults — tools,
capabilities, skills — with the soul, name, and LLM knobs you supplied.
That is almost always the right starting point.

### Restricting tools

`tools` carries a per-agent allow/deny delta on top of whatever inheritance
gives the agent. Leave it out to inherit everything.

```json
{
  "action": "create",
  "name": "Read-Only Reviewer",
  "soul_content": "...",
  "tools": {
    "excludedTools": ["edit_file", "apply_patch", "shell"],
    "disabledMcpServers": [],
    "disabledMcpTools": []
  }
}
```

| `tools` field        | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `excludedTools`      | Built-in tool names to remove for this agent       |
| `disabledMcpServers` | MCP server names to hide entirely                  |
| `disabledMcpTools`   | Specific MCP tools in `mcp__<server>__<tool>` form |

The system allowlist (`system_restrict_to_tools`) and user allowlist
(`user_allowed_tools`) exist in the underlying schema but are not exposed
on this tool — they are authored by builtin agents and by the Agent Wizard
UI, not by you.

### Configuring skills

```json
"skills_config": {
  "enabled": true,
  "include": ["create-skill", "create-rule"],
  "exclude": ["unrelated-skill"]
}
```

- `enabled` — override the global `skills_enabled` toggle. Omit to inherit.
- `include` — whitelist (empty = all available skills).
- `exclude` — blacklist applied on top of the whitelist.

Default is "inherit global skills, exclude nothing". Don't set
`skills_config` unless the user asked for a non-default behaviour.

### Sub-agents

```json
"sub_agents": [
  { "agent_id": "<some-custom-agent-id>" }
]
```

**Do not** list `builtin:explore`, `builtin:general`, `builtin:base`,
`builtin:memory-extractor`, or `builtin:memory-consolidator` as
sub-agents. Those are runtime primitives, not user-configurable
specialists. Only point at custom agents (or named builtin specialists
like `builtin:sde`) the user has explicitly asked to delegate to.

### `update` semantics

`update` only writes the fields you pass — but the `tools` field is
replaced wholesale, not merged. If you want to add one excluded tool to an
existing list, `get` first, append in memory, then `update` with the full
new array. Same for `sub_agents` and `skills_config.include` / `exclude`.

### Organizations

Same tool, different actions:

```json
{
  "action": "create_org",
  "name": "Product Team",
  "role": "PM",
  "description": "Product management and design org.",
  "members": [
    { "name": "PM", "agent_id": "builtin:sde" },
    { "name": "Designer", "agent_id": "<custom-agent-id>" }
  ]
}
```

Members reference agents by `agent_id`. Create the agents first, then
wire them into the org — otherwise you end up with org rows pointing at
non-existent ids.

## Fallback Path — Hand-Editing the JSON

Only use this when `manage_agent_def` is not available in your tool list.

Custom agents live in `~/.orgii/agent-definitions.json` as a JSON array of
`AgentDefinition` objects. Built-in overrides live in
`~/.orgii/builtin-overrides.json` and follow the same schema.

### Real schema (camelCase on disk)

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Research Assistant",
    "description": "Deep research agent for technical topics.",
    "builtIn": false,
    "tier": "secondary",
    "inheritsFrom": "builtin:sde",

    "capabilities": {
      "coding": { "modeSwitch": true }
    },

    "soulContent": "You are a technical research assistant...",
    "sovereignPrompt": false,

    "temperature": 0.4,
    "contextWindow": 128000,
    "maxTokens": 8000,

    "tools": {
      "excludedTools": [],
      "disabledMcpServers": [],
      "disabledMcpTools": []
    },

    "skillsConfig": {
      "enabled": true,
      "include": [],
      "exclude": []
    },

    "iconId": "book-open",

    "agentPolicy": {
      "autonomy": "read_only",
      "workspaceOnly": true,
      "blockedCommands": []
    }
  }
]
```

### Required fields

| Field         | Type    | Notes                                                                                   |
| ------------- | ------- | --------------------------------------------------------------------------------------- |
| `id`          | string  | UUID v4. Must be unique. Built-in agents use `builtin:` prefix; custom agents must not. |
| `name`        | string  | Display name.                                                                           |
| `builtIn`     | boolean | Always `false` for custom agents.                                                       |
| `soulContent` | string  | System prompt. Required in practice — without it the agent has no identity.             |

### Common optional fields

| Field           | Type   | Notes                                                                                                              |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `description`   | string | Shown in the picker and used for auto-routing.                                                                     |
| `tier`          | string | `"primary"` or `"secondary"`. Default `"secondary"`.                                                               |
| `inheritsFrom`  | string | `"builtin:base"`, `"builtin:sde"`, `"builtin:os"`, or a custom agent id.                                           |
| `temperature`   | number | 0.0–1.0. Lower = more focused.                                                                                     |
| `contextWindow` | number | Max input tokens (e.g. `128000`).                                                                                  |
| `maxTokens`     | number | Max output tokens per turn.                                                                                        |
| `iconId`        | string | Must match a key in `src/config/agentIcons.tsx`. Examples: `"book-open"`, `"drafting-compass"`, `"flask-conical"`. |
| `capabilities`  | object | See below.                                                                                                         |
| `tools`         | object | `excludedTools`, `userAllowedTools`, `disabledMcpServers`, `disabledMcpTools`.                                     |
| `agentPolicy`   | object | `autonomy` (`"read_only"` / `"read_write"`), `workspaceOnly`, `blockedCommands`.                                   |
| `subAgents`     | array  | `[{ "agentId": "..." }]`. See sub-agent caveats above.                                                             |
| `skillsConfig`  | object | `enabled`, `include`, `exclude`.                                                                                   |

### Capability set

```json
"capabilities": {
  "coding":   { "modeSwitch": true },
  "desktop":  { "enabled": true },
  "browser":  { "internal": true, "external": false },
  "data":     {},
  "gateway":  {},
  "management": {}
}
```

Omit a capability to deny it. Tool availability is **derived** from
capabilities at session init — there is no separate denylist to maintain.

- `coding` — file edits, LSP, patches. Default for most agents.
- `desktop` — screen / window / clipboard control. OS-style agents only.
- `browser` — `internal` (embedded webview) vs `external` (system browser).
- `data` — data subsystem tools. Rarely needed.
- `gateway` — receive messages from external channels (Telegram, Discord).
- `management` — `manage_agent_def`, `manage_project`, `manage_work_item`.
  Only grant to coordinator-style agents (like this one).

### Writing `soulContent`

```
You are [ROLE], specialized in [DOMAIN].

Your responsibilities:
1. [Primary task]
2. [Secondary task]

Behavior rules:
- [Key constraint or style rule]
- [Output format preference]

Limitations:
- [What you will NOT do]
```

Keep it focused — 100–500 chars is typical. The unified prompt builder
stacks `soulContent` at order 10 alongside the standard sections (tool
listing, rules, learnings). Set `sovereignPrompt: true` only when the
soul fully replaces those defaults (e.g. a custom router agent that
shouldn't be told "you are an SDE coding assistant").

### Hand-edit workflow

1. `read_file ~/.orgii/agent-definitions.json` to load the current array.
   If the file doesn't exist, start with `[]`.
2. Generate a UUID v4 (`uuidgen` or `python3 -c 'import uuid; print(uuid.uuid4())'`).
3. Build the new object using the schema above.
4. Append it to the array.
5. `write_file ~/.orgii/agent-definitions.json` with the full new array.
6. Validate: `python3 -m json.tool ~/.orgii/agent-definitions.json > /dev/null`.

## Checklist (Both Paths)

- [ ] Called `list` (and `list_orgs`) first
- [ ] User confirmed name, description, capabilities, inheritance
- [ ] `id` is a UUID v4, not duplicated, no `builtin:` prefix
- [ ] `builtIn` is `false`
- [ ] `soulContent` is focused (100–500 chars) and matches the agent's role
- [ ] `inheritsFrom` is set (default `"builtin:sde"`) unless deliberately blank
- [ ] `temperature` matches the task (analytical 0.1–0.3, balanced 0.4–0.5, creative 0.6–0.8)
- [ ] `capabilities` only contains what the user asked for (no stealth `desktop` / `browser` / `gateway`)
- [ ] `tools.excludedTools` is honest about what the agent should not touch
- [ ] No runtime-primitive sub-agents (`builtin:explore`, `builtin:general`, `builtin:base`, `builtin:memory-*`)
- [ ] If hand-editing JSON: file still parses and the array is well-formed
- [ ] Reported back to the user: agent id, where the soul lives, any org wiring
