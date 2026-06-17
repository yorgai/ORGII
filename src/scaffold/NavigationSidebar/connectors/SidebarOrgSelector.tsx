import { Plus } from "lucide-react";
import React, { useCallback } from "react";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import Select, { type SelectOption } from "@src/components/Select";

interface SidebarOrgSelectorProps {
  value: string;
  options: SelectOption[];
  addOrgLabel: string;
  onChange: (orgId: string) => void;
  onAddOrg: () => void;
}

const SidebarOrgSelector: React.FC<SidebarOrgSelectorProps> = React.memo(
  ({ value, options, addOrgLabel, onChange, onAddOrg }) => {
    const handleChange = useCallback(
      (nextValue: string | number | (string | number)[]) => {
        if (Array.isArray(nextValue)) return;
        onChange(String(nextValue));
      },
      [onChange]
    );

    const renderDropdown = useCallback(
      (menu: React.ReactNode) => (
        <>
          {menu}
          <div className="border-0 border-t border-solid border-border-2 p-1">
            <button
              type="button"
              className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full border-none bg-transparent text-text-1`}
              onClick={onAddOrg}
            >
              <Plus size={13} strokeWidth={2} className="shrink-0" />
              <span className="min-w-0 truncate">{addOrgLabel}</span>
            </button>
          </div>
        </>
      ),
      [addOrgLabel, onAddOrg]
    );

    return (
      <div className="mb-1 px-3">
        <Select
          value={value}
          options={options}
          onChange={handleChange}
          dropdownRender={renderDropdown}
          variant="ghost"
          size="small"
          radius="lg"
          dropdownWidthMode="match"
          dropdownAlign="left"
          className="h-7"
          selectorClassName="h-7 !px-2 text-[12px] font-normal [&_.select-suffix]:ml-1 [&_.select-value]:text-[12px]"
          dataTestId="sidebar-org-selector"
        />
      </div>
    );
  }
);

SidebarOrgSelector.displayName = "SidebarOrgSelector";

export default SidebarOrgSelector;
