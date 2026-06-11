---
name: manage-skills
description: Create, read, update, enable, disable, or delete ORGII skills. Use when the user wants to create a new skill, edit an existing skill, list available skills, enable or disable a skill, rename a skill, or delete a skill. Triggers include "创建 skill", "更新 skill", "删除 xxx skill", "list skills", "disable skill".
---

# Managing Skills in ORGII

Skills are markdown files that teach the agent how to perform specific tasks. This skill covers the full CRUD lifecycle: create, read, update, enable/disable, and delete.

## Storage Locations

| Scope     | Path                                        | When to use                |
| --------- | ------------------------------------------- | -------------------------- |
| Global    | `~/.orgii/skills/<name>/SKILL.md`           | Available in all projects  |
| Workspace | `<workspace>/.orgii/skills/<name>/SKILL.md` | Shared with the repository |

Choose **Workspace** for project-specific workflows; **Global** for personal or cross-project workflows.

## SKILL.md Frontmatter

Every `SKILL.md` must begin with a YAML frontmatter block:

```markdown
---
name: your-skill-name
description: What this skill does and when to trigger it.
version: 1.0.0 # optional
license: MIT # optional
compatibility: ">=0.1" # optional
---
```

### Frontmatter Field Rules

| Field           | Required | Constraints                                              |
| --------------- | -------- | -------------------------------------------------------- |
| `name`          | Yes      | Max 64 chars, lowercase letters / numbers / hyphens only |
| `description`   | Yes      | Max 1024 chars. Include WHAT it does AND WHEN to trigger |
| `version`       | No       | Semver string, e.g. `"1.0.0"`                            |
| `license`       | No       | SPDX identifier, e.g. `"MIT"`                            |
| `compatibility` | No       | Semver range for ORGII version compatibility             |

**Description quality matters** — the agent reads the description to decide whether to activate the skill. Include concrete trigger terms, tool names, and a WHEN clause.

## Operations

### List All Skills

To show the user which skills are available:

```
list_dir ~/.orgii/skills/
list_dir <workspace>/.orgii/skills/
```

For each subdirectory, read the frontmatter `description` from `SKILL.md` to give the user a summary.

### Create a Skill

1. Gather from the user:
   - **Name** — short, hyphenated identifier
   - **Purpose** — what task or workflow it covers
   - **Scope** — Global or Workspace
   - **Trigger scenarios** — when should the agent use it?

2. Create the directory and file:

```
mkdir -p ~/.orgii/skills/<name>/
write_file ~/.orgii/skills/<name>/SKILL.md
```

3. Write the content following the structure:

```markdown
---
name: <name>
description: <clear description with WHEN clause>
---

# Skill Title

## Overview

Brief description of what this skill does.

## Steps

1. First step
2. Second step

## Checklist

- [ ] Item one
- [ ] Item two
```

4. Confirm with the user: show the path and the description line.

### Read / View a Skill

```
read_file ~/.orgii/skills/<name>/SKILL.md
```

Present the content to the user. If it is long, summarise the key sections first.

### Update a Skill

1. Read the existing file first:

```
read_file ~/.orgii/skills/<name>/SKILL.md
```

2. Apply the user's changes — do not wipe sections the user did not mention.
3. Write the full updated file back.
4. If the `name` frontmatter field changes, it must match the directory name. Rename the directory accordingly.

**Never** silently change the `description` unless the user asked for it — the description controls when the skill activates.

### Enable / Disable a Skill

Skills do not have a standalone enabled/disabled flag in the file itself. Enabling and disabling is controlled at the agent level via `skills_config`:

- **Disable globally**: Use `manage_agent_def` with `action: "update"` and add the skill name to `skills_config.exclude`.
- **Enable exclusively**: Use `skills_config.include` to whitelist specific skills.

To disable for a specific agent:

```json
{
  "action": "update",
  "agent_id": "<agent-id>",
  "skills_config": {
    "exclude": ["<skill-name>"]
  }
}
```

To re-enable (remove from exclusion), `get` the current config, remove the name from `exclude`, then `update`.

### Delete a Skill

1. Confirm with the user — show the skill name and path.
2. Delete the directory:

```
run_shell: rm -rf ~/.orgii/skills/<name>/
```

3. If any agent's `skills_config.include` or `skills_config.exclude` references the deleted skill, update those configs with `manage_agent_def` to remove the stale reference.

### Rename a Skill

Rename = update `name` in frontmatter + rename directory:

```
run_shell: mv ~/.orgii/skills/<old-name>/ ~/.orgii/skills/<new-name>/
```

Then update the `name` field in the SKILL.md frontmatter. Notify the user that any agent `skills_config.include` / `exclude` entries referencing the old name must be updated.

## Authoring Guidelines

- **Under 500 lines**: Keep `SKILL.md` focused. Put heavy reference material in a sibling `reference.md`.
- **Concise steps**: Every step should be executable, not aspirational.
- **Good description**: Trigger terms + WHEN clause. Bad: "Helps with deployment." Good: "Deploy Rust services to AWS Lambda. Use when building Lambda functions or setting up SAM templates."
- **No redundancy**: Don't repeat what the agent already knows from its base system prompt.

## Checklist

- [ ] Name is lowercase-hyphenated, max 64 chars
- [ ] Directory created at the correct scope location
- [ ] Frontmatter has `name` and `description`
- [ ] Description includes a WHEN clause and concrete trigger terms
- [ ] SKILL.md is under 500 lines
- [ ] Heavy reference material moved to `reference.md` if needed
- [ ] For delete: user confirmed; stale `skills_config` references cleaned up
- [ ] For rename: directory renamed and frontmatter updated
