/**
 * ContributorFilter — dropdown for filtering contributors in the chart/table.
 *
 * Multi-select with search. Uses useDropdownEngine + DROPDOWN_CLASSES.
 */
import { ListFilter, Search } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_SEARCH,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { COLLAPSIBLE_SECTION_TOKENS } from "@src/modules/shared/layouts/blocks";

interface ContributorFilterProps {
  contributors: string[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  colorMap: Map<string, string>;
}

const MAX_LIST_HEIGHT = 200;

export const DESELECT_ALL_SENTINEL = "__DESELECT_ALL__" as const;

const ContributorFilter: React.FC<ContributorFilterProps> = memo(
  ({ contributors, selected, onSelectionChange, colorMap }) => {
    const { t } = useTranslation();
    const [search, setSearch] = useState("");
    const tauriSelectAll = useTauriSelectAllShortcut();

    const {
      isOpen,
      isPositioned,
      toggle,
      triggerRef,
      panelRef,
      panelPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      gap: DROPDOWN_PANEL.triggerGap,
      align: "right",
      placement: "bottom",
    });

    const isDeselectAll =
      selected.size === 1 && selected.has(DESELECT_ALL_SENTINEL);
    const allSelected =
      !isDeselectAll &&
      (selected.size === 0 || selected.size === contributors.length);
    const hasFilter = !allSelected;

    const filtered = useMemo(() => {
      if (!search) return contributors;
      const lower = search.toLowerCase();
      return contributors.filter((name) => name.toLowerCase().includes(lower));
    }, [contributors, search]);

    const handleToggle = useCallback(
      (name: string) => {
        if (isDeselectAll) {
          onSelectionChange(new Set([name]));
          return;
        }
        const next = new Set(selected);
        if (next.has(DESELECT_ALL_SENTINEL)) next.delete(DESELECT_ALL_SENTINEL);
        if (allSelected) {
          contributors.forEach((contributor) => next.add(contributor));
          next.delete(name);
        } else if (next.has(name)) {
          next.delete(name);
          if (next.size === 0) {
            onSelectionChange(new Set());
            return;
          }
        } else {
          next.add(name);
          if (next.size === contributors.length) {
            onSelectionChange(new Set());
            return;
          }
        }
        onSelectionChange(next);
      },
      [selected, allSelected, isDeselectAll, contributors, onSelectionChange]
    );

    const handleSelectAll = useCallback(() => {
      if (allSelected) {
        onSelectionChange(new Set([DESELECT_ALL_SENTINEL]));
      } else {
        onSelectionChange(new Set());
      }
    }, [onSelectionChange, allSelected]);

    return (
      <>
        <Button
          {...COLLAPSIBLE_SECTION_TOKENS.actionButton}
          ref={triggerRef}
          icon={<ListFilter size={DROPDOWN_ITEM.iconSize} />}
          onClick={toggle}
          title={t("gitDashboard.filterContributors")}
          className={
            hasFilter
              ? "!bg-primary-1 !text-primary-6"
              : COLLAPSIBLE_SECTION_TOKENS.actionButton.className
          }
        />

        {isOpen &&
          isPositioned &&
          createPortal(
            <div
              ref={panelRef}
              className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.panelWidthClass}`}
              style={{
                position: "fixed",
                top: panelPosition.top,
                right: panelPosition.right,
              }}
            >
              {/* Search */}
              <div className={DROPDOWN_CLASSES.searchContainer}>
                <Search
                  size={DROPDOWN_SEARCH.iconSize}
                  className="shrink-0 text-text-2"
                />
                <input
                  className={DROPDOWN_CLASSES.searchInput}
                  placeholder={t("common:actions.search")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={tauriSelectAll}
                  autoFocus
                />
              </div>

              <div className={DROPDOWN_CLASSES.sectionContainer}>
                <button
                  type="button"
                  className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-between`}
                  onClick={handleSelectAll}
                >
                  <span className="text-text-2">
                    {t("common:actions.selectAll")}
                  </span>
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {allSelected && <DropdownSelectedCheck />}
                  </span>
                </button>
              </div>

              {/* Contributor list */}
              <div
                className={DROPDOWN_CLASSES.optionsContainer}
                style={{ maxHeight: MAX_LIST_HEIGHT }}
              >
                {filtered.map((name) => {
                  const isChecked = allSelected || selected.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-between`}
                      onClick={() => handleToggle(name)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              colorMap.get(name) || "var(--color-primary-6)",
                          }}
                        />
                        <span className="min-w-0 truncate">{name}</span>
                      </span>
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        {isChecked && <DropdownSelectedCheck />}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className={DROPDOWN_CLASSES.listMessage}>
                    {t("common:status.noResults")}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
);

ContributorFilter.displayName = "ContributorFilter";

export default ContributorFilter;
