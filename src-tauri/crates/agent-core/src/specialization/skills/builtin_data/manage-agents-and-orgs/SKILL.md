---
name: manage-agents-and-orgs
description: Create, update, or delete custom ORGII agent definitions and agent organizations. Use when the user wants to create an agent, update an agent's soul or tools, rename or remove an agent, manage org membership, list agents or orgs, or asks about agent-definitions.json. Triggers include "创建 agent", "更新 agent 配置", "管理 org", "add agent to org", "delete agent".
---

# Managing Agents and Orgs in ORGII

This skill covers the full CRUD lifecycle for custom **agent definitions** and **agent organizations** (orgs). It extends `create-orgii-agent` with explicit update, remove, and org-management workflows.

The canonical interface is the **`manage_agent_def`** tool (requires `ManagementCapability`). Fall back to hand-editing `~/.orgii/agent-definitions.json` only when the tool is absent.

## Available Actions

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

## Universal Rules

1. **`list` before create.** Always call `list` (and `list_orgs` if relevant) before creating anything. Know the existing roster to avoid duplicates.
2. **`get` before update.** `update` is a partial replace — read the current definition first so you don't accidentally wipe `soul_content`, `tools`, or `skills_config`.
3. **Confirm before write.** Present the proposed change to the user (name, description, capabilities, soul summary) and get confirmation before calling `create`, `update`, or `remove`.

---

## Agent CRUD

### List Agents

```json
{ "action": "list" }
```

Show the user each agent's `id`, `name`, and `description`.

### Get an Agent

```json
{ "action": "get", "agent_id": "<id>" }
```

Use this before any update to capture the current state.

### Create an Agent

#### Gather from the user

1. **Name & purpose** — what is it called, what does it do?
2. **Soul (system prompt)** — tone, expertise, persona, hard limits.
3. **Inheritance** — `builtin:sde` (coding, default), `builtin:os` (desktop), or `builtin:base` (minimal)?
4. **Capabilities** — coding only? Plus desktop / browser / data / gateway / management?
5. **Tool excludes** — any built-in or MCP tools to deny?
6. **Skills config** — inherit global list, or whitelist/blacklist specific skills?
7. **Org placement** — existing org, new org, or standalone?

#### Minimal `create` call

```json
{
  "action": "create",
  "name": "Research Assistant",
  "description": "Deep research agent for technical topics. Use for researching libraries, comparing tools, or summarizing documentation.",
  "soul_content": "You are a technical research assistant. Research, compare, and summarize technical topics clearly. Cite sources. Structure responses with headers and bullet points.",
  "temperature": 0.4,
  "max_tokens": 8000,
  "context_window": 128000
}
```

This inherits SDE defaults (tools, capabilities, skills). Customize only what differs.

#### Restricting tools

```json
{
  "action": "create",
  "name": "Read-Only Reviewer",
  "soul_content": "...",
  "tools": {
    "excludedTools": ["edit_file", "apply_patch", "run_shell"],
    "disabledMcpServers": [],
    "disabledMcpTools": []
  }
}
```

#### Configuring skills

```json
"skills_config": {
  "enabled": true,
  "include": ["create-skill", "create-rule"],
  "exclude": ["setup-repo"]
}
```

Leave out `skills_config` to inherit global defaults.

### Update an Agent

1. `get` the current definition.
2. Apply only the fields the user wants changed.
3. For array fields (`tools.excludedTools`, `sub_agents`, `skills_config.include`, `skills_config.exclude`), read the existing array, modify in memory, pass the full new array.

```json
{
  "action": "update",
  "agent_id": "<id>",
  "soul_content": "<new soul>",
  "temperature": 0.3
}
```

### Remove an Agent

1. Confirm the agent name and id with the user.
2. Check if any org references this `agent_id` — if so, warn the user the org membership will have a dangling reference.

```json
{ "action": "remove", "agent_id": "<id>" }
```

---

## Org CRUD

### List Orgs

```json
{ "action": "list_orgs" }
```

### Get an Org

```json
{ "action": "get_org", "org_id": "<id>" }
```

### Create an Org

Create the member agents first, then wire them:

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

Members are referenced by `agent_id`. **Do not** create an org that points at agent ids that don't exist yet.

### Update an Org

`get_org` first, then update the fields the user wants changed (name, description, members list):

```json
{
  "action": "update_org",
  "org_id": "<id>",
  "members": [
    { "name": "PM", "agent_id": "builtin:sde" },
    { "name": "Designer", "agent_id": "<custom-agent-id>" },
    { "name": "Reviewer", "agent_id": "<another-agent-id>" }
  ]
}
```

### Remove an Org

```json
{ "action": "remove_org", "org_id": "<id>" }
```

Removing an org does not delete its member agents — only the grouping is removed.

---

## Agent Schema Reference

### Core Fields

| Field           | Type    | Notes                                                                                             |
| --------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `id`            | string  | UUID v4 — assigned by the tool on create; do not craft manually.                                  |
| `name`          | string  | Display name shown in the agent picker.                                                           |
| `description`   | string  | Used for auto-routing. Shown in the picker.                                                       |
| `builtIn`       | boolean | Always `false` for custom agents.                                                                 |
| `inheritsFrom`  | string  | `"builtin:base"`, `"builtin:sde"`, `"builtin:os"`, or a custom agent id. Default `"builtin:sde"`. |
| `soulContent`   | string  | System prompt. 100–500 chars typical.                                                             |
| `temperature`   | number  | 0.0–1.0. Analytical: 0.1–0.3. Balanced: 0.4–0.5. Creative: 0.6–0.8.                               |
| `contextWindow` | number  | Max input tokens (e.g. `128000`).                                                                 |
| `maxTokens`     | number  | Max output tokens per turn.                                                                       |

### Capabilities

```json
"capabilities": {
  "coding":     { "modeSwitch": true },
  "desktop":    { "enabled": true },
  "browser":    { "internal": true, "external": false },
  "data":       {},
  "gateway":    {},
  "management": {}
}
```

Omit a capability to deny it. Default is `coding` only. Do not grant `desktop`, `browser`, `gateway`, or `management` unless the user explicitly asked.

### Sub-agents

```json
"sub_agents": [{ "agent_id": "<custom-or-builtin-specialist-id>" }]
```

**Do not** add runtime primitives as sub-agents: `builtin:explore`, `builtin:general`, `builtin:base`, `builtin:memory-extractor`, `builtin:memory-consolidator`.

---

## Fallback — Hand-Edit JSON

Only when `manage_agent_def` is not available:

1. `read_file ~/.orgii/agent-definitions.json` (start with `[]` if absent).
2. Generate UUID: `python3 -c 'import uuid; print(uuid.uuid4())'`
3. Build the object, append to array, write back.
4. Validate: `python3 -m json.tool ~/.orgii/agent-definitions.json > /dev/null`

---

## Checklist

- [ ] Called `list` (and `list_orgs`) first
- [ ] User confirmed name, description, capabilities, soul before write
- [ ] `get` called before any `update`
- [ ] Array fields read-modify-written (not overwritten blindly)
- [ ] Capabilities limited to what the user asked for
- [ ] `temperature` matches the task type (analytical / balanced / creative)
- [ ] No runtime-primitive sub-agents added
- [ ] For `remove`: user confirmed; org membership impact assessed
- [ ] For org create: all referenced `agent_id`s already exist
- [ ] Reported back: agent id, soul location, org wiring
