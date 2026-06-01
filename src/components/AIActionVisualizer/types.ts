/**
 * AI Action Visualizer Types
 *
 * Simplified convention-based approach:
 * - data-action="actionType" on elements
 * - data-action-id="value" for dynamic targeting (optional)
 * - Description comes from Zod action schema
 */

// ============================================
// Visualizer State
// ============================================

export interface VisualizerState {
  /** Whether visualization is active */
  isActive: boolean;
  /** Target element's bounding rect */
  targetRect: DOMRect | null;
  /** Action description (from Zod schema or payload) */
  description: string;
  /** Animation type */
  animationType: "click" | "focus" | "highlight";
  /** Whether to show the AI cursor */
  showCursor: boolean;
  /** Whether to show the toast */
  showToast: boolean;
}

// ============================================
// Show Configuration
// ============================================

export interface ShowConfig {
  /** The action type (used to find [data-action="..."]) */
  actionType: string;
  /** Action payload (used for dynamic id lookup) */
  payload?: Record<string, unknown>;
  /** Description to show in toast */
  description?: string;
  /** Animation type (default: "click") */
  animationType?: "click" | "focus" | "highlight";
  /** Show AI cursor (default: true) */
  showCursor?: boolean;
  /** Show action toast (default: true) */
  showToast?: boolean;
}

// ============================================
// Controller Interface
// ============================================

export interface AIActionVisualizerController {
  show: (config: ShowConfig) => void;
  hide: () => void;
  isActive: boolean;
}
