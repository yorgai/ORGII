import React from "react";

interface AgentStationChromeFrameProps {
  enabled: boolean;
  illuminated: boolean;
  /**
   * Whether the outer layout is full/compact (chat docked as a flex sibling).
   * In `inset` mode the WorkStation page already sits inside a padded card,
   * so the agent-station chrome must NOT add its own `p-2` — that double
   * padding produces a visible inner gutter around the simulator.
   */
  isFullMode: boolean;
  children: React.ReactNode;
}

const AgentStationChromeFrame: React.FC<AgentStationChromeFrameProps> = ({
  enabled,
  illuminated,
  isFullMode,
  children,
}) => {
  if (!enabled) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    );
  }

  const frameClassName = illuminated
    ? "border-primary-6/80 ring-primary-6/15"
    : "border-border-2 ring-border-2/60";

  // In `inset` mode the outer view container already paints a `rounded-page`
  // (20px) card. The chrome frame sits 4px inside that card (`p-1`), so the
  // chrome's own corner must shrink by the same 4px to stay visually
  // concentric with the outer rounding. In full/compact mode the outer view
  // is edge-to-edge (no radius), so the chrome keeps the full `rounded-page`.
  const innerRadiusClass = isFullMode
    ? "rounded-page"
    : "rounded-[calc(var(--radius-page)-4px)]";

  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${isFullMode ? "p-2" : "p-1"}`}
    >
      {illuminated && (
        <div
          className={`composer-breathing pointer-events-none absolute inset-2 z-0 ${innerRadiusClass} bg-[radial-gradient(circle_at_50%_100%,color-mix(in_srgb,var(--color-primary-6)_14%,transparent),transparent_58%)]`}
        />
      )}
      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${innerRadiusClass} border-[1.5px] bg-workstation-bg ring-4 ${frameClassName}`}
      >
        <div
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${innerRadiusClass}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

AgentStationChromeFrame.displayName = "AgentStationChromeFrame";

export default AgentStationChromeFrame;
