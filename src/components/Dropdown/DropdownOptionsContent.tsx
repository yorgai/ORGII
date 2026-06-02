import { Search } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";

import DropdownOptionsRenderer from "./DropdownOptionsRenderer";
import { DROPDOWN_CLASSES, DROPDOWN_ITEM } from "./tokens";
import type { DropdownOption, DropdownSelectValue } from "./types";

interface DropdownOptionsContentProps {
  showSearch: boolean;
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  filteredOptions: DropdownOption[];
  value?: DropdownSelectValue;
  mode: "single" | "multiple";
  highlightedIndex: number;
  keyboardNavigated: boolean;
  onSelect: (option: DropdownOption) => void;
  getOptionMouseEnterProps?: (index: number) => {
    "data-dropdown-keyboard-mode"?: "true";
    onMouseEnter: () => void;
  };
  loading: boolean;
  emptyContent?: React.ReactNode;
  dropdownRender?: (menu: React.ReactNode) => React.ReactNode;
}

const DropdownOptionsContent: React.FC<DropdownOptionsContentProps> = ({
  showSearch,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  searchInputRef,
  filteredOptions,
  value,
  mode,
  highlightedIndex,
  keyboardNavigated,
  onSelect,
  getOptionMouseEnterProps,
  loading,
  emptyContent,
  dropdownRender,
}) => {
  const { t } = useTranslation();
  const tauriSelectAll = useTauriSelectAllShortcut();

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value);
  };

  return (
    <>
      {showSearch && (
        <div className={DROPDOWN_CLASSES.searchContainer}>
          <Search
            size={DROPDOWN_ITEM.iconSize}
            className="shrink-0 text-text-3"
          />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={
              searchPlaceholder ?? t("common:common.searchPlaceholder")
            }
            value={searchValue}
            onChange={handleSearchChange}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={tauriSelectAll}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={DROPDOWN_CLASSES.searchInput}
          />
        </div>
      )}
      <DropdownOptionsRenderer
        options={filteredOptions}
        value={value}
        mode={mode}
        highlightedIndex={highlightedIndex}
        keyboardNavigated={keyboardNavigated}
        onSelect={onSelect}
        getOptionMouseEnterProps={getOptionMouseEnterProps}
        loading={loading}
        emptyContent={emptyContent}
        dropdownRender={dropdownRender}
      />
    </>
  );
};

export default DropdownOptionsContent;
