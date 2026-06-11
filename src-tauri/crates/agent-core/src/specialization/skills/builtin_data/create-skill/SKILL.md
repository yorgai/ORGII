---
name: create-skill
description: Create Agent Skills for ORGII. Use when the user wants to create, write, or author a new skill, capture a workflow as a skill, or asks about SKILL.md format, skill structure, or best practices.
---

# Creating Skills in ORGII

Skills are markdown files that teach the agent how to perform specific tasks. They appear in the `/` slash menu and are included in the agent's system prompt when relevant.

## Before You Begin

Gather from the user:

1. **Purpose**: What task or workflow should this skill help with?
2. **Location**: Global (`~/.orgii/skills/`) or Project (`<repo>/.orgii/skills/`)?
3. **Trigger scenarios**: When should the agent use this skill?
4. **Domain knowledge**: What specialized context does the agent need?

If you have conversation context, infer the skill from what was discussed.

## Storage Locations

| Type    | Path                               | Scope                         |
| ------- | ---------------------------------- | ----------------------------- |
| Global  | `~/.orgii/skills/skill-name/`      | Available across all projects |
| Project | `<repo>/.orgii/skills/skill-name/` | Shared with the repository    |

These two scopes match the `SKILL_SCOPE` constant in
`src/types/extensions/types.ts` and the picker labels in
`SkillEditorPanel.tsx`. Skills do not have a separate "Personal" scope the
way Rules do — there is only one per-user location, and it is called
**Global**.

## Skill File Structure

```
skill-name/
├── SKILL.md          # Required — main instructions
├── reference.md      # Optional — detailed docs / reference tables
└── examples.md       # Optional — usage examples
```

### SKILL.md Format

```markdown
---
name: your-skill-name
description: Brief description of what this skill does and when to use it.
---

# Skill Name

## Instructions

Clear, step-by-step guidance for the agent.

## Examples

Concrete examples.
```

### Frontmatter Fields

| Field         | Requirements                                              |
| ------------- | --------------------------------------------------------- |
| `name`        | Max 64 chars, lowercase letters/numbers/hyphens only      |
| `description` | Max 1024 chars. Include WHAT it does AND WHEN to trigger. |

## Writing a Good Description

The description is critical — the agent uses it to decide when to apply the skill:

```yaml
# Good — specific, includes trigger terms
description: Deploy Rust services to AWS Lambda. Use when building or deploying
  Lambda functions, setting up SAM templates, or packaging Rust for serverless.

# Bad — too vague
description: Helps with deployment
```

**Rules:**

1. Write in third person ("Use when..." not "I help with...")
2. Include both WHAT and WHEN
3. List concrete trigger terms (tool names, file types, workflows)

## Authoring Principles

- **Concise**: Only include context the agent doesn't already have
- **Under 500 lines**: Keep SKILL.md focused; put details in `reference.md`
- **Progressive disclosure**: Link to reference files rather than inlining everything
- **Actionable**: Steps should be executable, not aspirational

## Creation Workflow

1. **Clarify** — gather purpose, location, triggers, constraints from user
2. **Design** — draft name, description, section outline
3. **Implement** — create the directory and write SKILL.md
4. **Verify** — check description quality, line count, name format

## Example Skill

```markdown
---
name: code-review
description: Review code changes for quality, security, and maintainability.
  Use when reviewing pull requests, diffs, or checking code before commit.
---

# Code Review

## Review Order

1. Correctness — does the code do what it claims?
2. Security — are there injection, auth, or data-leak risks?
3. Readability — would a new team member understand this?
4. Tests — are edge cases covered?

## Feedback Labels

- **Critical** — must fix before merge
- **Suggestion** — worth improving
- **Nit** — minor style preference

## Reference

See [review-checklist.md](review-checklist.md) for the full checklist.
```

## Checklist

- [ ] Directory created at the correct location
- [ ] `name` is lowercase-hyphenated, max 64 chars
- [ ] `description` includes trigger terms and WHEN clause
- [ ] SKILL.md is under 500 lines
- [ ] Heavy reference material moved to `reference.md`
