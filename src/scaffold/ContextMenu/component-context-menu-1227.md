# ContextMenu Component

**Status**: ✅ Complete  
**Location**: `src/components/ContextMenu/`  
**Last Updated**: December 27, 2025

---

Unified context menu for session input boxes, providing quick access to files, folders, terminals, design context, and browser context.

## Overview

The `ContextMenu` component provides a Cursor-like file search experience integrated into chat inputs. When users type `@` in the input box, they can quickly search and reference files from the session's linked repository.

### Key Features

- **Unified File Search**: Combined files and folders search in a single menu option
- **Keyboard Navigation**: Full keyboard support (↑↓ to navigate, Enter to select, Esc to close)
- **Native File Search**: Uses Rust backend for fast fuzzy matching (see [Native File Search](../../../Documentation/Features/feature-native-file-search.md))
- **Session-Aware**: Automatically uses the repo path linked to the current session
- **Recent Files**: Shows recently accessed files at the top (when available)
- **File Type Icons**: Displays specific icons based on file extension (TypeScript, Python, Rust, etc.)

## Architecture

### Component Structure

```
src/components/ContextMenu/
├── index.tsx       # Main component with sub-components:
│                   #   - MenuItemRow (main menu items)
│                   #   - RecentFilesSection (recent files at top)
│                   #   - SearchResultsPanel (inline search results)
│                   #   - SecondLayerPanel (panel with header + results)
├── config.ts       # Menu items, icons, style configuration, SECOND_LAYER_CONFIG
├── types.ts        # TypeScript type definitions
└── exports.ts      # Module exports

src/hooks/editor/
└── useContextMenu.ts  # State management, keyboard handling, goBack()
```

### Menu Items

| Item            | Icon                   | Description                              |
| --------------- | ---------------------- | ---------------------------------------- |
| Files & Folders | `ri-file-line`         | Search for files and folders in the repo |
| Terminal        | `ri-terminal-box-line` | Select terminal context                  |
| Design          | `ri-palette-line`      | Design context                           |
| Browser         | `ri-global-line`       | Browser context                          |

## Usage

### Basic Integration

```tsx
import { useSessionContext } from "@src/app/Workspace/CBWorkSpaceContext/contexts/SessionContext";
import ContextMenu from "@src/components/ContextMenu";
import { MenuItemId, RecentFile } from "@src/components/ContextMenu/config";

const MyInputComponent = () => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { currentWorkspacePath } = useSessionContext();

  // Ref for keyboard handler
  const keyboardHandlerRef = useRef<
    ((e: React.KeyboardEvent) => boolean) | null
  >(null);

  const handleSelect = (type: MenuItemId, value?: string) => {
    if (type === "files" && value) {
      // Insert file reference into input
      console.log("Selected file:", value);
    }
    setShowDropdown(false);
  };

  return (
    <div>
      <input
        onKeyDown={(e) => {
          if (showDropdown && keyboardHandlerRef.current) {
            const handled = keyboardHandlerRef.current(e);
            if (handled) return;
          }
        }}
        onChange={(e) => {
          // Detect @ character
          if (e.target.value.includes("@")) {
            setShowDropdown(true);
            const query = e.target.value.split("@").pop() || "";
            setSearchQuery(query);
          }
        }}
      />

      <ContextMenu
        visible={showDropdown}
        onClose={() => setShowDropdown(false)}
        onSelect={handleSelect}
        searchQuery={searchQuery}
        repoPath={currentWorkspacePath}
        keyboardHandlerRef={keyboardHandlerRef}
      />
    </div>
  );
};
```

### Props

| Prop                 | Type                                         | Required | Description                                |
| -------------------- | -------------------------------------------- | -------- | ------------------------------------------ |
| `visible`            | `boolean`                                    | Yes      | Whether the dropdown is visible            |
| `onClose`            | `() => void`                                 | Yes      | Callback when dropdown should close        |
| `onSelect`           | `(type: MenuItemId, value?: string) => void` | Yes      | Callback when an item is selected          |
| `searchQuery`        | `string`                                     | No       | Current search query for filtering         |
| `recentFiles`        | `RecentFile[]`                               | No       | Recent files to show at top                |
| `repoPath`           | `string`                                     | No       | Workspace root path for native file search |
| `className`          | `string`                                     | No       | Custom class name                          |
| `keyboardHandlerRef` | `React.MutableRefObject`                     | No       | Ref to expose keyboard handler to parent   |

## Keyboard Navigation

The dropdown supports full keyboard navigation while the user stays in the input box:

### Main Menu

| Key           | Action                           |
| ------------- | -------------------------------- |
| `↑` / `↓`     | Navigate through items           |
| `Enter` / `→` | Select item or open second layer |
| `Tab`         | Cycle through items              |
| `Escape`      | Close dropdown                   |

### Second Layer Panel

| Key       | Action                             |
| --------- | ---------------------------------- |
| `↑` / `↓` | Navigate through results           |
| `Enter`   | Select highlighted file            |
| `←`       | Go back to main menu               |
| `Tab`     | Cycle through results              |
| `Escape`  | Go back (or close if at main menu) |

## Behavior

### Typing Flow

1. **User types `@`** → Shows main menu (Files & Folders, Terminal, Design, Browser)
2. **User types `@filename`** → Automatically searches files and shows inline results
3. **User types `@ ` (@ + space)** → Exits @ mode (dropdown closes, blank searches not allowed)
4. **User presses ↑↓** → Navigates through search results
5. **User presses Enter** → Selects the highlighted file and inserts reference

### Click Flow (Second Layer Panel)

1. **User types `@`** → Shows main menu
2. **User clicks "Files & Folders" or "Terminal"** → Opens second layer panel with:
   - Header with back arrow (←) + icon + title
   - Empty state message (e.g., "Type to search files...")
3. **User types in main input box** → Filters files/folders in the panel (no search box inside dropdown)
4. **User clicks back arrow or presses `←`** → Returns to main menu
5. **User clicks a file/folder item or presses Enter** → Selects the item and closes dropdown

### Selection Behavior

- **Clicking menu items without second layer** (Design, Browser): Directly triggers `onSelect` with the item type
- **Clicking menu items with second layer** (Files & Folders, Terminal): Opens the second layer panel
- **Clicking items in second layer**: Triggers `onSelect` with the layer type and item path
- **Selection uses the correct type**: When in "terminals" layer, selection uses "terminals" type (not "files")

### Search Results

When searching, results show:

- **File type specific icons** - Uses `FileTypeIcon` component for rich visual identification
- **Folder icon** - Uses SVG folder icon from `filetreeType` assets
- **File name** prominently displayed
- **Path** shown in smaller text for disambiguation

### File Type Icons

The dropdown uses the `FileTypeIcon` component (`src/components/FileTypeIcon/index.tsx`) which supports 150+ file types including:

- **Languages**: TypeScript, JavaScript, Python, Rust, Go, Java, C/C++, etc.
- **Frameworks**: React, Vue, Svelte, Angular, Astro, etc.
- **Config files**: package.json, tsconfig.json, Dockerfile, etc.
- **Assets**: Images, videos, audio, fonts, etc.

## Integration with Session

The component uses `currentWorkspacePath` from `SessionContext` to determine where to search for files:

```tsx
// SessionContext provides the project's fs_uri
const { currentWorkspacePath } = useSessionContext();

// Pass to ContextMenu
<ContextMenu
  repoPath={currentWorkspacePath}
  // ... other props
/>;
```

The project path is set when:

1. Session page loads (`src/page/Orgii/Workspace/index.tsx`)
2. `loadProjectData()` fetches project details using `projectId` from URL params
3. `fs_uri` is normalized (removes `file://` prefix) and stored in `SessionContext`
4. Only local paths are used (remote `atlas://` paths are skipped)

## Styling

The component follows the design system:

- Uses CSS variables: `bg-bg-2`, `border-border-2`, `text-text-1`, etc.
- Consistent with `DropdownSearchResults` styling
- Rounded corners: `rounded-[8px]`
- Shadow: `shadow-md`

### Style Configuration

```typescript
// From config.ts
export const STYLE_CONFIG = {
  dropdownWidth: "280px",
  secondLayerWidth: "320px",
  maxHeight: "360px",
  itemHeight: "32px",
  recentSectionMaxItems: 3,
  searchResultsMaxItems: 20,
};
```

## Icon Configuration

All icons use Remix Icon (as per workspace rules):

```typescript
export const ICON_CONFIG = {
  recent: "ri-time-line",
  files: "ri-file-line",
  folders: "ri-folder-line",
  terminals: "ri-terminal-box-line",
  design: "ri-palette-line",
  browser: "ri-global-line",
  arrow: "ri-arrow-right-s-line",
  arrowBack: "ri-arrow-left-s-line",
  search: "ri-search-line",
  loading: "ri-loader-4-line",
  empty: "ri-file-unknow-line",
};
```

## Second Layer Configuration

Each second layer panel has its own configuration:

```typescript
export const SECOND_LAYER_CONFIG: Record<SecondLayerId, SecondLayerConfig> = {
  files: {
    title: "Files & Folders",
    icon: ICON_CONFIG.files,
    emptyText: "Type to search files...",
  },
  terminals: {
    title: "Terminal",
    icon: ICON_CONFIG.terminals,
    emptyText: "No terminals available",
  },
};
```

## Hook API

The `useContextMenu` hook provides state management and keyboard handling:

```typescript
const {
  activeIndex, // Current menu item index
  setActiveIndex, // Set active index
  secondLayer, // Current second layer ("files" | "terminals" | null)
  setSecondLayer, // Open a second layer panel
  searchQuery, // Current search query
  setSearchQuery, // Set search query
  searchResults, // Search results array
  searchLoading, // Whether search is in progress
  secondLayerActiveIndex, // Active index in second layer
  setSecondLayerActiveIndex, // Set second layer active index
  handleKeyDown, // Keyboard event handler (returns boolean if handled)
  handleSelect, // Selection handler
  goBack, // Go back to main menu from second layer
  reset, // Reset all state
} = useContextMenu({ repoPath, onSelect, onClose });
```

## Related Documentation

- [Native File Search](../../../Documentation/Features/feature-native-file-search.md) - Backend file search implementation
- [Global Spotlight](../../../Documentation/Features/feature-global-spotlight.md) - Similar search UI patterns

## Migration Notes

**Renamed from `AtMentionDropdown` (December 27, 2025)**

This component was previously named `AtMentionDropdown` but was renamed to `ContextMenu` to better reflect its purpose and align with Cursor's terminology of "context symbols" or "@ symbols."

### What Changed:

- Component name: `AtMentionDropdown` → `ContextMenu`
- Hook name: `useAtMentionDropdown` → `useContextMenu`
- Folder location: `src/components/AtMentionDropdown/` → `src/components/ContextMenu/`
- All type names updated (e.g., `AtMentionDropdownProps` → `ContextMenuProps`)
- CSS class name: `at-mention-dropdown` → `context-menu`

### Legacy Components (Removed)

The following legacy dropdown components were removed in favor of the unified `ContextMenu`:

- ~~`src/page/Orgii/Workspace/WorkspaceRight/InputArea/components/AtDropdown.tsx`~~ - Deleted
- ~~`src/page/Orgii/Workspace/WorkspaceRight/InputArea/components/AtDropdownMenu.tsx`~~ - Deleted

**Note**: `DropdownSearchResults` (`src/components/chatBox/CBChatModeBox.tsx/DropdownSearchResults.tsx`) is still used by other components (`MessageInputArea`, `FileTree`) and was not removed.

## Future Enhancements

Potential improvements:

1. **Recent Files Integration**: Connect to session change events for real recent files
2. **Terminal List**: Populate terminal options from active terminals
3. **Design Context**: Integration with design tools
4. **Browser Context**: Integration with browser dev tools
5. **Custom Filters**: Allow filtering by file type
6. **Favorites**: Pin frequently used files

---

**Last Updated**: December 27, 2025  
**Status**: ✅ Production Ready
