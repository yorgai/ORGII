/**
 * Terminal Search Panel
 *
 * Find-in-terminal search bar using the shared SearchInput component.
 * Reuses the same styling as CodeMirror search for consistency.
 */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { SearchInput } from "@src/components/SearchInput";

// ============================================
// Types
// ============================================

export interface TerminalSearchPanelProps {
  /** Whether the search panel is visible */
  isOpen: boolean;
  /** Callback to close the search panel */
  onClose: () => void;
  /** Search next match */
  onFindNext: (
    query: string,
    options: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  ) => boolean;
  /** Search previous match */
  onFindPrevious: (
    query: string,
    options: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  ) => boolean;
  /** Clear search highlights */
  onClearSearch: () => void;
  /** Focus the terminal */
  onFocusTerminal: () => void;
}

// ============================================
// Component
// ============================================

export const TerminalSearchPanel: React.FC<TerminalSearchPanelProps> = memo(
  ({
    isOpen,
    onClose,
    onFindNext,
    onFindPrevious,
    onClearSearch,
    onFocusTerminal,
  }) => {
    const [query, setQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation("sessions");

    // Focus input when panel opens
    useEffect(() => {
      if (isOpen) {
        // Small delay to ensure the panel is rendered
        setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 50);
      }
    }, [isOpen]);

    // Clear search when query changes
    useEffect(() => {
      if (!query) {
        onClearSearch();
      }
    }, [query, onClearSearch]);

    // Handle keyboard shortcuts
    useEffect(() => {
      if (!isOpen) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        // Escape - close panel
        if (event.key === "Escape") {
          event.preventDefault();
          onClearSearch();
          onClose();
          onFocusTerminal();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose, onClearSearch, onFocusTerminal]);

    const searchOptions = useMemo(
      () => ({ caseSensitive, regex: useRegex, wholeWord }),
      [caseSensitive, useRegex, wholeWord]
    );

    const handleFindNext = useCallback(() => {
      if (query) {
        onFindNext(query, searchOptions);
      }
    }, [query, searchOptions, onFindNext]);

    const handleFindPrevious = useCallback(() => {
      if (query) {
        onFindPrevious(query, searchOptions);
      }
    }, [query, searchOptions, onFindPrevious]);

    const handleClose = useCallback(() => {
      onClearSearch();
      onClose();
      onFocusTerminal();
    }, [onClearSearch, onClose, onFocusTerminal]);

    const handleSubmit = useCallback(() => {
      handleFindNext();
    }, [handleFindNext]);

    if (!isOpen) return null;

    return (
      <div className="flex items-center gap-2 border-b border-border-2 px-3 py-1.5">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("terminal.findInTerminal")}
          variant="panel"
          caseSensitive={caseSensitive}
          wholeWord={wholeWord}
          useRegex={useRegex}
          onCaseSensitiveToggle={() => setCaseSensitive(!caseSensitive)}
          onWholeWordToggle={() => setWholeWord(!wholeWord)}
          onRegexToggle={() => setUseRegex(!useRegex)}
          onPrevious={handleFindPrevious}
          onNext={handleFindNext}
          onClose={handleClose}
          onSubmit={handleSubmit}
          inputRef={inputRef as React.RefObject<HTMLInputElement>}
          hideChevron
          className="flex-1"
        />
      </div>
    );
  }
);

TerminalSearchPanel.displayName = "TerminalSearchPanel";

export default TerminalSearchPanel;
