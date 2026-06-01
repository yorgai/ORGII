/**
 * Renderer wrapper for the pinned `terminal` tab.
 *
 * TODO(Phase 2): `TerminalMainContent` requires `terminalState`
 * (`UseTerminalStateReturn`) which is owned exclusively by the editor
 * host (`useTerminalState()` lives one level up in EditorContent so
 * the same runtime is shared across panes). Outside the host this
 * wrapper cannot mount a real terminal session. Phase 2 either lifts
 * the terminal hook above the dispatcher or registers an action-system
 * resolver that returns the live state.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const TerminalTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <HostCoupledPlaceholder
    tabType="terminal"
    title="Terminal"
    hostNote="Editor host owns useTerminalState() runtime"
  />
));

TerminalTabRenderer.displayName = "TerminalTabRenderer";

export default TerminalTabRenderer;
