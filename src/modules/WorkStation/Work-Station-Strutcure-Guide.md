# WorkStation Structure Guide

**Last Updated:** 2026-05-24

## Overview

WorkStation is the collection of developer tool modules: **CodeEditor**,
**Browser**, **DatabaseManager**, **ProjectManager**, and **Launchpad**.
This guide explains how to organize and create new WorkStation modules.

All modules render into a single global tab pool
(`workstationLayoutAtom.mainPane`). There is no split-pane or focused-pane
concept — every tab lives in one shared pool, filtered to its host module
via `tabToLegacyHost(tab)`.

## Module Structure Pattern

Each WorkStation module follows this structure:

```
{ModuleName}/
├── index.tsx              # Main component
├── config.ts              # Configuration constants
├── {Module}-Structure.md  # Module-specific structure docs
│
├── {ModuleName}Layout/    # Layout orchestration (at root level)
│   ├── components/        # Layout sub-components, integrations
│   └── overlays/          # Modal overlays
│
└── Panels/                # All UI panels
    ├── {ModuleName}PrimarySidebar/   # Left/right sidebar
    ├── {ModuleName}MainPane/         # Main content pane (single)
    ├── {ModuleName}BottomPanel/      # Bottom panel (optional)
    └── shared/                       # Panel-specific shared components
```

**Key principle:** Layout is at root level (orchestrator), Panels contains all visual panels.

## Naming Conventions

### Component Naming

| Pattern                  | Usage                             | Example                |
| ------------------------ | --------------------------------- | ---------------------- |
| `{Module}Layout`         | Layout orchestration (root level) | `EditorLayout`         |
| `{Module}PrimarySidebar` | Main sidebar with tabs            | `EditorPrimarySidebar` |
| `{Module}MainPane`       | Main content/editing pane         | `EditorMainPane`       |
| `{Module}BottomPanel`    | Terminal/output/problems          | `EditorBottomPanel`    |
| `*Content`               | Content rendered in tabs          | `SearchContent`        |
| `*Tab`                   | Tab configuration hooks           | `SearchTab`            |

### Folder Naming

- **PascalCase** for component folders: `EditorPrimarySidebar/`
- **camelCase** for utility folders: `hooks/`, `utils/`, `tabs/`, `content/`

## Layout Pattern

Layout is at the module root level (not inside Panels):

```
{ModuleName}Layout/
├── index.tsx              # Main layout - orchestrates all panels
│
├── components/            # Layout sub-components
│   └── Integrations/      # Side-effect hooks wrapper
│
└── overlays/              # Modal/overlay components
    └── {Name}Panel/       # Quick search, dialogs
```

## Sidebar/Panel Pattern

For components with multiple tabs (sidebar, bottom panel), use this structure:

```
Panels/{Component}/
├── index.tsx              # Main component
├── config.ts              # Icons, constants
├── types.ts               # Props, types
│
├── tabs/                  # Tab CONFIGURATION
│   └── {Name}Tab.tsx      # use{Name}TabConfig() hook
│
├── content/               # Tab RENDERING
│   └── {Name}Content/     # UI components
│       ├── index.tsx
│       ├── components/    # (if needed)
│       ├── hooks/         # (if needed)
│       └── utils/         # (if needed)
│
├── hooks/                 # Shared hooks
└── components/            # Shared components
```

### tabs/ vs content/

| Folder     | Purpose               | Contains                                    |
| ---------- | --------------------- | ------------------------------------------- |
| `tabs/`    | Tab **configuration** | Hooks defining structure, sections, actions |
| `content/` | Tab **rendering**     | UI components that render in each tab       |

## Shared Components

### WorkStation/shared/

Components used by **multiple modules** (CodeEditor, Browser, DatabaseManager):

```
WorkStation/shared/
├── WorkStationShell/       # Main layout wrapper
├── TabBar/                # Unified tab bar
├── StatusBar/             # Status bars
├── FileHeader/            # Breadcrumb header
├── UnsavedChangesBar/     # Save/discard floating bar
├── PrimarySidebarLayout/  # Sidebar layout primitives
├── Placeholder/           # Empty state placeholders
└── ResizeHandle/          # Resize handles
```

### {Module}/Panels/shared/

Components used **only within one module** but across multiple panels:

```
CodeEditor/Panels/shared/
├── index.ts              # Barrel export
├── SearchInput.tsx
├── SearchFilters.tsx
└── ReplaceInput.tsx
```

## Decision Guide: Where to Put Components?

```
Is it used outside WorkStation?
├── Yes → @src/components/ or @src/features/
│
└── No → Is it used by multiple WorkStation modules?
    ├── Yes → WorkStation/shared/
    │
    └── No → Is it specific to one sidebar/panel tab?
        ├── Yes → {Module}/Panels/{Panel}/content/{Tab}Content/
        │
        └── No → Is it a layout/overlay?
            ├── Yes → {Module}/{Module}Layout/
            └── No → {Module}/Panels/shared/
```

## Creating a New WorkStation Module

### 1. Create folder structure

```bash
mkdir -p NewModule/{NewModuleLayout,Panels/{NewModulePrimarySidebar,NewModuleMainPane,shared}}
```

### 2. Create main component

```typescript
// NewModule/index.tsx
import { WorkStationShell } from "../shared";
import { NewModuleLayout } from "./NewModuleLayout";

export const NewModule: React.FC<Props> = ({ ... }) => {
  return (
    <WorkStationShell>
      <NewModuleLayout ... />
    </WorkStationShell>
  );
};
```

### 3. Create Layout component

The layout orchestrates all panels:

```typescript
// NewModule/NewModuleLayout/index.tsx
import { NewModulePrimarySidebar } from "../Panels/NewModulePrimarySidebar";
import { NewModuleMainPane } from "../Panels/NewModuleMainPane";

export const NewModuleLayout: React.FC<Props> = ({ ... }) => {
  return (
    <ResizableSplitPanel>
      <NewModulePrimarySidebar ... />
      <NewModuleMainPane ... />
    </ResizableSplitPanel>
  );
};
```

### 4. Add to WorkStation routes

Register the new module in the routing configuration.

## Import Patterns

### From Layout to Panels

```typescript
// From NewModuleLayout/index.tsx
import { NewModuleMainPane } from "../Panels/NewModuleMainPane";
import { NewModulePrimarySidebar } from "../Panels/NewModulePrimarySidebar";
```

### From content to shared hooks

```typescript
// From Panels/EditorPrimarySidebar/content/SourceControlContent/
import { useSourceControlState } from "../../hooks/useSourceControlState";
```

### From module to WorkStation shared

```typescript
// From CodeEditor/index.tsx
import { EditorStatusBar, WorkStationShell } from "../shared";
```

## File Size Guidelines

| Type          | Max Lines |
| ------------- | --------- |
| Hook files    | 500       |
| UI components | 300       |
| Config files  | 200       |

When a file exceeds these limits, split into subfolders with `components/`, `hooks/`, or `utils/`.

## Global Types

Types used across the entire application go in `@src/types/`:

```
@src/types/
├── git.tsx        # GitFile, ActionLoadingState
├── session/       # Session types
└── ...
```
