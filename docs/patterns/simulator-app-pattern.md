# Simulator App Pattern

How to add a new app panel to the Simulator dock in ORGII.

## Key components to reuse

| Need                                             | Component / Hook                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read-only code viewer with syntax highlighting   | `SessionReplayCodeMirrorViewer` (`src/modules/WorkStation/CodeEditor/SessionReplay/CodePanel/SessionReplayCodeMirrorViewer.tsx`)                             |
| Outer chrome (tab bar above content)             | `SimulatorReplayChrome`                                                                                                                                      |
| Shell with resizable sidebar                     | `WorkStationShell` + `buildPrimarySidebarConfig`                                                                                                             |
| Publish content into the 40px header strip       | `usePublishWorkstationTabHeader({ host: "simulator", content })`                                                                                             |
| Sidebar collapse/width/position atoms            | `simulatorPrimarySidebarCollapsedAtom`, `simulatorPrimarySidebarWidthAtom`, `simulatorPrimarySidebarWidthPersistAtom`, `simulatorPrimarySidebarPositionAtom` |
| Sidebar min/max/default widths                   | `SIMULATOR_PRIMARY_SIDEBAR` from `@src/config/simulatorPrimarySidebar`                                                                                       |
| Wrap interactive header elements (Electron drag) | `NoDragRegion`                                                                                                                                               |
| Session events filtered to this app's tools      | `useSimulatorAppState(APP_CONFIG)`                                                                                                                           |

## Canonical example

`src/modules/WorkStation/Browser/SessionReplay/index.tsx` — the Browser app. Follow this pattern exactly.

## File structure for a new app

```
src/engines/Simulator/apps/<appName>/
  <AppName>App.tsx      ← main component
  <appName>Config.ts    ← defineSimulatorAppConfig(...)
```

Register in `src/modules/WorkStation/shared/simulatorRegistry/registry.ts`.

## Checklist

### Rust side

1. Add variant to `SimulatorApp` enum in `src-tauri/crates/types/src/ui_metadata.rs`
2. Add alias in `src-tauri/crates/agent-core/src/core/tools/builtin_tools/table/aliases.rs`
3. Set `simulator_app: AppYourName` on the tool entry in the relevant `table/*.rs` file

### TypeScript side

4. Add `YOUR_APP = "YOUR_APP"` to `AppType` enum in `src/engines/Simulator/types/appTypes.ts`
5. Add dock entry to `DOCK_APP_SEGMENTS` in `src/engines/Simulator/components/Dock/config.ts`
6. Create `<AppName>App.tsx` following the `WorkStationShell` + `SimulatorReplayChrome` pattern
7. Create `<appName>Config.ts` with `defineSimulatorAppConfig`
8. Register in `simulatorRegistry/registry.ts`

## Source view

Always use `SessionReplayCodeMirrorViewer` for displaying code/source content — not `<pre>`, not `SimCodeBlock`. It provides full CodeMirror with syntax highlighting, line numbers, and the correct editor theme.

```tsx
<SessionReplayCodeMirrorViewer
  content={sourceString}
  language="html" // or "plaintext", "json", etc.
  filePath="canvas.html" // triggers language detection by extension
/>
```

## Header tab switcher pattern

Publish interactive controls into the 40px `SimulatorWorkstationTabHeader` strip via `usePublishWorkstationTabHeader`. Wrap all interactive elements in `NoDragRegion`:

```tsx
const headerContent = useMemo(
  () => (
    <NoDragRegion className="flex min-w-0 flex-1 items-center gap-2 px-2">
      {/* breadcrumb / title */}
      <div className="ml-auto flex items-center gap-1 rounded-md bg-fill-1 p-0.5">
        <button
          onClick={() => setTab("canvas")}
          className={
            tab === "canvas"
              ? "rounded bg-fill-3 px-2 py-0.5 text-xs font-medium text-text-1 shadow-sm"
              : "rounded px-2 py-0.5 text-xs text-text-3 hover:text-text-2"
          }
        >
          Canvas
        </button>
        <button
          onClick={() => setTab("source")}
          className={
            tab === "source"
              ? "rounded bg-fill-3 px-2 py-0.5 text-xs font-medium text-text-1 shadow-sm"
              : "rounded px-2 py-0.5 text-xs text-text-3 hover:text-text-2"
          }
        >
          Source
        </button>
      </div>
    </NoDragRegion>
  ),
  [tab]
);

usePublishWorkstationTabHeader({
  host: "simulator",
  content: headerContent,
  enabled: hasContent,
});
```
