import type { ReactNode } from "react";

import type { TabPillItem } from "./types";

export function BoldStableLabel({
  label,
  isBold,
}: {
  label: string;
  isBold: boolean;
}) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span
        aria-hidden="true"
        className="invisible whitespace-nowrap"
        style={{ fontWeight: 600 }}
      >
        {label}
      </span>
      <span
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ fontWeight: isBold ? 600 : 400 }}
      >
        <span className="truncate">{label}</span>
      </span>
    </span>
  );
}

export function renderTabContent(
  tab: TabPillItem,
  isIconOnly: boolean,
  reserveBoldWidth: boolean,
  isActive: boolean,
  isHovered?: boolean,
  boldWhenActive = true
): ReactNode {
  const displayIcon = isHovered && tab.hoverIcon ? tab.hoverIcon : tab.icon;
  if (isIconOnly || (tab.icon && !tab.label)) {
    return displayIcon || <span className="truncate">{tab.label}</span>;
  }
  const label = reserveBoldWidth ? (
    <BoldStableLabel label={tab.label} isBold={isActive && boldWhenActive} />
  ) : (
    <span className="truncate">{tab.label}</span>
  );
  if (tab.icon || tab.badge || tab.hoverIcon) {
    return (
      <div className="flex items-center gap-1.5">
        {displayIcon && (
          <div className="flex flex-shrink-0 items-center">{displayIcon}</div>
        )}
        {label}
        {tab.badge && (
          <div className="flex flex-shrink-0 items-center">{tab.badge}</div>
        )}
      </div>
    );
  }
  return label;
}
