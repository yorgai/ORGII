# Hooks organization

This document describes the organization of the `src/hooks/` folder — layout, patterns, and how it relates to module-level hooks.

**Important:** Session hooks live in `src/engines/SessionCore/hooks/session` (not `src/hooks/session`). See the Session Hooks section below.

---

## Hybrid Strategy: Shared vs Colocated Hooks

### Core Rule: `src/hooks/` is for hooks used by **2+ modules**

| Location                      | When to Use                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `src/hooks/{category}/`       | Hook is imported by **2+ distinct** `src/modules/*` directories |
| `src/modules/{Module}/hooks/` | Hook is **only** used within that single module                 |

### Decision Flowchart

```
Is this hook used by 2+ modules?
├── YES → Place in src/hooks/{category}/
└── NO  → Is it a general utility (debounce, dimensions, etc.)?
          ├── YES → Place in src/hooks/ (anticipate reuse)
          └── NO  → Colocate in src/modules/{Module}/hooks/
```

### Examples

```typescript
// ✅ SHARED: Used by WorkStation, MainApp, scaffold
// Location: src/hooks/theme/useBackgroundImage.ts
import { useBackgroundImage } from "@src/hooks/theme";

// ✅ COLOCATED: Only used by Browser module
// Location: src/modules/WorkStation/Browser/hooks/useWebviewDOMTree.ts
import { useWebviewDOMTree } from "../hooks/useWebviewDOMTree";
// ✅ COLOCATED: Only used by CodeEditor
// Location: src/modules/WorkStation/CodeEditor/Panels/.../hooks/useFolderSelection.ts
import { useFolderSelection } from "./hooks/useFolderSelection";
```

### Completed Migrations (2026-03-30)

The following single-module hooks have been migrated to their consuming modules:

| Folder                 | Old Location          | New Location                                     | Status      |
| ---------------------- | --------------------- | ------------------------------------------------ | ----------- |
| `browser/` (13 hooks)  | `src/hooks/browser/`  | `src/modules/WorkStation/Browser/hooks/`         | ✅ Migrated |
| `osagent/` (4 hooks)   | `src/hooks/osagent/`  | `src/modules/WorkStation/Browser/hooks/osagent/` | ✅ Migrated |
| `lsp/` (3 hooks)       | `src/hooks/lsp/`      | `src/modules/MainApp/Integrations/hooks/lsp/`    | ✅ Migrated |
| `filesync/` (10 files) | `src/hooks/filesync/` | `src/engines/CloudFileSync/hooks/`               | ✅ Migrated |
| `ai/` (unused)         | `src/hooks/ai/`       | —                                                | ✅ Deleted  |
| `replay/` (empty stub) | `src/hooks/replay/`   | —                                                | ✅ Deleted  |

### Confirmed Shared Hooks (KEEP in `src/hooks/`)

| Folder         | Consumer Count | Key Consumers                                         |
| -------------- | -------------- | ----------------------------------------------------- |
| `workStation/` | 6+             | WorkStation, ProjectManager, scaffold, store, engines |
| `marketplace/` | 3              | Marketplace, Integrations, WizardSystem               |
| `theme/`       | 4+             | MainApp, scaffold, engines, components                |
| `settings/`    | 6+             | Settings, CodeMirror, SessionCore, features           |
| `perf/`        | 4+             | WorkStation, MainApp, scaffold                        |
| `git/`         | 5+             | Multiple modules and features                         |
| `keyboard/`    | 3+             | WorkStation, MainApp, features                        |

---

## Organization principles

1. **Hybrid Placement:** Shared hooks in `src/hooks/`, module-specific hooks colocated
2. **2+ Module Rule:** Only hooks used by 2+ modules belong in `src/hooks/`
3. **Single Responsibility:** Each hook has one clear purpose
4. **Type Safety:** Full TypeScript support with exported types
5. **Barrel Exports:** Clean import paths through category index files
6. **No Dead Code:** All hooks actively used and maintained

---

## 🏗️ Folder Structure

### Main Hooks Folder (`/src/hooks`)

The table below reflects the actual disk layout as of the last update.

| Category           | Files | Description                                                                                                                        |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `workStation/`     | 74    | WorkStation-specific: editor, tabs, panels, file content, browser, chat, indexing, diagnostics, search, sessionCapture, git output |
| `git/`             | 26    | Git operations, source control, repo selection, diff, blame                                                                        |
| `ui/`              | 27    | Layout, tabs, sidebar, spotlight, resize, scroll, animations                                                                       |
| `platform/`        | 16    | OS integrations, webview, webview visibility, window focus                                                                         |
| `market/`          | 14    | Marketplace: consumer wallet, provider listings, earnings, onboarding                                                              |
| `navigation/`      | 11    | Global shortcuts, app navigation, route helpers                                                                                    |
| `theme/`           | 10    | Background image, glass material, contrast, edge reflection                                                                        |
| `extensions/`      | 9     | VS Code extension bridge, extension host hooks                                                                                     |
| `models/`          | 8     | Model selector, provider list, model config                                                                                        |
| `auth/`            | 4     | Login, OAuth, session token, auth state                                                                                            |
| `config/`          | 3     | Local storage, agent config, app config                                                                                            |
| `database/`        | 5     | DB connection, query, schema hooks                                                                                                 |
| `dependencies/`    | 3     | Dependency management hooks                                                                                                        |
| `dropdown/`        | 3     | Dropdown state, positioning                                                                                                        |
| `files/`           | 3     | File picker, file path helpers                                                                                                     |
| `flowAwareness/`   | 5     | Flow awareness, focus tracking                                                                                                     |
| `geo/`             | 3     | Geo/location helpers                                                                                                               |
| `i18n/`            | 2     | Translation, locale switching                                                                                                      |
| `input/`           | 3     | Tiptap editor, text input helpers                                                                                                  |
| `keyVault/`        | 5     | BYOK key vault CRUD (own_key + hosted_key, both file-backed); validation + reference-prices stub for OSS                           |
| `keyboard/`        | 4     | Keyboard shortcuts, hotkeys                                                                                                        |
| `lifecycle/`       | 1     | Component lifecycle helpers                                                                                                        |
| `logger/`          | 2     | Logging hooks                                                                                                                      |
| `mcp/`             | 5     | MCP server management, MCP tool hooks                                                                                              |
| `perf/`            | 4     | Performance measurement, render timing                                                                                             |
| `plugins/`         | 5     | Plugin registry, plugin lifecycle                                                                                                  |
| `policies/`        | 2     | Policy management hooks                                                                                                            |
| `project/`         | 6     | Project management, workspace tracking                                                                                             |
| `search/`          | 3     | Code search, hybrid search                                                                                                         |
| `session/`         | 3     | `useNativeSessionStatusMonitor`, `useSessionPatch`, `useSessionWorkspaceSync` — cross-engine session hooks                         |
| `settings/`        | 6     | App settings, theme settings, editor settings                                                                                      |
| `skills/`          | 3     | Agent skills management                                                                                                            |
| `storage/`         | 3     | Local storage, IndexedDB helpers                                                                                                   |
| `streaming/`       | 2     | SSE/streaming hooks                                                                                                                |
| `terminal/`        | 6     | Terminal integration, process management                                                                                           |
| `testRunner/`      | 2     | Test execution hooks                                                                                                               |
| `wingman/`         | 1     | Wingman agent hooks                                                                                                                |
| `async/`           | 2     | Async utilities                                                                                                                    |
| `cliSession/`      | 1     | CLI session helpers                                                                                                                |
| `code/`            | 2     | Syntax highlighting, code utilities                                                                                                |
| `fileReview/`      | 2     | File review, inline comment hooks                                                                                                  |
| `useFileUpload.ts` | 1     | File upload (root-level)                                                                                                           |

**Total in `src/hooks/`:** ~213 files across 41 categories.

> **Note:** Session lifecycle hooks (`useSessionManager`, `useSessionCreator`, `useQueueDispatch`, etc.) live in `src/engines/SessionCore/hooks/`, not here. `src/hooks/session/` contains only the 3 cross-engine utilities listed above.

### `workStation/` Sub-structure

```
workStation/
├── browser/       # Browser app hooks
├── chat/          # Chat panel hooks
├── database/      # Database app hooks
├── diagnostics/   # Diagnostics panel
├── editor/        # Code editor — useFileContent (versioned, with cache/mtime/external-change)
├── fileContent/   # Pure utility layer for editor/useFileContent (cache, mtime, errors, types)
├── git/           # Git operations within WorkStation
├── indexing/      # Incremental file-watch indexing
├── output/        # Output panel, file-watch output integration
├── panels/        # Panel layout, mention tree position
├── search/        # Code search
├── sessionCapture # Session capture hooks
├── tabs/          # WorkStation tab management
├── useCodeEditor/ # Composite hook: useFileTree + useFileContent + useFileSearch
│                  # Note: useCodeEditor/useFileContent uses Jotai atoms (global state);
│                  #       editor/useFileContent uses local React state + versioning.
│                  #       These serve different consumers and are NOT duplicates.
└── useGitOutputIntegration/
```

### Session Hooks (`/src/engines/SessionCore/hooks/session`)

**Important:** Session hooks live in `src/engines/SessionCore/hooks/session`.

```
src/engines/SessionCore/hooks/session/
├── index.ts                     # Main exports
│
├── useSessionManager.ts        # Session lifecycle management
├── useSessionDiscovery.ts      # Session discovery
├── useSessionCreator/          # Session creation
│   ├── index.ts
│   ├── useSessionCreator.ts   # Main creator hook
│   ├── useDraftManagement.ts   # Draft management
│   ├── useFileUpload.ts        # File upload
│   ├── useRepositoryManagement.ts # Repo management
│   ├── useSessionLaunch/       # Session launch subfolder
│   ├── useSessionValidation.ts # Session validation
│   ├── useSourceSelection.ts  # Source selection
│   └── types.ts                # Type definitions
│
├── usePlanFilePersistence.ts   # Plan file generation
└── useTodoSync.ts              # Todo event sync
```

---

## 📊 Hook Statistics

### Main Hooks (`/src/hooks`)

| Location                         | Files    | Notes                                      |
| -------------------------------- | -------- | ------------------------------------------ |
| `src/hooks/` (all categories)    | **~213** | Covers 41 sub-directories                  |
| `src/engines/SessionCore/hooks/` | **~98**  | Session lifecycle, replay, market-key sync |
| **Grand Total**                  | **~311** | All actively maintained                    |

> Previous counts (~84 in `src/hooks/`) reflected an earlier, smaller codebase. The repo has grown significantly since that audit; the table above is based on the actual disk state.

### Session Hooks (`/src/engines/SessionCore/hooks/`)

| Sub-directory | Description                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `session/`    | `useSessionCreator`, `useSessionManager`, `useSessionDiscovery`, `useQueueDispatch`                  |
| `replay/`     | `useReplayState`, `useStepState`, `useRecentFiles`, `usePlanningIndicator`, `useRecentFilesForEvent` |
| `hostedKey/`  | `useHostedKeyActivitySync`, `usePartialRecovery`                                                     |

---

## 🎯 Hook Categories

### 1. Session Hooks (`/src/engines/SessionCore/hooks/session`)

**Important:** Session hooks are located in `/src/engines/SessionCore/hooks/session`, not `/src/hooks/session`.

#### `useSessionStore`

**Location:** `src/session/hooks/useSessionStore.ts`

**Purpose:** Primary hook for session state management - single source of truth

**Features:**

- Event management (all events, chat events, simulator events)
- Current event navigation
- Replay state management
- Session metadata (sessionId, loadStatus, runStatus)
- Pagination support

**Usage:**

```typescript
import { useSessionStore } from "@src/session/hooks";

const {
  events,
  chatEvents,
  simulatorEvents,
  currentEvent,
  navigateNext,
  navigatePrev,
  replayMode,
  sessionId,
  loadSession,
  appendEvents,
} = useSessionStore();
```

#### `useSessionSync`

**Location:** `src/session/hooks/useSessionSync/`

**Purpose:** Real-time session updates via WebSocket (primary) with polling fallback

**Features:**

- WebSocket-first architecture for local sessions
- Polling fallback when WebSocket unavailable
- Cloud activity sync for marketplace sessions
- Activity pagination
- Streaming support (thinking, messages)
- Tool call grouping

**Usage:**

```typescript
import { useSessionSync } from "@src/session/hooks";

const {
  status,
  activities,
  pendingQuestion,
  connectionMode,
  answerQuestion,
  pollNow,
} = useSessionSync({
  sessionId,
  pollInterval: 5000,
  enabled: true,
});
```

#### `useSessionManager`

**Location:** `src/session/hooks/useSessionManager.ts`

**Purpose:** Session lifecycle management and discovery

**Features:**

- Load and manage session list
- Session selection
- Cache management
- Validation

**Usage:**

```typescript
import { useSessionManager } from "@src/session/hooks";

const { sessions, selectedSessionId, selectSession, loadSessions, loading } =
  useSessionManager();
```

#### Other Session Hooks

- **`SessionSyncProvider` / `sync/useSessionSync`** - Keeps Tauri session events loaded (see `Documentation/Session/unified-session-sync--0322.md`)
- **`useCloudActivitySync`** - Cloud activity sync for marketplace sessions
- **`useSessionDiscovery`** - Discover sessions (active, last, list)
- **`useCancelSession`** - Cancel running sessions
- **`useSessionCreator`** - Complete session creation workflow
- **`useReplayState`** - Replay state management
- **`useStepState`** - Step state management
- **`useRecentFiles`** - Track recently accessed files
- **`useRecentFilesForEvent`** - Get recent files for specific events
- **`useUnifiedSource`** - Unified source management

---

### 2. ChatPanel Hooks (`src/features/ChatPanel/hooks/`)

Chat hooks live alongside the ChatPanel feature module they serve.

- **`useWorkspaceChat`** - Chat message sending, queue integration, session dispatch
- **`useChatPanelState`** - Chat panel tab and UI state
- **`useSessionContexts`** - Session context items
- **`useInputArea/`** - Input area (at-mention, slash commands, file selection, drag-drop)
- **`useReplyQuestion`** - Question reply and ignore handling

**Session Dispatch (`src/engines/SessionCore/dispatch/`):**

- **`agentDispatcher`** - Send/interrupt for `rust_agent` sessions
- **`cliDispatcher`** - Send/interrupt/resume for `cli_agent` sessions
- **`registry`** - Maps `SessionCategory` → `SessionDispatcher`
- **`useQueueDispatch`** - Queue consumer in `SessionCore/hooks/session/`

---

### 3. Git & Repository Operations

Git hooks handle repository management and status tracking.

#### `useRepoSelection.ts`

**Purpose:** Main repository and branch selection

**Features:**

- Repository selection
- Branch selection
- State management

**Usage:**

```typescript
import { useRepoSelection } from "@src/hooks/git";

const { selectedRepo, selectedBranch, setSelectedRepo, setSelectedBranch } =
  useRepoSelection();
```

#### Other Git Hooks

- **`useRepoState`** - Read-only repository state access
- **`useRepoDropdownActions`** - Dropdown action handlers

**Note:** Git status is now handled by contexts:

- `GitStatusContextSimple` (single repo)
- `MultiRepoGitStatusContext` (repo list badges)

---

### 4. Editor & Code

Editor hooks manage code editor functionality.

#### `useCodeSearch.ts`

**Purpose:** Code search functionality

**Features:**

- Full-text search
- Semantic search
- Result ranking
- Search history

#### Other Editor Hooks

- **`useDiff`** - Diff viewing and comparison
- **`useContextMenu`** - Context menu management
- **`useCursorCredentialCapture`** - Capture credentials

### 5. Marketplace (`src/hooks/market/`)

Marketplace hooks (~14 files). Import from `@src/hooks/market`.

- Consumer wallet, provider listings, provider earnings, provider onboarding
- Session-level hosted key hooks live in `src/engines/SessionCore/hooks/hostedKey/`

---

### 6. UI - Tabs

Tab management hooks handle global tab state (state only, no navigation).

> **Note:** For navigation, use `useAppNavigation` from `@src/hooks/navigation`. See [Navigation System](./navigation-system-0201.md).

#### `useMainAppTabs.ts`

**Purpose:** MainApp tab state management (state only, no navigation)

**Features:**

- Tab creation/deletion
- Active tab tracking
- Tab ordering
- Tab lookup by route

**Usage:**

```typescript
import { useMainAppTabs } from "@src/hooks/ui/tabs";

const { tabs, activeTab, closeTab, switchTab, openOrCreateTab } =
  useMainAppTabs();
```

#### `useSessionView.ts`

**Purpose:** Session view state management

**Features:**

- Session route tracking
- Active session ID
- Session navigation helpers

#### `useSessionRouteSync.ts`

**Purpose:** Session route synchronization

#### Other Tab Hooks

- **`useTabNavigation`** - Keyboard navigation and shortcuts

---

### 7. UI - Sidebar

> Note: Numbers 6, 7, 8, 9 group the UI sub-categories.

Sidebar hooks manage sidebar state and visibility.

#### `useSidebarState.ts`

**Purpose:** Sidebar state management

**Features:**

- Visibility control
- Width management
- Active panel tracking
- Persistence

**Usage:**

```typescript
import { useSidebarState } from "@src/hooks/ui/sidebar";

const { isVisible, width, toggle, resize } = useSidebarState();
```

#### Other Sidebar Hooks

- **`useSidebarPageState`** - Page-specific sidebar state
- **`useIsShowSidebar`** - Sidebar visibility check

---

### 8. UI - Layout

Layout hooks handle responsive sizing and dimensions.

#### `useElementDimensions.ts`

**Purpose:** Track element size and dimensions

**Features:**

- Width/height tracking
- Resize observation
- Debounced updates
- Optional dimension selection

**Usage:**

```typescript
import { useElementDimensions } from "@src/hooks/ui/layout";

const elementRef = useRef(null);
const width = useElementDimensions(elementRef, { dimension: "width" });
const height = useElementDimensions(elementRef, { dimension: "height" });
const both = useElementDimensions(elementRef); // { width, height }
```

#### Other Layout Hooks

- **`useContainerHeight`** - Container height management
- **`useHeight`** - Generic height hook
- **`useWidth`** - Generic width hook
- **`useResizablePanelWidth`** - Resizable panel width

---

### 9. UI - Effects

UI effect hooks provide animations and visual effects.

#### `useProgressiveImage.ts`

**Purpose:** Progressive image loading

**Features:**

- Placeholder images
- Lazy loading
- Load state tracking
- Blur-up effect

**Usage:**

```typescript
import { useProgressiveImage } from "@src/hooks/ui/effects";

const { src, isLoading } = useProgressiveImage({
  placeholder: "/placeholder.jpg",
  src: "/full-image.jpg",
});
```

#### Other Effect Hooks

- **`useAutoScrollEffect`** - Automatic scrolling behavior

---

### 10. Theme & Visual

Theme hooks manage visual effects and theming.

#### `useBackgroundImage.ts`

**Purpose:** Background image management

**Features:**

- Image selection
- Upload handling
- Preview generation
- Blur effects

**Usage:**

```typescript
import { useBackgroundImage } from "@src/hooks/theme";

const { backgroundImage, setBackgroundImage, clearBackground } =
  useBackgroundImage();
```

#### Other Theme Hooks

- **`useBackgroundImageStorage`** - Background persistence
- **`useGlassMaterial`** - Glass material effects
- **`useContrastJs`** - Contrast.js integration
- **`useEdgeReflection`** - Edge reflection effects

---

### 11. Events

Event hooks handle event processing and rendering.

#### `useBatchEventHandler.tsx`

**Purpose:** Batch event processing

**Features:**

- Event batching
- Debounced updates
- Priority handling
- Performance optimization

**Usage:**

```typescript
import { useBatchEventHandler } from "@src/hooks/events";

const { handleEvent, processBatch, pending } = useBatchEventHandler();
```

#### Other Event Hooks

- **`useBatchedWebSocketUpdates`** - Batched WebSocket updates
- **`useRuleEvent`** - Rule-based event handling

**Note**: Event rendering is now handled by the unified event system (`useUnifiedEventRenderer`, `useChatAdapter`, `useSimulatorAdapter`) in `src/features/EventCore/`.

---

### 12. Configuration (`src/hooks/config/`, `src/hooks/settings/`, `src/hooks/storage/`)

Configuration hooks manage app settings and preferences.

#### `useLocalStorage.ts`

**Purpose:** Local storage hook

**Features:**

- Type-safe storage
- Default values
- Change detection
- SSR-safe

**Usage:**

```typescript
import { useLocalStorage } from "@src/hooks/config";

const [value, setValue] = useLocalStorage("key", defaultValue);
```

#### Other Config Hooks

- **`useAgentConfig`** - Agent configuration management

---

### 13. Navigation

#### `useGlobalShortcuts.ts`

**Purpose:** Global keyboard shortcuts

**Features:**

- Shortcut registration
- Command execution
- Conflict detection
- Platform-specific keys

**Usage:**

```typescript
import { useGlobalShortcuts } from "@src/hooks/navigation";

const { registerShortcut, unregisterShortcut } = useGlobalShortcuts();
```

---

### 14. Platform

Platform hooks handle platform-specific integrations.

#### Platform Hooks

- **`useInlineWebview`** - Inline webview management
- **`useWebviewVisibility`** - Webview visibility tracking
- **`useWindowFocusTracking`** - Window focus state tracking

---

### 15. Authentication

#### `useLogin.ts`

**Purpose:** User authentication

**Features:**

- Login/logout
- Session management
- Token handling
- Auth state tracking

**Usage:**

```typescript
import { useLogin } from "@src/hooks/auth";

const { user, login, logout, isAuthenticated } = useLogin();
```

---

## 📚 Import Guidelines

### Recommended Imports

```typescript
// ✅ Chat hooks — now in ChatPanel feature folder
// ✅ Session dispatch registry
import { getDispatcher } from "@src/engines/SessionCore/dispatch";
// ✅ Session hooks (SessionCore engine)
import { useSessionManager } from "@src/engines/SessionCore/hooks/session";
import { useQueueDispatch } from "@src/engines/SessionCore/hooks/session";
import { useChatPanelState } from "@src/features/ChatPanel/hooks/useChatPanelState";
import { useInputArea } from "@src/features/ChatPanel/hooks/useInputArea";
import { useWorkspaceChat } from "@src/features/ChatPanel/hooks/useWorkspaceChat";
import { useRepoSelection } from "@src/hooks/git";
// ✅ Other shared hooks
import { useTabState } from "@src/hooks/ui/tabs";
```

### Important Notes

- **Session hooks** are in `/src/engines/SessionCore/hooks/session`, not `/src/hooks/session`
- Use category imports when importing multiple hooks from same category
- Use direct imports for single hook usage

### Import Type Definitions

```typescript
// ✅ Import types alongside hooks
import {
  useSessionManager,
  type UseSessionManagerOptions,
  type UseSessionManagerReturn
} from "@src/engines/SessionCore/hooks/session";

// ✅ Import all types
import type * from "@src/engines/SessionCore/sync/types/syncTypes";
```

---

## 🎯 Hook Development Best Practices

### 1. Hook Structure Template

````typescript
/**
 * useMyFeature Hook
 *
 * Description: Brief description of what this hook does
 *
 * Features:
 * - Feature 1: Description
 * - Feature 2: Description
 *
 * @example
 * ```typescript
 * const { data, loading } = useMyFeature({
 *   autoLoad: true
 * });
 * ```
 */
import { useCallback, useEffect, useState } from "react";

// ============================================
// Type Definitions
// ============================================

export interface UseMyFeatureOptions {
  /** Whether to load data automatically */
  autoLoad?: boolean;
  /** Callback on success */
  onSuccess?: (data: Data[]) => void;
}

export interface UseMyFeatureReturn {
  /** Current data */
  data: Data[];
  /** Loading state */
  loading: boolean;
  /** Refresh data */
  refresh: () => Promise<void>;
}

// ============================================
// Hook Implementation
// ============================================

export function useMyFeature(
  options: UseMyFeatureOptions = {}
): UseMyFeatureReturn {
  const [data, setData] = useState<Data[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchData();
      setData(result);
      options.onSuccess?.(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => {
    if (options.autoLoad) {
      refresh();
    }
  }, [options.autoLoad, refresh]);

  return { data, loading, refresh };
}
````

### 2. Naming Conventions

```typescript
// ✅ Good hook names
useSessionManager; // Clear domain and purpose
useTabState; // Simple and descriptive
useGlobalGitStatus; // Indicates scope (global)
useWorkflowExecution; // Action-oriented

// ❌ Bad hook names
useData; // Too generic
useHelper; // Vague purpose
useThing; // Meaningless
useUtils; // Not specific
```

### 3. Single Responsibility

```typescript
// ✅ Good - focused purpose
hooks / session / useSessionManager.ts; // Only session lifecycle
useSessionSync.ts; // Only real-time updates
useSessionTasks.ts; // DELETED - use TaskKanban version

// ❌ Bad - mixed responsibilities
hooks / useSession.ts; // Does everything
```

### 4. Proper Dependencies

```typescript
// ✅ Good - minimal dependencies
const refresh = useCallback(async () => {
  // Implementation
}, [specificDep1, specificDep2]);

// ❌ Bad - unnecessary dependencies
const refresh = useCallback(async () => {
  // Implementation
}, [obj1, obj2, arr1]); // Too many/unstable deps
```

### 5. Error Handling

```typescript
// ✅ Good - comprehensive error handling
export function useMyFeature() {
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getData();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("useMyFeature:", err);
    }
  }, []);

  return { fetch, error };
}

// ❌ Bad - no error handling
export function useMyFeature() {
  const fetch = async () => {
    const data = await api.getData(); // Can throw!
    return data;
  };

  return { fetch };
}
```

---

## 🚀 Common Patterns

### Pattern 1: Loading State

```typescript
export function useDataLoader() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchData();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, load };
}
```

### Pattern 2: Debounced Hook

```typescript
export function useDebouncedSearch(delay = 300) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  const debouncedSearch = useMemo(
    () =>
      debounce(async (searchTerm: string) => {
        if (!searchTerm) {
          setResults([]);
          return;
        }

        const data = await api.search(searchTerm);
        setResults(data);
      }, delay),
    [delay]
  );

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  return { query, setQuery, results };
}
```

### Pattern 3: Cleanup Effect

```typescript
export function useWebSocketConnection(url: string) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    // Cleanup on unmount
    return () => {
      ws.close();
    };
  }, [url]);

  return { isConnected };
}
```

### Pattern 4: Atom Integration

```typescript
import { useAtom } from "jotai";

import { sessionAtom } from "@src/store/session";

export function useSession() {
  const [session, setSession] = useAtom(sessionAtom);

  const updateSession = useCallback(
    (updates: Partial<Session>) => {
      setSession((prev) => (prev ? { ...prev, ...updates } : null));
    },
    [setSession]
  );

  return { session, updateSession };
}
```

---

## 🔧 Maintenance Guidelines

### Adding New Hooks

1. **Choose the Right Category**
   - Session-related → `session/`
   - UI components → `ui/`
   - Business logic → appropriate domain folder

2. **Create Hook File**

   ```typescript
   // src/hooks/category/useNewFeature.ts
   export function useNewFeature() {
     // Implementation
   }
   ```

3. **Add to Category Index**

   ```typescript
   // src/hooks/category/index.ts
   export { useNewFeature } from "./useNewFeature";
   export type {
     UseNewFeatureOptions,
     UseNewFeatureReturn,
   } from "./useNewFeature";
   ```

4. **Document Usage**
   - Add JSDoc comments
   - Include examples
   - Document all parameters

### Deprecating Hooks

1. **Mark as deprecated**

   ```typescript
   /**
    * @deprecated Use useNewHook from @src/hooks/category instead
    */
   export function useOldHook() { ... }
   ```

2. **Update all usages** in codebase

3. **Remove from exports** after migration

4. **Delete file** after confirmation

### Refactoring Checklist

- [ ] Identify hook purpose and category
- [ ] Check for similar existing hooks
- [ ] Verify all imports/usages
- [ ] Update category index.ts
- [ ] Update main hooks/index.ts
- [ ] Test hook in isolation
- [ ] Update documentation
- [ ] Run linter and type check

---

## ✅ Best Practices Checklist

### Hook Design

- [ ] Single, clear responsibility
- [ ] Proper TypeScript types
- [ ] Comprehensive error handling
- [ ] Cleanup effects when needed
- [ ] Documented with JSDoc
- [ ] Usage examples provided

### File Organization

- [ ] Placed in correct category
- [ ] Named clearly and descriptively
- [ ] Exported from category index
- [ ] Types exported alongside hook

### Code Quality

- [ ] No unnecessary dependencies
- [ ] Proper useCallback/useMemo usage
- [ ] Error boundaries where needed
- [ ] Loading states managed
- [ ] No console errors

---

## 📊 Cleanup History

### Phase 0: Initial Cleanup (31 hooks removed)

Removed 24 hooks from `src/hooks/` and 7 from `WorkspaceHooks/` that were never imported.

### Phase 1: Structure Creation (77 hooks moved)

- Created 14 category folders
- Moved all hooks to categories
- Created index files with exports
- Eliminated `WorkspaceHooks/` folder

### Phase 2: Import Updates (~500 imports)

- Updated all import paths
- Fixed default vs named exports
- Cleaned up duplicate exports

### Phase 3: Legacy Cleanup (30 hooks removed)

- Removed 30 additional unused hooks
- Deleted 3 empty categories (marketplace, navigation, analytics)
- Removed deprecated wrapper functions
- Cleaned up dual exports

### Final Result

- **Original:** 116 hooks (many unused)
- **After cleanup:** 57 active, maintained hooks
- **Removed:** 61 unused hooks total
- **Categories:** 14 organized categories

---

## Related documentation

- **Store:** `src/store/store-organization.md`
- **State management (extended):** `Documentation/Shared/state-management/state-management--1226.md`
- **Util:** `src/util/util-organization.md`
- **API (incl. typed RPC):** `src/api/api_organization.md`

---

## 📖 External Resources

- [React Hooks Documentation](https://react.dev/reference/react/hooks)
- [Custom Hooks Best Practices](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Jotai with Hooks](https://jotai.org/)

---

**Status:** ✅ Well-organized and actively maintained  
**Last Cleanup:** May 7, 2026  
**Next Review:** As needed during feature development

---

---

## Gradual Migration Guide

When working on a module, check if its hooks can be colocated:

### Before Creating a New Hook

1. **Check existing hooks** — search `src/hooks/` and the target module's `hooks/` folder
2. **Determine scope** — will this hook be used by 2+ modules?
3. **Place appropriately:**
   - 2+ modules → `src/hooks/{category}/`
   - Single module → `src/modules/{Module}/hooks/`

### When Refactoring a Module

1. **Identify module-specific hooks** — grep for imports from `src/hooks/` used only by your module
2. **Move to module** — create `{Module}/hooks/` if needed, move the hook file
3. **Update imports** — change to relative imports within the module
4. **Remove from shared** — delete from `src/hooks/` and update barrel exports

### Migration Script Pattern

```bash
# Find all files that import a specific hook
rg "from ['\"]@src/hooks/browser" --files-with-matches

# If all matches are in one module, candidate for migration
```

---

## History

| Date       | Author | Change                                                                                                                                                                                           |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-02-01 | —      | Original V1 document                                                                                                                                                                             |
| 2026-03-12 | script | Migrated to Documentation V2 format                                                                                                                                                              |
| 2026-03-25 | —      | Moved to `src/hooks/hooks-organization.md`; related links updated                                                                                                                                |
| 2026-03-30 | —      | Added hybrid strategy (2+ module rule), migration candidates list                                                                                                                                |
| 2026-05-07 | —      | Rewrote Folder Structure and Statistics sections to match actual disk layout (~213 files, 41 categories); documented workStation/ sub-structure and useFileContent dual-implementation rationale |
