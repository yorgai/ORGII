let kanbanHorizontalScrollGuardGeneration = 0;

/**
 * Resets `scrollLeft` to 0 on the kanban page element and all its ancestors.
 * This prevents the page from drifting horizontally when the detail panel
 * overlay changes width, or when a column is expanded.
 */
export function resetKanbanHorizontalScroll(): void {
  const resetElement = (element: Element | null) => {
    if (element instanceof HTMLElement && element.scrollLeft !== 0) {
      element.scrollLeft = 0;
    }
  };

  window.scrollTo(0, window.scrollY);
  resetElement(document.scrollingElement);
  resetElement(document.documentElement);
  resetElement(document.body);

  const page = Array.from(document.querySelectorAll(".agent-kanban-page")).find(
    (candidate) => candidate.getClientRects().length > 0
  );
  let current: Element | null = page ?? null;
  while (current) {
    resetElement(current);
    current = current.parentElement;
  }
}

/**
 * Starts a multi-frame horizontal scroll guard that keeps calling
 * `resetKanbanHorizontalScroll` for 18 animation frames. Uses a generation
 * counter to cancel any prior in-flight guard when a new one starts.
 */
export function beginKanbanHorizontalScrollGuard(): void {
  kanbanHorizontalScrollGuardGeneration += 1;
  const generation = kanbanHorizontalScrollGuardGeneration;
  let framesRemaining = 18;

  const resetFrame = () => {
    if (generation !== kanbanHorizontalScrollGuardGeneration) return;
    resetKanbanHorizontalScroll();
    framesRemaining -= 1;
    if (framesRemaining > 0) {
      window.requestAnimationFrame(resetFrame);
    }
  };

  resetFrame();
}
