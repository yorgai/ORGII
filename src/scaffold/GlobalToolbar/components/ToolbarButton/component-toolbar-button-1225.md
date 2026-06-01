# ToolbarButton Component

**Status**: ✅ Complete  
**Location**: `src/components/ToolbarButton/`  
**Last Updated**: December 25, 2025

---

## Overview

ToolbarButton is a lightweight button component specifically designed for use inside LiquidGlassToolbar (WebGL-based). It follows the original liquid-glass-studio architecture where child controls are simple foreground elements. The component does NOT apply backdrop-filter or CSS rims, assuming the parent toolbar provides the glass effect.

### Key Features

- ✅ **No Backdrop-Filter**: Assumes parent toolbar provides the glass effect
- ✅ **No CSS Rim**: Rims are provided by parent's WebGL shader (fresnel + glare)
- ✅ **Region-Tinted Fill**: Uses toolbar material resolver for consistent color
- ✅ **Simple API**: No need to specify region, material, or other glass props
- ✅ **Lucide Icons**: Supports Lucide React icons
- ✅ **Remix Icons**: Supports Remix Icon classes
- ✅ **Hover States**: Hover and press states
- ✅ **Selected State**: Selected/active state with primary color

---

## Functions

The ToolbarButton component serves as:

1. **Toolbar Buttons**: Buttons for use inside glass toolbars
2. **Action Buttons**: Action buttons with consistent styling
3. **Icon Buttons**: Icon-only buttons
4. **Label Buttons**: Buttons with text labels

---

## Where It's Used

### Primary Usage

- `src/components/GlobalToolbar/index.tsx` - Used in global toolbar
- `src/components/IconGroup/index.tsx` - Used in icon groups

```tsx
// Used in toolbars
import { RefreshCw } from "lucide-react";

import ToolbarButton from "@src/components/ToolbarButton";

<ToolbarButton
  icon={RefreshCw}
  onClick={onRefresh}
  title="Refresh"
  size="medium"
  shape="round"
/>;
```

---

## How to Use

### Basic Usage

```tsx
import { RefreshCw } from "lucide-react";

import ToolbarButton from "@src/components/ToolbarButton";

<ToolbarButton icon={RefreshCw} onClick={onRefresh} title="Refresh" />;
```

### Round Button

```tsx
<ToolbarButton
  icon={Inbox}
  onClick={onLayoutGrid}
  title="Inbox"
  size="medium"
  shape="round"
/>
```

### Pill Button with Label

```tsx
<ToolbarButton
  icon={Settings}
  label="Settings"
  onClick={onSettings}
  shape="pill"
/>
```

### Selected State

```tsx
<ToolbarButton
  icon={Star}
  onClick={onStar}
  selected={isStarred}
  title={isStarred ? "Unstar" : "Star"}
/>
```

### With Remix Icon

```tsx
<ToolbarButton icon="ri-refresh-line" onClick={onRefresh} title="Refresh" />
```

---

## API Reference

### Props

| Prop        | Type                   | Default   | Description                            |
| ----------- | ---------------------- | --------- | -------------------------------------- |
| `onClick`   | `() => void`           | -         | Click handler                          |
| `icon`      | `LucideIcon \| string` | -         | Icon (Lucide component or Remix class) |
| `label`     | `string`               | -         | Text label                             |
| `children`  | `ReactNode`            | -         | Custom content                         |
| `title`     | `string`               | -         | Tooltip text                           |
| `disabled`  | `boolean`              | `false`   | Disable button                         |
| `selected`  | `boolean`              | `false`   | Selected/active state (primary color)  |
| `size`      | `"small" \| "medium"`  | `"small"` | Button size                            |
| `shape`     | `"round" \| "pill"`    | `"round"` | Button shape                           |
| `style`     | `CSSProperties`        | -         | Additional styles                      |
| `className` | `string`               | `""`      | Additional className                   |

### Size Reference

| Size     | Height | Width (round) | Icon Size |
| -------- | ------ | ------------- | --------- |
| `small`  | 28px   | 28px          | 14px      |
| `medium` | 36px   | 36px          | 14px      |

---

## Implementation Details

### Architecture

Follows liquid-glass-studio architecture:

1. **Parent LiquidGlassToolbar** provides:
   - Single WebGL glass layer with refraction/dispersion
   - Natural edge lighting (fresnel reflection + glare in shader)
   - Background blur

2. **Child ToolbarButtons** provide:
   - Simple translucent fills with region-derived tint
   - No backdrop-filter (parent handles this)
   - No CSS rims (WebGL shader handles edge lighting)

### Visual Layers

ToolbarButton renders these layers (bottom to top):

1. **Fill layer** - Region-tinted translucent background
2. **Specular layer** - Subtle top highlight gradient
3. **Rim layer** - Region-tinted border using rimOffsets
4. **Hover overlay** - Standard LIQUID_GLASS_HOVER on hover
5. **Content layer** - Icon and/or label

### Material Resolver Integration

ToolbarButton automatically uses `useGlassMaterial("toolbar")` to get:

```typescript
{
  tintRGB: { r, g, b },     // For fill and rim colors
  rimOffsets: {
    base: 70,               // Main rim brightness offset
    highlight: 100,         // Top edge highlight offset
    glow: 60                // Outer glow offset
  }
}
```

The fill color formula:

```typescript
// Dark mode
`rgba(${tintRGB.r + 80}, ${tintRGB.g + 80}, ${tintRGB.b + 80}, 0.12)`
// Light mode
`rgba(${tintRGB.r + 120}, ${tintRGB.g + 120}, ${tintRGB.b + 120}, 0.28)`;
```

### Icon Support

- **Lucide Icons**: Supports Lucide React icon components
- **Remix Icons**: Supports Remix Icon class strings
- **Icon Size**: Automatically sized based on button size

### Selected State

- Uses primary color when selected
- Applies primary color tint to fill
- Visual feedback for active state

---

## Related Files

- `src/components/ToolbarButton/index.tsx` - Main component
- `src/components/LiquidGlass/hoverConfig.ts` - Hover configuration
- `src/hooks/useGlassMaterial.ts` - Material resolver hook

---

## When to Use

| Use Case                     | Component                  |
| ---------------------------- | -------------------------- |
| Buttons inside GlobalToolbar | ✅ ToolbarButton           |
| Buttons inside IconGroup     | ✅ ToolbarButton           |
| Standalone glass buttons     | ❌ Use ButtonGlass         |
| Buttons in modals/dropdowns  | ❌ Use ButtonGlass         |
| Large action cards           | ❌ Use LiquidGlassButtonXL |

---

**Last Updated**: December 25, 2025  
**Status**: ✅ Production Ready
