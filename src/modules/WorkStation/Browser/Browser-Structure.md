# Browser Structure

**Last Updated:** 2025-01-29

## Overview

The Browser module provides web browsing and design canvas capabilities with integrated DevTools. It supports two modes: **Browser mode** (webview with DevTools) and **Designer mode** (canvas editor for .orgii files).

## Folder Structure

```
Browser/
├── index.tsx              # Main component
├── config.ts              # Configuration constants
├── types.ts               # BrowserProps and shared types
├── Browser-Structure.md   # This file
│
├── BrowserLayout/         # Layout orchestration (at root level)
│   ├── index.tsx          # Main layout - orchestrates all panels
│   └── components/
│       └── BrowserIntegrations.tsx  # Side-effect hooks wrapper
│
└── Panels/                # All UI panels
    ├── BrowserPrimarySidebar/   # Left sidebar (sessions, designer, settings)
    ├── BrowserMainPane/         # Main content area (webview or canvas)
    ├── BrowserSecondaryPanel/   # DevTools / Inspector panel
    └── shared/                  # Panel-specific shared components
```

## BrowserLayout

The layout orchestrator (at Browser root, not inside Panels):

```
BrowserLayout/
├── index.tsx              # Main layout - orchestrates all panels
│
└── components/
    └── BrowserIntegrations.tsx  # Side-effect hooks wrapper
```

**Responsibilities:**

- Compose `WorkStationShell` with sidebar, main content, right panel, status bar
- Manage mode switching (browser ↔ designer)
- Coordinate panel state (collapsed, widths)

## BrowserPrimarySidebar

The left sidebar with pill tabs:

```
Panels/BrowserPrimarySidebar/
├── index.tsx              # Main sidebar component
├── config.ts              # Icons, constants
│
├── tabs/                  # Tab configuration
│   ├── SessionsTab.tsx    # Browser sessions list
│   └── DesignerTab.tsx    # Design files + layers
│
├── content/               # Tab content components
│   ├── SessionsContent/   # Session list rendering
│   │   └── index.tsx
│   └── DesignerContent/   # Design files + layers
│       ├── index.tsx
│       └── components/
│           ├── DesignFilesList.tsx
│           └── LayersPanel/
│
└── hooks/                 # Sidebar-specific hooks
    └── useBrowserSidebarState.ts
```

### tabs/ vs content/

| Folder     | Purpose               | Contains                                           |
| ---------- | --------------------- | -------------------------------------------------- |
| `tabs/`    | Tab **configuration** | Hooks that define tab structure, sections, actions |
| `content/` | Tab **rendering**     | UI components that render in each tab              |

## BrowserMainPane

The main content area (supports browser/designer modes):

```
Panels/BrowserMainPane/
├── index.tsx              # Main pane - switches between modes
├── types.ts               # BrowserMainPaneProps, mode types
│
├── content/               # Mode content renderers
│   ├── WebViewportContent/    # Browser webview
│   │   ├── index.tsx
│   │   └── components/
│   │       └── WebUrlBar/
│   └── DesignerCanvasContent/ # Design canvas
│       ├── index.tsx
│       ├── hooks/
│       │   ├── useCanvasSetup.ts
│       │   ├── useDesignerCanvas.ts
│       │   ├── useDragOperations.ts
│       │   ├── useDrawingOperations.ts
│       │   └── useViewport.ts
│       └── components/
│           ├── CanvasControls.tsx
│           ├── DesignerToolbar/
│           └── EmptyState.tsx
│
└── components/            # Shared pane components
    └── FileHeader/        # Breadcrumb header for designer
```

## BrowserSecondaryPanel

The secondary panel (DevTools for browser, Inspector for designer):

```
Panels/BrowserSecondaryPanel/
├── index.tsx              # Main panel - switches based on mode
├── config.ts              # Icons, constants
├── types.ts               # Props, tab types
│
├── tabs/                  # Tab configuration hooks
│   ├── ElementsTab.tsx    # DOM tree + styling
│   ├── ConsoleTab.tsx     # Console logs
│   └── NetworkTab.tsx     # Network requests
│
├── content/               # Tab content components
│   ├── ElementsContent/   # DOM tree + design/CSS/source panels
│   │   ├── index.tsx
│   │   └── components/
│   │       ├── DOMTreeContent/
│   │       ├── DesignPanel/
│   │       ├── CSSPanel/
│   │       └── SourcePanel/
│   ├── ConsoleContent/    # Console log viewer
│   │   └── index.tsx
│   └── NetworkContent/    # Network request viewer
│       └── index.tsx
│
├── hooks/                 # Panel-specific hooks
│   ├── useElementsPanel.ts    # DOM tree + style editing state
│   └── useRightPanelTabs.ts   # Tab management
│
└── components/            # Panel subcomponents
    └── DesignerInspector/ # Inspector for designer mode
        ├── index.tsx
        ├── config.ts
        ├── types.ts
        └── sections/
            ├── PositionSizeSection.tsx
            ├── FillSection.tsx
            ├── StrokeSection.tsx
            ├── TextSection.tsx
            └── ...
```

## Panels/shared/

Components used across multiple Browser panels:

```
Panels/shared/
├── index.ts              # Barrel export
└── (shared panel components)
```

## Mode Architecture

The Browser supports two mutually exclusive modes:

| Mode     | Main Content           | Right Panel       | Status Bar       |
| -------- | ---------------------- | ----------------- | ---------------- |
| Browser  | WebViewport (webview)  | WebDevTools       | BrowserStatusBar |
| Designer | DesignerCanvas (.orgii) | DesignerInspector | BrowserStatusBar |

Mode switching is controlled by `designerModeActive` state, managed in `BrowserLayout`.

## Adding New Sidebar Content

1. Create folder: `Panels/BrowserPrimarySidebar/content/{Name}Content/`
2. Create tab config: `Panels/BrowserPrimarySidebar/tabs/{Name}Tab.tsx`
3. Export `use{Name}TabConfig()` hook
4. Register in sidebar tabs array

## Adding New DevTools Tab

1. Create folder: `Panels/BrowserSecondaryPanel/content/{Name}Content/`
2. Create tab config: `Panels/BrowserSecondaryPanel/tabs/{Name}Tab.tsx`
3. Add to tab pill configuration in `BrowserSecondaryPanel/index.tsx`

## Adding New Inspector Section

1. Create section: `Panels/BrowserSecondaryPanel/components/DesignerInspector/sections/{Name}Section.tsx`
2. Export from `sections/index.ts`
3. Add to `DesignerInspector/index.tsx` render

## Key Hooks (External)

These hooks live in `@src/hooks/workStation/browser/`:

| Hook                  | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `useBrowserSessions`  | Session management, console/network logs, inspector |
| `useBrowserTabs`      | Unified tab system for browser + designer tabs      |
| `useDesignerState`    | Designer mode state (documents, selection, tools)   |
| `useDesignerKeyboard` | Keyboard shortcuts for designer                     |

## File Size Guidelines

| Type          | Max Lines |
| ------------- | --------- |
| Hook files    | 500       |
| UI components | 300       |
| Config files  | 200       |

When a file exceeds these limits, split into subfolders with `components/`, `hooks/`, or `utils/`.

## Migration Status

- [x] Phase 1: Create folder structure
- [x] Phase 2: Extract BrowserLayout
- [ ] Phase 3: Create BrowserMainPane index (orchestrator)
- [ ] Phase 4: Refactor BrowserRightPanel (split WebDevTools)
- [ ] Phase 5: Create Panels/shared, update sidebar
