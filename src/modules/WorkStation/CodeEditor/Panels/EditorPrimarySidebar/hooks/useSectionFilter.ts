import { useCallback, useState } from "react";

export interface UseSectionFilterReturn {
  isOpen: boolean;
  query: string;
  setQuery: (q: string) => void;
  toggle: () => void;
  clear: () => void;
}

/** State and handlers for a collapsible-section filter input */
export function useSectionFilter(): UseSectionFilterReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) setQuery("");
      return !prev;
    });
  }, []);

  const clear = useCallback(() => {
    setQuery("");
    setIsOpen(false);
  }, []);

  return { isOpen, query, setQuery, toggle, clear };
}
