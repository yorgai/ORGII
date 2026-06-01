# Types Organization

This document describes the organization of the `src/types/` folder.

## Structure Overview

```
src/types/
├── index.ts                    # Main barrel export
├── core/                       # Core domain types
├── session/                    # Session/workflow types
├── editor/                     # Editor/IDE types
├── git/                        # Git types
├── testing/                    # Test runner types
└── ui/                         # UI-specific types
```

> **Market types** live in `src/api/http/market/types.ts` — the canonical source of truth for all token market types.

## Domain Categories

### `core/` - Core Domain Types

Business entities used across the application.

| File             | Contents                                             |
| ---------------- | ---------------------------------------------------- |
| `user.ts`        | User info, accounts, profile data, language stats    |
| `project.ts`     | Project entity, status, health                       |
| `repo.ts`        | Repository, file tree, session info, chat types      |
| `work-item.ts`   | Work items, tasks, sessions, status/priority         |
| `shared.ts`      | Person, Label, Team, DropdownOption, ContextMenuItem |
| `view-status.ts` | Status colors, Kanban/Gantt/Calendar conversions     |

### `session/` - Session Types

Types for the session execution engine.

| File          | Contents                                       |
| ------------- | ---------------------------------------------- |
| `session.ts`  | Session API types, status, requests/responses  |
| `workflow.ts` | Workflow stages, WebSocket events, diff types  |
| `steps.ts`    | Backend events, steps, Git API types           |
| `activity.ts` | Activity chunks, action types, tool categories |

### `editor/` - Editor/IDE Types

Types for the code editor and IDE features.

| File              | Contents                                     |
| ----------------- | -------------------------------------------- |
| `document.ts`     | Document state, edit operations, versioning  |
| `file-content.ts` | File content API responses                   |
| `navigation.ts`   | Tab behavior, navigation state               |
| `context.ts`      | Context signals (IDE-to-agent communication) |

### `git/` - Git Types

Types for git operations and source control.

| File          | Contents                                    |
| ------------- | ------------------------------------------- |
| `types.ts`    | GitFile, ActionLoadingState, status helpers |
| `helpers.tsx` | `formatPath()` React component              |
| `review.ts`   | Hunk review types, file review state        |

### `testing/` - Test Runner Types

Types for the test execution system.

| File       | Contents                                              |
| ---------- | ----------------------------------------------------- |
| `types.ts` | TestItem, TestResult, TestRunSummary, framework types |

### `ui/` - UI-Specific Types

Types with UI dependencies (icons, components).

| File             | Contents                              |
| ---------------- | ------------------------------------- |
| `tabs.ts`        | Tab types, BrowserSession             |
| `agent-icons.ts` | Lucide icon mappings for agents/tools |

## Import Guidelines

### Direct imports (recommended)

```typescript
import { UserProfileData } from "@src/types/core/user";
import { GitFile } from "@src/types/git/types";
```

### Namespace imports (when names conflict)

```typescript
import * as GitTypes from "@src/types/git/types";
import * as SessionTypes from "@src/types/session/session";
```

### From barrel exports

```typescript
import { CoreTypes, GitTypes } from "@src/types";

// Then use: GitTypes.GitFile, CoreTypes.UserProfileData
```

## Design Principles

1. **Domain-driven**: Types grouped by what they represent, not where they're used
2. **Separation of concerns**: Pure types vs helpers vs UI constants
3. **No circular dependencies**: Lower-level types don't import higher-level ones
4. **Colocation**: Related types stay together (e.g., all git types in `git/`)

## Adding New Types

1. Identify the domain: Is it a core entity? Editor feature? External integration?
2. Check for existing files in that domain
3. Add to existing file if related, or create new file if distinct
4. Export from the domain's `index.ts`
5. Add namespace export to main `index.ts` if needed

## Migration Notes

Reorganized on 2026-01-29:

- Merged `workitem.ts` + `app/manage/work-item.ts` → `core/work-item.ts`
- Merged `shared/user.ts` + `userProfile.ts` → `core/user.ts`
- Moved `context.ts`, `document.ts`, `navigation.ts` → `editor/`
- Moved `testRunner.ts` → `testing/types.ts`
- Split `git.tsx` into `git/types.ts` + `git/helpers.tsx`
- Split `shared/agent.ts` into `integration/agent-events.ts` + `ui/agent-icons.ts`
- Moved `review/` → `git/review.ts`
- Deleted `app/`, `shared/` directories
- Merged `integration/market.ts` → `src/api/http/market/types.ts` (2026-04-03); deleted `integration/` folder
