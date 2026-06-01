/**
 * ToolEventPreview - Embedded component for Tools > Dev Tools tab
 *
 * Preview playground surfaces with:
 * - UI mode: default input box preview
 * - Tool mode: browse Rust tool definitions from the registry
 * - Input mode: preview Chat Panel input variants
 */
import { useState } from "react";

import "@src/engines/ChatPanel/ChatHistory/ActivityRouter.scss";
import "@src/engines/ChatPanel/ChatHistory/index.scss";

import "./ToolEventPreview.scss";
import { ToolDefinitionPreview } from "./previews";
import { SingleEventPreview } from "./single-event";
import type { PreviewMode } from "./types";

export function ToolEventPreview() {
  const [mode, setMode] = useState<PreviewMode>("ui");

  return (
    <div className="tool-event-preview">
      <div className="tool-event-preview-content">
        {mode === "tool" ? (
          <ToolDefinitionPreview mode={mode} onModeChange={setMode} />
        ) : (
          <SingleEventPreview mode={mode} onModeChange={setMode} />
        )}
      </div>
    </div>
  );
}

export default ToolEventPreview;
