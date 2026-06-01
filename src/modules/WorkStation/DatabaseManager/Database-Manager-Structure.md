# DatabaseManager Structure

**Last Updated:** 2025-01-29

## Overview

The DatabaseManager module provides a database exploration and management experience with connection management, table viewing, and SQL query execution.

## Folder Structure

```
DatabaseManager/
├── index.tsx                        # Main component
├── config.ts                        # Configuration constants
├── Database-Manager-Structure.md    # This file
│
├── DatabaseLayout/                  # Layout orchestration (at root level)
│   ├── index.tsx                   # Main layout - orchestrates all panels
│   ├── components/                 # Layout sub-components
│   │   └── DatabaseIntegrations/   # Side-effect hooks wrapper
│   └── overlays/                   # Modal overlays
│       └── AddConnectionModal/     # Add remote connection modal
│
└── Panels/                         # All UI panels
    ├── DatabasePrimarySidebar/     # Left sidebar (connections, history)
    ├── DatabaseMainPane/           # Main content area (table/SQL)
    └── shared/                     # Panel-specific shared components
```

## DatabaseLayout

The layout orchestrator (at DatabaseManager root, not inside Panels):

```
DatabaseLayout/
├── index.tsx                       # Main layout - orchestrates all panels
│
├── components/                     # Layout sub-components
│   └── DatabaseIntegrations/       # Side-effect hooks wrapper
│
└── overlays/                       # Modal/overlay components
    └── AddConnectionModal/         # Add Supabase/Turso connection
```

## DatabasePrimarySidebar

The left sidebar with collapsible tabs:

```
Panels/DatabasePrimarySidebar/
├── index.tsx                       # Main sidebar component
├── config.ts                       # Icons, constants
├── types.ts                        # Props, types
│
├── tabs/                           # Tab configuration hooks
│   ├── ConnectionsTab.tsx          # useConnectionsTabConfig()
│   └── QueryHistoryTab.tsx         # useQueryHistoryTabConfig()
│
├── content/                        # Tab content components
│   ├── ConnectionsContent/
│   │   ├── index.tsx              # Main connections content
│   │   └── components/
│   │       ├── AddedConnectionsList.tsx
│   │       └── PendingConnectionsList.tsx
│   └── QueryHistoryContent/
│       └── index.tsx              # Query history list
│
└── hooks/
    └── useDatabaseSidebarState.ts  # Shared sidebar state
```

### tabs/ vs content/

| Folder     | Purpose               | Contains                                           |
| ---------- | --------------------- | -------------------------------------------------- |
| `tabs/`    | Tab **configuration** | Hooks that define tab structure, sections, actions |
| `content/` | Tab **rendering**     | UI components that render in each tab              |

## DatabaseMainPane

The main content pane (table viewer / SQL editor):

```
Panels/DatabaseMainPane/
├── index.tsx                       # Main pane component
├── config.ts                       # View mode constants
├── types.ts                        # ViewMode, props types
│
├── content/                        # View content renderers
│   ├── TableViewContent/           # Table data grid view
│   │   └── index.tsx
│   └── SqlQueryContent/            # SQL editor view
│       └── index.tsx
│
├── components/                     # Pane subcomponents
│   ├── DataGrid/                   # Table data viewer
│   │   ├── index.tsx
│   │   ├── index.scss
│   │   ├── ActionBar.tsx           # CRUD toolbar
│   │   ├── InlineEditCell.tsx      # Cell editing
│   │   └── InsertRowModal.tsx      # New row modal
│   └── SqlQueryEditor/             # SQL code editor
│       ├── index.tsx
│       ├── index.scss
│       └── QueryResults.tsx        # Query results display
│
└── hooks/
    └── useTableContentState.ts     # Table view state management
```

## Adding New Sidebar Content

1. Create folder: `Panels/DatabasePrimarySidebar/content/{Name}Content/`
2. Create tab config: `Panels/DatabasePrimarySidebar/tabs/{Name}Tab.tsx`
3. Export `use{Name}TabConfig()` hook
4. Register in sidebar `index.tsx`

## Adding New Pane Content

1. Create folder: `Panels/DatabaseMainPane/content/{Name}Content/`
2. Add view mode to `types.ts`
3. Add case to view mode switch in `DatabaseMainPane/index.tsx`

## Adding New Overlays

1. Create folder: `DatabaseLayout/overlays/{Name}Modal/`
2. Import and render in `DatabaseLayout/index.tsx`
