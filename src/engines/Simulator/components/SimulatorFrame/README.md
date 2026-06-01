# Simulator Frame System

Similar to the Chat Panel's block/variant architecture, the simulator frame system provides a consistent structure for all simulator views.

## Architecture

```
SimulatorFrame/
├── config.ts          # Shared Tailwind classes and constants
├── index.tsx          # Base frame component (static content)
└── variants/          # (Future) Frame variants
    ├── StaticFrame    # Alias/wrapper for base (Kanban, Changes)
    └── InteractiveFrame # Could be refactored from ActivityComputer
```

## Components

### Base Component: `SimulatorFrame`

Simple visual wrapper for static content:

- Rounded border with shadow (macOS simulator look)
- Traffic lights header via `BrowserNavigateHeader`
- Content area with proper overflow handling

**Used by:**

- Kanban tab
- Changes tab
- Any future static simulator views

### Complex Component: `ActivityComputer`

Event-driven frame with advanced features:

- Mock event rendering
- Dock integration
- Split view support
- Trajectory visualization

**Used by:**

- Follow tab (activity simulator)
- Trajectory tab (trajectory view)

## Usage

### Static Content (Kanban, Changes)

```tsx
<div className="h-full w-full overflow-hidden p-2">
  <SimulatorFrame title="Task Board" toolType="Other">
    <YourContent />
  </SimulatorFrame>
</div>
```

### Dynamic Content (Follow, Trajectory)

```tsx
<ActivityComputer
  showDock={true}
  mockEvent={currentEvent}
  mockEvents={allEvents}
  showTrajectory={false}
/>
```

## Configuration

All shared classes and constants are centralized in `config.ts`:

- `getSimulatorFrameContainerClasses()` - Frame container styling
- `getSimulatorFrameContentClasses()` - Content area styling
- `SIMULATOR_FRAME_HEADER_RADIUS` - Header border radius
- `SIMULATOR_FRAME_TAB_PADDING` - Standard padding for tab wrappers

## Design Principles

1. **Separation of Concerns**: UI (SimulatorFrame) vs Logic (ActivityComputer)
2. **Consistency**: All frames share the same visual style via config
3. **Reusability**: Base frame can be used directly or as a building block
4. **Extensibility**: Easy to add new variants following the pattern

## Future Improvements

1. Consider refactoring `ActivityComputer` to compose `SimulatorFrame` as a base
2. Add more variants as needed (e.g., `GridFrame`, `SplitFrame`)
3. Share more styling constants between frames
