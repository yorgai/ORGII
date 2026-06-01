# PanelAPICall Component

**Status**: ✅ Complete  
**Location**: `src/features/DevTools/PanelAPICall/`  
**Last Updated**: December 27, 2025

---

## Overview

The PanelAPICall component provides a comprehensive debug panel for tracking and monitoring both API calls and Jotai atom operations made throughout the application. It displays a unified view of API call history and atom read/write operations with detailed information like method, URL, status, duration, trigger information, and component context.

### Key Features

- ✅ **API Call Tracking**: Monitors all API calls made in the application
- ✅ **Atom Operation Tracking**: Tracks Jotai atom reads and writes
- ✅ **Unified View**: Combined view of API calls and atom operations in chronological order
- ✅ **Tabbed Interface**: Separate tabs for "All", "API", and "Atoms"
- ✅ **Debug Panel**: Floating resizable panel for development/debugging
- ✅ **Call Details**: Shows method, URL, status code, duration, timestamp
- ✅ **Atom Details**: Shows operation type (read/write), atom name, value preview, previous value
- ✅ **Trigger Information**: Displays what triggered the operation (click, hover, keyboard, focus, auto)
- ✅ **Component Context**: Shows file path, component name, function name, and line number
- ✅ **Clear History**: Clear all tracked operations (with tab-specific clearing)
- ✅ **Performance Metrics**: Shows request duration for API calls
- ✅ **Keyboard Shortcut**: Toggle panel with ⌘4 (Command+4)

---

## Functions

The PanelAPICall component serves as:

1. **Development Tool**: Debug panel for tracking API calls and atom operations during development
2. **Performance Monitoring**: Monitor API call performance and atom operation frequency
3. **Debugging Aid**: Identify which actions trigger which API calls and atom operations
4. **Operation History**: Maintain a history of all API calls and atom operations for analysis
5. **State Management Debugging**: Track Jotai atom state changes and their sources

---

## Where It's Used

### Primary Usage

- `src/App.tsx` - Wrapped with `PanelAPICallProvider` at the root level

```tsx
// Used in App.tsx
<PanelAPICallProvider />
```

### Integration Points

The component integrates with:

- `src/util/apiTracker.ts` - API tracking utilities (`getApiCalls`, `clearApiCalls`, `enableApiTracking`)
- `src/util/atomTracker.ts` - Atom tracking utilities (`getAtomOperations`, `clearAtomOperations`, `enableAtomTracking`)
- `src/hooks/useGlobalShortcuts.ts` - Keyboard shortcut handler (⌘4)

---

## How to Use

### Basic Setup

The component is already set up at the app root level. No additional setup is required.

```tsx
// Already configured in App.tsx
import { PanelAPICallProvider } from "@src/features/DevTools/PanelAPICall";

function App() {
  return (
    <>
      <PanelAPICallProvider />
      {/* Your app */}
    </>
  );
}
```

### Enabling Tracking

API and atom tracking are automatically enabled when the panel is initialized:

```tsx
// Tracking is enabled automatically in PanelAPICallProvider
useEffect(() => {
  enableApiTracking();
  enableAtomTracking();
}, []);
```

### Opening the Panel

- **Keyboard Shortcut**: Press ⌘4 (Command+4) to toggle the panel
- The panel can also be toggled programmatically via the `toggle-panel-api-call` event

---

## API Reference

### Provider Component

The `PanelAPICallProvider` wraps the application and provides the API and atom tracking context.

**Features:**

- Automatically enables API and atom tracking on mount
- Listens for keyboard shortcut (⌘4) to toggle panel visibility
- Updates operation lists when panel is visible
- Polls for updates every 500ms while panel is visible

### Panel Component

The `PanelAPICall` component displays the debug panel.

**Props:**

```typescript
interface ApiCallsPanelProps {
  visible: boolean; // Whether panel is visible
  apiCalls: ApiCall[]; // Array of tracked API calls
  atomOperations: AtomOperation[]; // Array of tracked atom operations
  onClose: () => void; // Callback to close panel
  onClear: () => void; // Callback to clear operations
}
```

### Panel Features

- **Resizable**: Drag the resize handle to adjust panel height (180px - 600px)
- **Tabbed Interface**:
  - **All**: Combined view of API calls and atom operations, sorted by timestamp
  - **API**: API calls only
  - **Atoms**: Atom operations only
- **Operation Counts**: Each tab shows the count of operations
- **Expandable Rows**: Click any row to see detailed information
- **Clear Button**: Clear operations (respects active tab - clears all for "All" tab, only API for "API" tab, only atoms for "Atoms" tab)
- **Close Button**: Close the panel (or press ⌘4 again)

### API Call Details

When expanded, API calls show:

- Full URL
- File path and line number
- Component name
- Function name (if different from component)
- Query parameters
- Request body
- Response data
- Error information (if any)
- Component label (DOM element)

### Atom Operation Details

When expanded, atom operations show:

- Atom name
- Atom key (if available)
- File path and line number
- Component name
- Function name (if different from component)
- Previous value (for write operations)
- Current/new value
- Component label (DOM element)
- Stack trace (if available)

---

## Related Files

### Component Files

- `src/components/ApiCallsPanel/index.tsx` - Main component orchestrator
- `src/components/ApiCallsPanel/config.ts` - Icon configuration (Lucide icons)
- `src/components/ApiCallsPanel/types.ts` - TypeScript type definitions
- `src/components/ApiCallsPanel/utils.ts` - Utility functions
- `src/components/ApiCallsPanel/hooks/useApiCallsPanel.ts` - Panel business logic hook
- `src/components/ApiCallsPanel/hooks/useApiCallsPanelProvider.ts` - Provider hook
- `src/components/ApiCallsPanel/components/` - Sub-components directory
- `src/components/ApiCallsPanel/index.scss` - Styles

### External Dependencies

- `src/util/apiTracker.ts` - API tracking utilities
- `src/util/atomTracker.ts` - Atom tracking utilities
- `src/hooks/useGlobalShortcuts.ts` - Keyboard shortcut handler

---

## Component Structure

The component has been refactored into a modular structure for better maintainability:

```
ApiCallsPanel/
├── index.tsx                    # Main component orchestrator (~100 lines)
├── config.ts                    # Icon configuration (Lucide icons)
├── types.ts                     # TypeScript type definitions
├── utils.ts                     # Helper/formatting functions
├── hooks/
│   ├── useApiCallsPanel.ts      # Panel business logic hook
│   └── useApiCallsPanelProvider.ts  # Provider hook logic
├── components/
│   ├── PanelHeader.tsx          # Header with tabs and actions
│   ├── PanelContent.tsx         # Content area router
│   ├── EmptyState.tsx           # Empty state component
│   ├── ApiCallRow.tsx           # API call row component
│   ├── AtomOperationRow.tsx     # Atom operation row component
│   ├── ApiCallDetails.tsx        # API call details expansion
│   └── AtomOperationDetails.tsx # Atom operation details expansion
├── index.scss                   # Styles
└── component-panel-api-call-1225.md  # This documentation
```

### File Organization

**Core Files:**

- `index.tsx` - Main component that orchestrates all sub-components (~100 lines)
- `config.ts` - Centralized icon configuration
- `types.ts` - TypeScript type definitions
- `utils.ts` - Pure utility functions (formatting, parsing, etc.)

**Hooks:**

- `hooks/useApiCallsPanel.ts` - Panel-level business logic (resize, tabs, expansion)
- `hooks/useApiCallsPanelProvider.ts` - Provider-level logic (tracking, events, polling)

**Components:**

- `components/PanelHeader.tsx` - Header with tabs, title, and action buttons
- `components/PanelContent.tsx` - Content router that renders appropriate view based on active tab
- `components/EmptyState.tsx` - Empty state display for each tab type
- `components/ApiCallRow.tsx` - Single API call row with expandable details
- `components/AtomOperationRow.tsx` - Single atom operation row with expandable details
- `components/ApiCallDetails.tsx` - Expanded details view for API calls
- `components/AtomOperationDetails.tsx` - Expanded details view for atom operations

---

## Icons

The component uses **Lucide React** icons for all visual elements. Icons are centralized in `config.ts`:

### Icon Configuration

- **Action Icons**: `close` (X), `delete` (Trash2), `clear` (Trash2)
- **Panel Icons**: `search` (Search), `api` (Network), `atoms` (Atom)
- **Trigger Icons**:
  - `triggerClick` (MousePointerClick)
  - `triggerHover` (Eye)
  - `triggerKeyboard` (Keyboard)
  - `triggerFocus` (Target)
  - `triggerAuto` (Zap)
- **Detail Section Icons**: `filePath` (FileText), `component` (Component), `function` (Sparkles)
- **Empty State Icons**: `all` (Search), `api` (ServerOff), `atoms` (Atom)

All icons follow the Lucide React pattern with consistent sizing (`size={14}` or `size={16}`) and stroke width (`strokeWidth={1.75}`).

---

## Implementation Details

### Operation Types

**API Calls:**

- Tracked via `apiTracker.ts`
- Includes HTTP method, URL, status, duration, request/response data
- Shows trigger type (click, hover, keyboard, focus, auto)

**Atom Operations:**

- Tracked via `atomTracker.ts`
- Includes operation type (read/write), atom name, value, previous value
- Shows trigger type and component context

### Combined View

The "All" tab combines both API calls and atom operations, sorted by timestamp (newest first). Each operation is marked with a badge indicating its type (API or ATOM).

### Auto-scroll

The panel automatically scrolls to the top when new operations are added.

### Update Mechanism

- Event-driven updates: Listens for `api-call-updated` and `atom-operation-updated` events
- Polling: While visible, polls every 500ms for new operations
- Manual refresh: Updates when panel becomes visible

---

---

## Migration Notes

### Component Refactoring (December 25, 2025)

**Breaking Down Large File:**

- ✅ Refactored from single 1121-line file to modular structure
- ✅ Separated concerns into focused modules:
  - Utility functions → `utils.ts`
  - Type definitions → `types.ts`
  - Business logic → `hooks/` directory
  - UI components → `components/` directory
- ✅ Main component now ~100 lines (down from 1121)
- ✅ Each sub-component under 300 lines
- ✅ Better maintainability and testability

**Benefits:**

- Easier to understand and navigate
- Better code reusability
- Improved testability (isolated units)
- Follows project guidelines for file size limits
- Clear separation of concerns

### Icon Migration (December 25, 2025)

- ✅ Uses Lucide React icons (`X`, `Trash2`)
- ✅ Replaced emoji icons with Lucide icon components:
  - 🔍 → `Search` icon
  - 📡 → `Network` icon
  - ⚛️ → `Atom` icon
  - 👆 → `MousePointerClick` icon
  - 👁 → `Eye` icon
  - ⌨️ → `Keyboard` icon
  - 🎯 → `Target` icon
  - ⚡ → `Zap` icon
  - 📁 → `FileText` icon
  - 🧩 → `Component` icon
  - 📭 → `ServerOff` icon
- ✅ Created centralized icon configuration in `config.ts`
- ✅ All icons now use consistent sizing and stroke width

---

**Last Updated**: December 25, 2025  
**Status**: ✅ Production Ready
