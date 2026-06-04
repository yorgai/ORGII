/**
 * Types for the CanvasInlineCard chat block.
 *
 * Three rendering modes mirror the WorkStation Canvas app:
 *   html  — Agent-provided HTML string rendered in a sandboxed iframe
 *   url   — External URL loaded in a sandboxed iframe (no allow-same-origin)
 *   a2ui  — Agent-to-UI JSONL stream, built incrementally into HTML
 */

export type CanvasInlineMode = "html" | "url" | "a2ui";

export interface CanvasInlineCardProps {
  /** Rendering mode — determines how `content` / `url` are used. */
  mode: CanvasInlineMode;
  /**
   * Raw HTML string (mode="html") or JSONL content (mode="a2ui").
   * Ignored when mode="url".
   */
  content?: string;
  /** Target URL for mode="url". */
  url?: string;
  /**
   * Optional display title shown in the card toolbar.
   * Defaults to a locale string like "Agent Preview".
   */
  title?: string;
  /** Initial height in px. Defaults to 280. */
  initialHeight?: number;
  /** Whether the agent is still streaming content into this card. */
  isStreaming?: boolean;
  /**
   * Optional external close handler. When provided, clicking ✕ calls this
   * instead of the internal `isClosed` toggle — lets parents control
   * card visibility.
   */
  onClose?: () => void;
  /**
   * Called when the user clicks the Summarize button in the toolbar.
   * The parent is responsible for building the message and dispatching it
   * to the agent. When absent the button is not rendered.
   */
  onSummarize?: () => void;
  /**
   * Session ID for the canvas preview. When provided together with the
   * card's content, the toolbar shows a "View in Simulator" button that
   * jumps the Simulator panel to the CANVAS app.
   */
  sessionId?: string;
}

/** A single A2UI JSONL element. */
export interface A2UIElement {
  type:
    | "heading"
    | "text"
    | "code"
    | "image"
    | "button"
    | "divider"
    | "list"
    | "html";
  content?: string;
  style?: string;
  items?: string[];
}
