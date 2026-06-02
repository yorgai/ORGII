/**
 * DropdownSearch Component
 *
 * Search input for dropdowns with consistent styling.
 *
 * @example
 * ```tsx
 * import { DropdownSearch } from "@src/components/Dropdown";
 *
 * <DropdownPanel>
 *   <DropdownSearch
 *     value={searchValue}
 *     onChange={setSearchValue}
 *     placeholder="Search options..."
 *     autoFocus
 *   />
 *   <div className="p-1">
 *     {filteredOptions.map(opt => (
 *       <DropdownItem key={opt.value}>{opt.label}</DropdownItem>
 *     ))}
 *   </div>
 * </DropdownPanel>
 * ```
 */
import { Search } from "lucide-react";
import React, { forwardRef, useEffect, useRef } from "react";

import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";

import { DROPDOWN_CLASSES, DROPDOWN_SEARCH } from "./tokens";

export interface DropdownSearchProps {
  /**
   * Search input value
   */
  value: string;

  /**
   * Change handler
   */
  onChange: (value: string) => void;

  /**
   * Placeholder text
   * @default "Search..."
   */
  placeholder?: string;

  /**
   * Auto-focus the input when mounted
   * @default false
   */
  autoFocus?: boolean;
}

const DropdownSearch = forwardRef<HTMLInputElement, DropdownSearchProps>(
  ({ value, onChange, placeholder = "Search...", autoFocus = false }, ref) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;
    const tauriSelectAll = useTauriSelectAllShortcut();

    // Auto-focus handling
    useEffect(() => {
      if (autoFocus && inputRef.current) {
        // Small delay to ensure dropdown is rendered
        const timer = setTimeout(() => {
          inputRef.current?.focus();
        }, 10);
        return () => clearTimeout(timer);
      }
    }, [autoFocus, inputRef]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    };

    // Prevent dropdown from closing when clicking inside search
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
    };

    return (
      <div className={DROPDOWN_CLASSES.searchContainer}>
        <Search
          size={DROPDOWN_SEARCH.iconSize}
          className="flex-shrink-0 text-text-3"
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onClick={handleClick}
          onKeyDown={tauriSelectAll}
          placeholder={placeholder}
          className={DROPDOWN_CLASSES.searchInput}
        />
      </div>
    );
  }
);

DropdownSearch.displayName = "DropdownSearch";

export default DropdownSearch;
