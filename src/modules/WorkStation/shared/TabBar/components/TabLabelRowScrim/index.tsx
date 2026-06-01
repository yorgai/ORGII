export interface TabLabelRowScrimProps {
  /** When true, scrim is rendered (e.g. tab hovered and close is available). */
  visible: boolean;
}

/**
 * Right-edge gradient over the label row so title/badge text does not show through
 * the absolute close control when the tab is hovered. Matches `SortableTab` / session tabs.
 */
export function TabLabelRowScrim({ visible }: TabLabelRowScrimProps) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-20 bg-gradient-to-l from-fill-2 to-transparent"
      aria-hidden
    />
  );
}
