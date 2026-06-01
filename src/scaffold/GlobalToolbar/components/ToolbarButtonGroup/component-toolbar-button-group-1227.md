# IconGroup Component

**Status**: ✅ Complete  
**Location**: `src/components/IconGroup/`  
**Last Updated**: December 25, 2025

---

## Overview

The IconGroup component provides a globally reusable liquid glass container for icon buttons. Perfect for toolbar action groups with 2-5 icons. It uses LiquidGlassToolbar for the container and supports hover/selected states with transparent default buttons that show liquid glass overlay on hover.

### Key Features

- ✅ **Liquid Glass Design**: Thin material container with blur effect via LiquidGlassToolbar
- ✅ **Compact Layout**: Height 36px with 4px horizontal padding
- ✅ **Rounded Container**: Border radius 100px (fully rounded)
- ✅ **Icon Buttons**: 28x28 size with hover/selected states
- ✅ **Flexible**: Supports 2-5 icons per group (with warning if outside range)
- ✅ **Type-Safe**: Full TypeScript support with LucideIcon types
- ✅ **Selected State**: Uses ButtonGlass primary variant when selected
- ✅ **Hover Effects**: Liquid glass hover overlay for non-selected buttons

---

## Functions

The IconGroup component serves as:

1. **Toolbar Actions**: Toolbar action groups with icon buttons
2. **Icon Container**: Container for related icon actions
3. **UI Consistency**: Consistent icon button styling across the app
4. **Action Groups**: Group related actions together

---

## Where It's Used

### Primary Usage

- Used in GlobalSpotlight and other toolbar components for action groups

```tsx
// Used in toolbars
import { Code, Plus } from "lucide-react";

import { IconGroup } from "@src/components/IconGroup";

<IconGroup
  items={[
    {
      id: "code",
      icon: Code,
      onClick: () => console.log("Code clicked"),
      title: "Code Actions",
    },
    {
      id: "plus",
      icon: Plus,
      onClick: () => setLaunchpadOpen(true),
      title: "Open Launchpad",
    },
  ]}
/>;
```

---

## How to Use

### Basic Usage

```tsx
import { Code, Plus } from "lucide-react";

import { IconGroup } from "@src/components/IconGroup";

function MyToolbar() {
  return (
    <IconGroup
      items={[
        {
          id: "code",
          icon: Code,
          onClick: () => console.log("Code clicked"),
          title: "Code Actions",
        },
        {
          id: "plus",
          icon: Plus,
          onClick: () => console.log("Plus clicked"),
          title: "Add New",
        },
      ]}
    />
  );
}
```

### With Selected State

```tsx
import { Code, Plus, Terminal } from "lucide-react";
import { useState } from "react";

import { IconGroup } from "@src/components/IconGroup";

function ToolbarWithSelection() {
  const [selectedTool, setSelectedTool] = useState("code");

  return (
    <IconGroup
      items={[
        {
          id: "code",
          icon: Code,
          onClick: () => setSelectedTool("code"),
          title: "Code Editor",
          selected: selectedTool === "code",
        },
        {
          id: "terminal",
          icon: Terminal,
          onClick: () => setSelectedTool("terminal"),
          title: "Terminal",
          selected: selectedTool === "terminal",
        },
        {
          id: "plus",
          icon: Plus,
          onClick: () => console.log("Add new"),
          title: "Add New",
        },
      ]}
    />
  );
}
```

### Maximum Icons (5)

```tsx
import { Code, Globe, Plus, Settings, Terminal } from "lucide-react";

import { IconGroup } from "@src/components/IconGroup";

function FullToolbar() {
  return (
    <IconGroup
      items={[
        { id: "code", icon: Code, onClick: () => {}, title: "Code" },
        {
          id: "terminal",
          icon: Terminal,
          onClick: () => {},
          title: "Terminal",
        },
        { id: "browser", icon: Globe, onClick: () => {}, title: "Browser" },
        {
          id: "settings",
          icon: Settings,
          onClick: () => {},
          title: "Settings",
        },
        { id: "plus", icon: Plus, onClick: () => {}, title: "Add" },
      ]}
    />
  );
}
```

### With Custom ClassName

```tsx
<IconGroup items={items} className="custom-toolbar-class" />
```

---

## API Reference

### IconGroup Props

| Prop        | Type              | Required | Default | Description             |
| ----------- | ----------------- | -------- | ------- | ----------------------- |
| `items`     | `IconGroupItem[]` | Yes      | -       | Array of 2-5 icon items |
| `className` | `string`          | No       | `""`    | Additional CSS classes  |

### IconGroupItem Interface

| Property   | Type         | Required | Description                     |
| ---------- | ------------ | -------- | ------------------------------- |
| `id`       | `string`     | Yes      | Unique identifier               |
| `icon`     | `LucideIcon` | Yes      | Lucide React icon component     |
| `onClick`  | `() => void` | Yes      | Click handler                   |
| `title`    | `string`     | No       | Tooltip text                    |
| `selected` | `boolean`    | No       | Whether icon is selected/active |

---

## Implementation Details

### Container

- **Component**: Uses `LiquidGlassToolbar` component
- **Height**: 36px
- **Padding**: `0 4px` (horizontal only)
- **Border Radius**: 100px (fully rounded)
- **Gap**: 4px between icons
- **Material**: Thin liquid glass (`intensity="default"`)

### Icon Buttons

**Default State (Not Selected):**

- **Size**: 28x28px
- **Border Radius**: 100px (fully rounded)
- **Background**: Transparent
- **Color**: `var(--color-text-1)`
- **Hover**: Liquid glass overlay (LIQUID_GLASS_HOVER)
- **Icon Size**: 14px with strokeWidth 1.75

**Selected State:**

- Uses `ButtonGlass` component with:
  - `variant="primary"`
  - `shape="round"`
  - `size="small"`
- Same dimensions (28x28px)

### Hover Behavior

- **Hover Overlay**: Shows liquid glass hover effect when hovered and not pressed
- **Theme-Aware**: Uses `LIQUID_GLASS_HOVER.dark` or `LIQUID_GLASS_HOVER.light` based on theme
- **State Management**: Uses local state (`isHovered`, `isPressed`) for hover tracking
- **Auto-Clear**: Hover state cleared when `selected` changes (e.g., when launcher closes)

### Validation

- Validates items count: expects 2-5 icons
- Logs warning if outside range: `console.warn` if items.length < 2 or > 5

### Icons

- **Library**: Uses Lucide React icons exclusively
- **Size**: 14px
- **Stroke Width**: 1.75
- **Position**: Centered in button

### Dependencies

- `lucide-react` - LucideIcon type and icon components
- `@src/components/ButtonGlass` - Selected state button
- `@src/components/LiquidGlass/hoverConfig` - LIQUID_GLASS_HOVER constants
- `@src/components/LiquidGlassToolbar` - Container component
- `@src/util/share/themeUtils` - useCurrentTheme hook

---

## Related Files

- `src/components/IconGroup/index.tsx` - Main component implementation
- `src/components/ButtonGlass/` - Button component for selected state
- `src/components/LiquidGlassToolbar/` - Container component
- `src/components/LiquidGlass/` - Material system

---

## Best Practices

1. **Icon Count**: Keep between 2-5 icons for optimal UX
2. **Tooltips**: Always provide `title` for accessibility
3. **Actions**: Use meaningful icon choices (refer to icon-reference.md)
4. **Selected State**: Use sparingly to indicate active tool/mode
5. **Placement**: Works best in toolbars and headers

---

**Last Updated**: December 25, 2025  
**Status**: ✅ Production Ready
