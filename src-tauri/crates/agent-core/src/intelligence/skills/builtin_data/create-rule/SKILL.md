---
name: create-rule
description: Create persistent AI guidance rules for ORGII. Use when the user wants to create a rule, add coding standards, set up project conventions, configure file-specific patterns, or asks about .orgii/rules/ format.
---

# Creating Rules in ORGII

Rules are markdown files injected into the agent's system prompt on every turn.
They encode project conventions, coding standards, or personal preferences.

> **CC alignment**: mirrors `.claude/rules/` in Claude Code.
> ORGII native paths: `.orgii/rules/` (project), `~/.orgii/rules/` (global),
> `~/.orgii/personal/rules/` (personal — OS Agent / channel sessions only).

## Before You Begin

Determine:

1. **Purpose**: What should this rule enforce or teach?
2. **Scope**: Always apply, or only for specific files/paths?
3. **Location**: Global, Project, or Personal?

If you have conversation context, infer the rule content from what was discussed.

## Storage Locations

| Type     | Path                                | Loaded by                                      |
| -------- | ----------------------------------- | ---------------------------------------------- |
| Global   | `~/.orgii/rules/my-rule.md`          | All sessions, all projects                     |
| Project  | `<project>/.orgii/rules/my-rule.md`  | All sessions opened for this project           |
| Personal | `~/.orgii/personal/rules/my-rule.md` | OS Agent / channel sessions only (any project) |

Mirrors the "Source" picker in `MarkdownRuleForm` exactly. **Do not** write a
"personal" rule into `~/.orgii/rules/` — that path is the Global broadcast bucket
and the rule will leak into every coding session.

> Tip: `.cursor/rules/*.mdc` files can be **imported** into `.orgii/rules/` via
> the import flow in Settings → Rules. They are not the native storage location.

## Rule File Format

```markdown
---
description: Brief description of what this rule does
globs: "**/*.ts"
alwaysApply: false
---

# Rule Title

Your rule content here...
```

### Frontmatter Fields

| Field         | Type    | Description                                              |
| ------------- | ------- | -------------------------------------------------------- |
| `description` | string  | What the rule does (shown in rule picker)                |
| `globs`       | string  | File pattern — rule applies when matching files are open |
| `alwaysApply` | boolean | If true, applies to every session regardless of files    |

## Rule Configurations

### Always Apply (project-wide standards)

```yaml
---
description: Core coding standards for this project
alwaysApply: true
---
```

### Apply to Specific Files

```yaml
---
description: TypeScript conventions
globs: "**/*.ts,**/*.tsx"
alwaysApply: false
---
```

### Apply to a Directory

```yaml
---
description: Backend API conventions
globs: "src/api/**"
alwaysApply: false
---
```

## Best Practices

- **Under 100 lines**: Keep rules concise — the agent reads them on every turn
- **One concern per rule**: Split large rules into focused files
- **Actionable**: Write like clear internal docs, not policies
- **Concrete examples**: Show correct and incorrect patterns with code blocks
- **No redundancy**: Don't repeat what the agent already knows

## Example

```markdown
---
description: Error handling standards for TypeScript
globs: "**/*.ts,**/*.tsx"
alwaysApply: false
---

# Error Handling

Always propagate errors — never silently swallow them:

\`\`\`typescript
// Bad — swallows the error
try {
await fetchData();
} catch (\_e) {}

// Good — propagate with context
try {
await fetchData();
} catch (err) {
throw new DataFetchError("Unable to retrieve data", { cause: err });
}
\`\`\`

Use typed error classes, not string messages.
```

## Checklist

- [ ] File placed at the right scope: `~/.orgii/rules/` (Global, all sessions),
      `<project>/.orgii/rules/` (Project), or `~/.orgii/personal/rules/`
      (Personal — OS Agent / channel sessions only)
- [ ] Frontmatter has `description` and either `alwaysApply: true` or a `globs` pattern
- [ ] Content is under 100 lines
- [ ] Includes at least one concrete code example
- [ ] Rule does not duplicate existing project rules
