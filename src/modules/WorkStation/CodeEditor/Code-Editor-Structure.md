# CodeEditor Structure

**Last Updated:** 2026-05-24

## Overview

The CodeEditor module provides a VS Code-like editing experience with file
tree, git integration, and terminal. It renders a single main pane — there
is no split-pane support; all WorkStation tabs (file, terminal, browser,
data, project, launchpad, settings, source control) live in one global pool
on `workstationLayoutAtom.mainPane`.

## Folder Structure

```
CodeEditor/
├── index.tsx              # Main component (renders single EditorContent)
├── config.ts              # Configuration constants
├── Code-Editor-Structure.md  # This file
│
├── EditorLayout/          # Layout orchestration (at root level)
│   ├── components/        # EditorIntegrations side-effect wrapper
│   └── overlays/          # Modal overlays (Cmd+P search)
│
└── Panels/                # All UI panels
    ├── EditorPrimarySidebar/  # Left sidebar (files, search, git)
    ├── EditorMainPane/        # Main editing area (single pane)
    ├── EditorBottomPanel/     # Terminal, output, problems
    └── shared/                # Panel-specific shared components
```

## EditorLayout

The layout orchestrator (at CodeEditor root, not inside Panels):

```
EditorLayout/
├── index.tsx              # Main layout - orchestrates all panels
│
├── components/            # Layout sub-components
│   └── EditorIntegrations/    # Side-effect hooks wrapper
│
└── overlays/              # Modal/overlay components
    ├── FileSearchPanel/       # Quick file search (Cmd+P)
    └── SingleFileSearchPanel/ # Variant with spinner
```

## EditorPrimarySidebar

The left sidebar with collapsible tabs:

```
Panels/EditorPrimarySidebar/
├── index.tsx              # Main sidebar component
├── config.ts              # Icons, constants
├── types.ts               # Props, view modes
│
├── tabs/                  # Tab configuration hooks
│   ├── FilesTab.tsx       # useFilesTabConfig()
│   ├── SearchTab.tsx      # useSearchTabConfig()
│   ├── SourceControlTab.tsx
│   ├── TestingTab.tsx
│   └── ContextTab.tsx
│
├── content/               # Tab content components
│   ├── OutlineContent/
│   ├── SearchContent/
│   ├── SourceControlContent/
│   │   ├── components/    # Section components
│   │   ├── hooks/         # Content-specific hooks
│   │   └── utils/         # Tree utilities
│   ├── TestingContent/
│   ├── ContextContent/
│   ├── TimelineContent/
│   ├── StashContent/
│   └── AgentReviewContent/
│
├── hooks/                 # Shared sidebar hooks
│   ├── useExplorerTabs.ts
│   ├── useExplorerActions.tsx
│   ├── useFileSelection.ts
│   └── useSourceControlState/
│
└── utils/
    └── filterTree.ts
```

### tabs/ vs content/

| Folder     | Purpose               | Contains                                           |
| ---------- | --------------------- | -------------------------------------------------- |
| `tabs/`    | Tab **configuration** | Hooks that define tab structure, sections, actions |
| `content/` | Tab **rendering**     | UI components that render in each tab              |

## EditorMainPane

The main editing pane (single pane — no split support):

```
Panels/EditorMainPane/
├── index.tsx              # Main pane component
├── index.scss             # Pane styles
├── config.ts              # DEFAULT_PANEL_STATE
├── types.ts               # EditorPaneProps, EditorTabType
│
├── content/               # Tab content renderers
│   ├── CodeViewerContent/    # File editor with preview
│   ├── GitDiffContent/           # Historical / snapshot single-file diff
│   ├── SourceControlMainContent/ # Unified Source Control tab (Focus + All Changes)
│   └── FilePreviewContent/       # CSV, JSON, Image previewers
│
├── components/            # Pane subcomponents
│   ├── CloudReviewBar/       # Cloud review floating bar
│   └── CodeMirrorSearchPanel/ # In-editor find/replace (Cmd+F)
│
└── hooks/
    ├── useEditorPaneState.ts     # Tab state management
    ├── useFileContentManager.ts  # File save/discard/reload
    └── useTabContentSync.ts      # State synchronization
```

## EditorBottomPanel

The bottom panel (terminal, output, problems):

```
Panels/EditorBottomPanel/
├── index.tsx              # Main panel component
├── config.ts              # Icons, constants
├── types.ts               # Props, TabAction, TabConfig
│
├── tabs/                  # Tab configuration hooks
│   ├── TerminalTab.tsx
│   ├── ProblemsTab.tsx
│   ├── OutputTab.tsx
│   └── TestResultsTab.tsx
│
├── content/               # Tab content components
│   ├── ProblemsContent/      # Lint/TypeScript errors
│   ├── OutputContent/        # Output channels
│   └── TestResultsContent/   # Test runner results
│
├── hooks/
│   ├── useBottomPanelTabs.ts
│   └── useBottomPanelActions.tsx
│
└── components/
    └── BottomPanelHeader.tsx
```

## Panels/shared/

Components used across multiple CodeEditor panels:

```
Panels/shared/
├── index.ts              # Barrel export
├── SearchInput.tsx       # VSCode-style search input
├── SearchFilters.tsx     # Include/exclude filters
└── ReplaceInput.tsx      # Replace input with actions
```

## Adding New Sidebar Content

1. Create folder: `Panels/EditorPrimarySidebar/content/{Name}Content/`
2. Create tab config: `Panels/EditorPrimarySidebar/tabs/{Name}Tab.tsx`
3. Export `use{Name}TabConfig()` hook
4. Register in `useExplorerTabs.ts`

## Adding New Pane Content

1. Create folder: `Panels/EditorMainPane/content/{Name}Content/`
2. Add case to `renderTabContent()` in `EditorMainPane/index.tsx`
3. Define tab type in `types.ts`

## Adding New Overlays

1. Create folder: `EditorLayout/overlays/{Name}Panel/`
2. Import and render in `CodeEditor/index.tsx`
