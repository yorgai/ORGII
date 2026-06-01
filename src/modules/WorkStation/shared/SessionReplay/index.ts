// SimulatorReplaySessionContext removed - use effectiveSimulatorEventsAtom directly
export {
  SessionReplayPanelPlaceholder,
  type SessionReplayPanelPlaceholderProps,
  type SessionReplayPanelPlaceholderVariant,
} from "./SessionReplayPanelPlaceholder";

export {
  gateByActiveKind,
  type ActiveSelectionKind,
  type SelectionByKind,
} from "./activeSelection";

export {
  ReplayTabBar,
  type ReplayTab,
  type ReplayTabBarProps,
  type KnownReplayTabKind,
} from "./ReplayTabBar";

export {
  SimulatorReplayChrome,
  type SimulatorReplayChromeProps,
} from "./SimulatorReplayChrome";
export { SimulatorWorkstationTabHeader } from "./SimulatorWorkstationTabHeader";

export {
  MAX_REPLAY_TABS,
  capNewestWithActive,
  mergeNewestFirstByTimestamp,
  type TimestampedReplayTab,
} from "./replayTabHelpers";
