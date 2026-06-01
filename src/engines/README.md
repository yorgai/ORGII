# Engines

Self-contained runtime subsystems that power specific tools in the editor.

## What is an Engine?

An engine is a **complete, isolated subsystem** that:

- Has its own state management and business logic
- May include UI components specific to that engine
- Operates independently from other engines
- Can be loaded/unloaded as needed

## Current Engines

| Engine         | Purpose                             |
| -------------- | ----------------------------------- |
| `BrowserCore`  | Embedded browser functionality      |
| `DatabaseCore` | Unified database provider interface |
| `GitWorkflow`  | Git operations and workflows        |
| `SessionCore`  | Session management and sync         |
| `Simulator`    | Activity/task simulation and replay |
| `TerminalCore` | Integrated terminal                 |

## Engine vs Feature vs Component

| Type          | Location          | Purpose                                              |
| ------------- | ----------------- | ---------------------------------------------------- |
| **Engine**    | `src/engines/`    | Self-contained runtime subsystem                     |
| **Feature**   | `src/features/`   | Domain-specific functionality (chat, settings, etc.) |
| **Component** | `src/components/` | Reusable UI primitives                               |
| **Scaffold**  | `src/scaffold/`   | App shell structure (tabs, modals, sidebar)          |

## Structure

Each engine should follow this pattern:

```
engines/MyEngine/
├── index.ts          # Public exports
├── types.ts          # Engine-specific types
├── hooks/            # React hooks (if needed)
├── components/       # UI components (if needed)
├── services/         # Core logic
└── store/            # State management (if needed)
```

## Guidelines

1. **Isolation**: Engines should minimize dependencies on other engines
2. **Self-contained**: Include all logic and UI needed for that subsystem
3. **Clear API**: Export a clean public interface via `index.ts`
4. **No cross-engine imports**: Use services or events for communication
