/**
 * Renderer wrapper for `timeline-diff` tabs.
 *
 * NOTE: No tab is ever created with `type: "timeline-diff"` today —
 * `createTimelineDiffTab` (codeEditor.ts) actually produces a `git-diff`
 * tab with `data.isTimeline = true`. The `"timeline-diff"` literal exists
 * in the `WorkStationTabType` union but is dormant. This stub satisfies
 * the exhaustiveness check in `registry.ts` without claiming behavioural
 * parity. Phase 2 may delete `"timeline-diff"` from the union or actually
 * start using it; either way the change happens outside Phase 1b.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const TimelineDiffTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <HostCoupledPlaceholder
    tabType="timeline-diff"
    title="Timeline Diff"
    hostNote="Dormant tab type — no factory currently produces this"
  />
));

TimelineDiffTabRenderer.displayName = "TimelineDiffTabRenderer";

export default TimelineDiffTabRenderer;
