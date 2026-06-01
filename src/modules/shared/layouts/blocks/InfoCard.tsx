/**
 * InfoCard
 *
 * Reusable key-value info card with rounded container styling.
 * Used in detail panels for Code Accounts, Channels, Memory Browser, etc.
 */
import React from "react";

import { INFO_CARD_TOKENS } from "@src/config/detailPanelTokens";

export interface InfoCardRow {
  /** i18n label displayed on the left */
  label: string;
  /** Value node displayed on the right */
  value: React.ReactNode;
  /** Hide this row (conditional rendering helper) */
  hidden?: boolean;
}

export interface InfoCardProps {
  rows: InfoCardRow[];
  /** Extra content rendered above the card (e.g. badges) */
  header?: React.ReactNode;
  className?: string;
}

const InfoCard: React.FC<InfoCardProps> = ({
  rows,
  header,
  className = "",
}) => {
  const visibleRows = rows.filter((row) => !row.hidden);
  if (visibleRows.length === 0 && !header) return null;

  return (
    <div>
      {header}
      <div className={`${INFO_CARD_TOKENS.container} ${className}`}>
        <div className={`grid ${INFO_CARD_TOKENS.rowGap}`}>
          {visibleRows.map((row) => (
            <div key={row.label} className={INFO_CARD_TOKENS.row}>
              <span className={INFO_CARD_TOKENS.label}>{row.label}</span>
              <span className={INFO_CARD_TOKENS.value}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InfoCard;
