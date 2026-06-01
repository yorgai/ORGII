# ComponentIssueModal Component

**Status**: ✅ Complete  
**Location**: `src/components/ComponentIssueModal/`  
**Last Updated**: December 25, 2025

---

## Overview

The ComponentIssueModal component provides a modal interface for reporting component issues. It displays component information, allows users to report problems, and includes preview functionality for component rendering. Features include searchable sections, keyboard navigation, color extraction, and component suggestion matching.

### Key Features

- ✅ **Component Information**: Displays component details, props, and metadata
- ✅ **Issue Reporting**: Form for reporting component issues
- ✅ **Preview**: HTML preview of component rendering
- ✅ **Component Tracking**: Integrates with component issue tracker
- ✅ **Confidence Labels**: Shows confidence levels for component mapping
- ✅ **Style Inspection**: Displays computed styles and inline styles
- ✅ **Color Extraction**: Extracts and displays color values with CSS variables
- ✅ **Search Functionality**: Searchable sections with keyboard navigation
- ✅ **Tabbed Interface**: Details and Components tabs using Arco Tabs
- ✅ **Keyboard Navigation**: Arrow keys for DOM navigation, Tab for search navigation

---

## Functions

The ComponentIssueModal component serves as:

1. **Issue Reporting**: Report problems with component rendering or behavior
2. **Component Debugging**: Inspect component details and props
3. **Quality Assurance**: Help identify and fix component issues
4. **Component Tracking**: Track component usage and issues
5. **Style Analysis**: Analyze computed styles and color values

---

## Where It's Used

### Primary Usage

- `src/page/Orgii/index.tsx` - Wrapped with `ComponentIssueModalProvider`

```tsx
// Used via provider
import { ComponentIssueModalProvider } from "@src/components/ComponentIssueModal";

<ComponentIssueModalProvider>{/* App content */}</ComponentIssueModalProvider>;
```

### Integration Points

The component integrates with:

- `componentIssueModalOpenAtom` - Modal visibility atom
- `componentIssueTracker` utilities - Component tracking utilities
- `componentMappingUtils` - Component mapping utilities

---

## How to Use

### Provider Setup

```tsx
import { ComponentIssueModalProvider } from "@src/components/ComponentIssueModal";

function App() {
  return (
    <ComponentIssueModalProvider>{/* Your app */}</ComponentIssueModalProvider>
  );
}
```

### Opening Modal Programmatically

```tsx
import { useSetAtom } from "jotai";

import { componentIssueModalOpenAtom } from "@src/store/workspaceAtom";

function MyComponent() {
  const setModalOpen = useSetAtom(componentIssueModalOpenAtom);

  const handleReportIssue = () => {
    setModalOpen(true);
  };

  return <button onClick={handleReportIssue}>Report Issue</button>;
}
```

### Triggering Modal via Keyboard

The modal can be triggered by hovering over an element and pressing `⌘9` (or the configured shortcut).

---

## API Reference

### ComponentIssueModalProvider

Provider component that wraps the application and manages modal state.

**Props**: None (uses internal state and atoms)

### ComponentIssueModal

Main modal component (typically used internally by provider).

| Prop          | Type                            | Required | Description               |
| ------------- | ------------------------------- | -------- | ------------------------- |
| `visible`     | `boolean`                       | Yes      | Modal visibility          |
| `payload`     | `ComponentIssuePayload \| null` | Yes      | Component issue payload   |
| `previewHtml` | `string`                        | No       | HTML preview of component |
| `onClose`     | `() => void`                    | Yes      | Close handler             |
| `onNavigate`  | `(element: Element) => void`    | No       | DOM navigation handler    |

### ComponentIssuePayload

```typescript
interface ComponentIssuePayload {
  componentLabel: string;
  cssSelector: string;
  domPath: string[];
  boundingRect: DOMRect;
  textSample?: string;
  attributes: Record<string, string>;
  styleSnapshot: Record<string, string>;
  hierarchy: Array<{
    tag: string;
    id?: string;
    classList: string[];
    dataComponent?: string;
  }>;
  url: string;
  timestamp: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  htmlSnippet: string;
  componentSuggestions?: Array<{
    name: string;
    filePath: string;
    matchReason: string;
    confidence: number;
  }>;
}
```

---

## Implementation Details

### Component Information Display

- Component name and type
- Props and their values
- Computed styles
- Inline styles
- Confidence labels for component mapping
- CSS selector and DOM path
- Bounding box information
- Text sample (first 200 chars)
- HTML snippet

### Issue Reporting

- Form fields for issue description
- Component context information
- Preview of component rendering
- Copy functionality for component details

### Style Inspection

- Parses inline styles
- Displays computed styles
- Color property highlighting
- Style value formatting
- Color extraction with CSS variable detection
- Hex color normalization (3, 4, 6, 8 digit formats)
- RGB/RGBA to hex conversion

### Search Functionality

- Searchable sections with real-time filtering
- Keyboard navigation (Tab/Shift+Tab for next/prev match)
- Match counter display
- Highlighted search results
- Section-based search (searches in descriptions and values)

### Keyboard Navigation

- **Escape**: Close modal
- **Tab**: Navigate to next search match
- **Shift+Tab**: Navigate to previous search match
- **ArrowUp**: Navigate to previous DOM element
- **ArrowDown**: Navigate to next DOM element

### Color Extraction

- Extracts colors from CSS properties (color, background, border, etc.)
- Normalizes hex values (handles 3, 4, 6, 8 digit formats)
- Converts RGB/RGBA to hex
- Detects CSS variable references
- Displays color swatches with hex values

---

## Related Files

- `src/components/ComponentIssueModal/index.tsx` - Main component
- `src/components/ComponentIssueModal/index.scss` - Styles
- `src/util/componentIssueTracker.ts` - Component tracking utilities
- `src/util/componentMappingUtils.ts` - Component mapping utilities
- `src/store/workspaceAtom.ts` - Component issue modal atom

---

## Migration Notes

### Arco Dependencies

This component uses the following Arco components:

- **Tabs** (`@arcocustom components`) - Tabbed interface for Details/Components
- **IconClose** (`@arcocustom components/icon`) - Close button icon
- **IconCopy** (`@arcocustom components/icon`) - Copy button icon

**Migration Status**: ⚠️ Uses Arco Tabs component (custom Tabs component exists but not adopted)

**Migration Priority**: 🟡 Medium (Tabs migration planned in Phase 3)

---

**Last Updated**: December 25, 2025  
**Status**: ✅ Production Ready
