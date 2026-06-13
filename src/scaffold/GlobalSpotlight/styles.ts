// ============ SPOTLIGHT STYLES ============
// CSS that cannot be expressed with Tailwind utility classes
// (animations, scrollbar styling, pseudo-selectors, third-party library overrides)

export const SPOTLIGHT_STYLES = `
  /* ========== SPOTLIGHT SHADOW ========== */
  .spotlight-shadow {
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3), 0 8px 20px rgba(0, 0, 0, 0.2);
  }

  /* ========== SCROLLBAR ========== */
  .spotlight-scrollable {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .spotlight-scrollable::-webkit-scrollbar { display: none; }

  /* ========== HOVER/SELECTION STATES ========== */
  /* 
   * .selected tracks the active item in both modes:
   * - Keyboard: arrow keys update selectedIndex
   * - Mouse: onMouseEnter updates selectedIndex
   * Single highlight via fill-2 background, no text color changes.
   */
  
  /* Selected item - always visible regardless of input mode */
  .spotlight-item.selected,
  .spotlight-item:hover {
    background: var(--color-fill-2);
  }
`;
