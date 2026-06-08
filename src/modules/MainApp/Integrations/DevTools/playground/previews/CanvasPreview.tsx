/**
 * CanvasPreview — playground demo for A2UI element types.
 *
 * Showcases all element types including the new table, chart, and form
 * types. Useful for verifying styling and action callbacks during development.
 */
import React, { useState } from "react";

import A2UIRenderer from "@src/engines/ChatPanel/blocks/CanvasInlineCard/A2UIRenderer";
import type { A2UIElement } from "@src/engines/ChatPanel/blocks/CanvasInlineCard/types";

const DEMO_LINES: A2UIElement[] = [
  { type: "heading", content: "A2UI Canvas Preview" },
  {
    type: "text",
    content:
      "This preview demonstrates all supported element types rendered natively in React.",
  },
  { type: "divider" },
  { type: "heading", content: "Text & Code" },
  {
    type: "text",
    content:
      "Regular paragraph text with full Tailwind styling from the design system.",
  },
  {
    type: "code",
    content: 'const greeting = "Hello, A2UI!";\nconsole.log(greeting);',
  },
  { type: "divider" },
  { type: "heading", content: "List" },
  {
    type: "list",
    items: [
      "Incremental streaming updates",
      "Native React rendering",
      "DOMPurify HTML sanitization",
      "Bidirectional action callbacks",
    ],
  },
  { type: "divider" },
  { type: "heading", content: "Table" },
  {
    type: "table",
    headers: ["Feature", "Before", "After"],
    rows: [
      ["Rendering", "iframe + srcDoc", "Native React"],
      ["Streaming", "full reload", "incremental diff"],
      ["canvas_eval", "postMessage (dead)", "A2UIRendererHandle.evalScript"],
      ["HTML elements", "unsanitized", "DOMPurify sanitized"],
    ],
  },
  { type: "divider" },
  { type: "heading", content: "Chart — Bar" },
  {
    type: "chart",
    chartType: "bar",
    title: "Token Usage by Model",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [
        { label: "GPT-4o", values: [120, 340, 280, 450, 390, 520] },
        { label: "Claude", values: [200, 180, 310, 270, 420, 380] },
      ],
    },
  },
  { type: "heading", content: "Chart — Line" },
  {
    type: "chart",
    chartType: "line",
    title: "Active Sessions",
    data: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [
        { label: "This week", values: [45, 62, 58, 71, 88, 34, 27] },
        { label: "Last week", values: [38, 51, 47, 65, 72, 29, 22] },
      ],
    },
  },
  { type: "divider" },
  { type: "heading", content: "HTML Element (sanitized)" },
  {
    type: "html",
    content:
      '<p>Rendered via <strong>DOMPurify</strong>. Scripts are stripped: <script>alert("xss")</script></p>',
  },
  { type: "divider" },
  { type: "heading", content: "Form" },
  {
    type: "form",
    actionId: "demo_form_submit",
    submitLabel: "Send Feedback",
    fields: [
      { name: "name", label: "Your Name", inputType: "text", defaultValue: "" },
      {
        name: "rating",
        label: "Rating",
        inputType: "select",
        options: ["Excellent", "Good", "Fair", "Poor"],
        defaultValue: "Good",
      },
      {
        name: "subscribe",
        label: "Subscribe to updates",
        inputType: "checkbox",
        defaultValue: "false",
      },
    ],
  },
  { type: "divider" },
  { type: "heading", content: "Buttons" },
  { type: "button", content: "Primary Action", actionId: "primary_action" },
  { type: "button", content: "Secondary Action", actionId: "secondary_action" },
];

const DEMO_JSONL = DEMO_LINES.map((el) => JSON.stringify(el));

export function CanvasPreview() {
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [streamedCount, setStreamedCount] = useState(DEMO_JSONL.length);

  const handleAction = (actionId: string, payload?: unknown) => {
    setLastAction(`${actionId}: ${JSON.stringify(payload)}`);
  };

  const visibleLines = DEMO_JSONL.slice(0, streamedCount);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* preview controls */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-1 bg-fill-2 px-4 py-2">
        <span className="text-xs font-medium text-text-2">Canvas Preview</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-text-4">
            Lines: {streamedCount} / {DEMO_JSONL.length}
          </span>
          <input
            type="range"
            min={0}
            max={DEMO_JSONL.length}
            value={streamedCount}
            onChange={(e) => setStreamedCount(Number(e.target.value))}
            className="w-24 accent-primary-6"
            title="Simulate streaming"
          />
          <button
            type="button"
            onClick={() => setStreamedCount(DEMO_JSONL.length)}
            className="rounded px-2 py-0.5 text-xs text-text-4 hover:bg-fill-3 hover:text-text-1"
          >
            Reset
          </button>
        </div>
      </div>

      {/* last action log */}
      {lastAction && (
        <div className="shrink-0 border-b border-border-1 bg-primary-6/10 px-4 py-1.5 font-mono text-[11px] text-primary-6">
          action: {lastAction}
        </div>
      )}

      {/* renderer */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <A2UIRenderer
          lines={visibleLines}
          onAction={handleAction}
          sessionId="playground"
        />
      </div>
    </div>
  );
}
