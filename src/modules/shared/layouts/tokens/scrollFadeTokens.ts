/**
 * Scroll Fade Tokens
 *
 * Reusable tokens for scroll containers with edge fade masks.
 * Masks content at top/bottom viewport edges to indicate scrollable content.
 *
 * Usage:
 *   <div className={`overflow-y-auto ${SCROLL_FADE_TOKENS.container}`}>
 *     <div className="p-6">...</div>
 *   </div>
 *   <div className={`overflow-y-auto ${SCROLL_FADE_TOKENS.containerSmall}`}>
 *     ...compact list (NOT a dropdown / select)...
 *   </div>
 *
 * NOTE: Dropdown and Select panels intentionally do NOT use the fade — see
 * the rule in `.cursor/rules/orgii-frontend-components.mdc` (Dropdowns) and
 * the tokens in `src/components/Dropdown/tokens.ts`. Use `containerSmall`
 * only for compact lists that live outside the dropdown system.
 */
export const SCROLL_FADE_TOKENS = {
  /** Class for panels (24px fade zone) */
  container: "scroll-fade-y",
  /** Class for compact non-dropdown lists (12px fade zone) */
  containerSmall: "scroll-fade-y-sm",
  /** Suppress top fade (scroll is at top) */
  atTop: "scroll-fade-at-top",
  /** Suppress bottom fade (scroll is at bottom) */
  atBottom: "scroll-fade-at-bottom",
  /** Fade height in pixels (panels) */
  heightPx: 24,
  /** Fade height in pixels (compact lists) */
  heightPxSmall: 12,
} as const;
