import React from "react";

import Button from "@src/components/Button";

import SessionTable, { type SessionTableItem } from "./SessionTable";

interface SessionGroupPageAction {
  label: React.ReactNode;
  onClick: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  testId?: string;
}

export interface SessionGroupPageProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  items: SessionTableItem[];
  onSelectItem?: (item: SessionTableItem) => void;
  actions?: SessionGroupPageAction[];
  toolbar?: React.ReactNode;
  className?: string;
  testId?: string;
  headerTestId?: string;
  listTestId?: string;
  dataAttributes?: Record<string, string | number | boolean | undefined>;
}

export const SessionGroupPage: React.FC<SessionGroupPageProps> = ({
  title,
  subtitle,
  items,
  onSelectItem,
  actions = [],
  toolbar,
  className,
  testId,
  headerTestId,
  listTestId,
  dataAttributes,
}) => {
  return (
    <div
      className={`${className ?? ""} flex h-full min-h-0 flex-col overflow-hidden`}
      data-testid={testId}
      {...(dataAttributes ?? {})}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-solid border-border-2 px-4 py-3"
        data-testid={headerTestId}
      >
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text-1">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-[12px] text-text-3">{subtitle}</div>
          ) : null}
        </div>
        {actions.length ? (
          <div className="flex shrink-0 items-center gap-2">
            {actions.map((action, index) => (
              <Button
                key={index}
                htmlType="button"
                variant={action.variant ?? "secondary"}
                size="small"
                disabled={action.disabled}
                onClick={action.onClick}
                data-testid={action.testId}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {toolbar ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-solid border-border-2 px-4 py-2">
          {toolbar}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden" data-testid={listTestId}>
        <SessionTable items={items} onSelect={onSelectItem} />
      </div>
    </div>
  );
};

export default SessionGroupPage;
