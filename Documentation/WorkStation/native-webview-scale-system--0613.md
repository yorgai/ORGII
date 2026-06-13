---
title: Native WebView Scale System
status: active
last_updated: 2026-06-13
---

# Native WebView Scale System

This document describes how ORGII scales the main React UI while keeping native inline WebViews aligned with the visible browser surface.

## Problem

ORGII renders most UI inside the main Tauri WebView, but embedded browser content is rendered as separate native child WebViews. The two surfaces do not automatically share one DOM coordinate system.

The old app-level CSS `zoom` approach made text selection, CodeMirror pointer handling, terminal mouse interactions, and drag coordinates drift at non-100% scale. A pure CSS `transform: scale()` approach fixed CodeMirror's transform detection, but it did not solve native child WebView composition cleanly. The final model uses native zoom for the main app WebView and a dedicated native-frame coordinate contract for child WebViews.

## Final model

### Main React UI scale

The app shell applies user UI scale by calling the Tauri command `set_main_webview_zoom` with `scaleFactor = uiScale / 100`.

Important invariants:

- Do not use `document.documentElement.style.zoom` for app scaling.
- Do not scale `#root` with CSS transforms for the active production path.
- Keep `--ui-scale` set to `1` so frontend pointer compensation paths do not double-apply scale.
- Set `--native-frame-scale` to the actual native zoom factor so native frame conversion can compensate DOMRect coordinates.

### Main WebView zoom target

The Rust command must set zoom on the actual main WebView:

```rust
let webview = app.get_webview("main").ok_or("Main WebView not found")?;
webview.set_zoom(scale_factor)?;
```

Do not set zoom through `get_webview_window("main")` for this scale path. That can appear to work without child WebViews, but it does not behave reliably once inline child WebViews participate in native composition.

### Inline WebView frame contract

Frontend code converts a measured DOMRect into a native frame using explicit start/end corners:

- `x`: left corner
- `y`: top corner
- `a`: right corner
- `b`: bottom corner
- `width`: derived compatibility field
- `height`: derived compatibility field

Rust accepts optional `a` and `b` for `create_inline_webview`, `update_inline_webview_position`, and `reposition_and_show_webview`. When present, Rust derives size as:

```rust
width = (a - x).max(OFFSCREEN_MIN_SIZE)
height = (b - y).max(OFFSCREEN_MIN_SIZE)
```

This avoids width/height drift caused by separate rounding of position and size.

### No child WebView auto resize

Inline child WebViews must not use `.auto_resize()`.

ORGII already owns the child WebView rectangle through React anchor measurement and manual Tauri commands. Letting Wry auto-resize the child WebView fights that manual positioning path, especially when the main WebView is natively zoomed.

## Measurement flow

The browser surface uses a dedicated invisible anchor inside `BrowserCore`:

```text
BrowserCore .browser-content
└── .browser-webview-frame-anchor
```

The anchor is the source of truth for the desired native child WebView rectangle. `useWebviewLayout` reads `anchor.getBoundingClientRect()`, converts it with `toNativeFrame`, and sends the result to Rust.

## Shared browser owner flow

The visible browser panel is not always the component that directly owns the native child WebView. ORGII uses a shared browser owner:

```text
Visible Browser panel
→ SharedBrowserHostSlot publishes rect
→ activeSharedBrowserHostAtom selects active rect
→ SharedBrowserApp positions a fixed hidden owner host
→ BrowserCore inside owner host manages BrowserSessionWebview
→ useInlineWebview creates/repositions native child WebView
```

This means layout changes must update both:

1. the visible host rect registry, and
2. the native child WebView position after the shared owner host moves.

## Layout-change event

Some layout changes move the browser anchor without changing its size. Examples:

- switching the chat panel from left to right,
- changing chat panel layout mode,
- toggling chat focus/maximize,
- sidebar state changes that affect content origin.

`ResizeObserver` does not fire when only `left/top` changes. For this case ORGII dispatches `orgii-webview-layout-changed` via `dispatchWebviewLayoutChanged()`.

Consumers:

- `AppLayout` dispatches after chat/sidebar layout inputs change.
- `SharedBrowserHostSlot` listens and republishes its DOMRect.
- `SharedBrowserApp` dispatches again after `activeRect` changes so native WebViews remeasure after the fixed owner host has moved.
- `useWebviewLayout` listens and performs forced multi-frame position updates.

The multi-frame update cadence catches CSS/flex layout settling without relying on width/height changes.

## Debugging checklist

When inline WebViews are misaligned under UI scale:

1. Confirm `set_main_webview_zoom` targets `app.get_webview("main")`.
2. Confirm child WebViews are not using `.auto_resize()`.
3. Confirm the measured anchor visually matches the intended browser rectangle.
4. Confirm `toNativeFrame` emits `x/y/a/b` and applies `--native-frame-scale`.
5. Confirm Rust receives `a/b` and derives size from corners.
6. If the browser panel moves without resizing, confirm `orgii-webview-layout-changed` reaches `SharedBrowserHostSlot` and `useWebviewLayout`.
7. If using the shared browser owner, confirm `SharedBrowserApp` has moved its fixed host before the final native position update.

## Files of interest

- `src/app/root/useAppShellEffects.ts` — applies native app zoom and CSS scale variables.
- `src/util/platform/tauri/nativeFrame.ts` — converts DOMRect to `x/y/a/b` native frame payloads.
- `src/hooks/platform/useInlineWebview/useWebviewLayout.ts` — observes and repositions inline WebViews.
- `src/hooks/platform/useInlineWebview/useWebviewCommands.ts` — creates inline WebViews with native frame payloads.
- `src/hooks/platform/useInlineWebview/webviewLayoutEvents.ts` — shared layout-change event helper.
- `src/engines/BrowserCore/index.tsx` — owns the browser frame anchor.
- `src/modules/WorkStation/Browser/shared/SharedBrowserHostSlot.tsx` — publishes visible browser host rects.
- `src/modules/WorkStation/Browser/shared/SharedBrowserApp.tsx` — positions the shared browser owner host.
- `src/modules/shared/layouts/AppLayout.tsx` — dispatches layout-change events for chat/sidebar layout shifts.
- `src-tauri/crates/app-window/src/commands.rs` — sets zoom on the main WebView.
- `src-tauri/crates/browser/src/inline.rs` — creates and repositions inline child WebViews.
