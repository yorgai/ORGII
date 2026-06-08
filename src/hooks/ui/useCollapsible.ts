import { useCallback, useState } from "react";

export interface UseCollapsibleOptions {
  /** Initial open/expanded state. Default: `true`. */
  defaultOpen?: boolean;
  /** Called after each toggle with the new open state. */
  onOpenChange?: (open: boolean) => void;
}

export interface UseCollapsibleReturn {
  /** Whether the section is currently open (expanded). */
  isOpen: boolean;
  /** Toggle open ↔ closed. */
  toggle: () => void;
  /** Imperatively open the section. */
  open: () => void;
  /** Imperatively close the section. */
  close: () => void;
}

/**
 * Manages the open/closed toggle state shared by collapsible UI sections.
 * Extracted from the three duplicated `CollapsibleSection` components so that
 * the state logic lives in one place.
 */
export function useCollapsible(
  options: UseCollapsibleOptions = {}
): UseCollapsibleReturn {
  const { defaultOpen = true, onOpenChange } = options;
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  const open = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) return prev;
      onOpenChange?.(true);
      return true;
    });
  }, [onOpenChange]);

  const close = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) return prev;
      onOpenChange?.(false);
      return false;
    });
  }, [onOpenChange]);

  return { isOpen, toggle, open, close };
}
