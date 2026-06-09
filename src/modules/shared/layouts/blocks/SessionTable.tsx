import React from "react";
import { useTranslation } from "react-i18next";

const SESSION_TABLE_GRID_CLASS =
  "grid-cols-[minmax(220px,1.45fr)_minmax(95px,0.55fr)_minmax(210px,1.05fr)_minmax(130px,0.7fr)_minmax(115px,0.6fr)_minmax(115px,0.6fr)]";

export interface SessionTableItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  statusLabel: React.ReactNode;
  statusColor?: string;
  agentIcon?: React.ReactNode;
  agentLabel?: React.ReactNode;
  modelIcon?: React.ReactNode;
  modelLabel?: React.ReactNode;
  workspaceLabel?: React.ReactNode;
  workspaceTitle?: string;
  startedLabel?: React.ReactNode;
  lastUpdatedLabel?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  dataAttributes?: Record<string, string | number | boolean | undefined>;
}

interface SessionTableProps {
  items: SessionTableItem[];
  onSelect?: (item: SessionTableItem) => void;
  className?: string;
}

const EMPTY_CELL = "—";

export const SessionTable: React.FC<SessionTableProps> = ({
  items,
  onSelect,
  className,
}) => {
  const { t } = useTranslation(["sessions", "common"]);

  return (
    <div
      className={`${className ?? ""} scrollbar-overlay min-h-0 flex-1 overflow-auto`}
    >
      <div className="min-w-[980px]">
        <div
          className={`sticky top-0 z-10 grid ${SESSION_TABLE_GRID_CLASS} gap-4 border-b border-border-2 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-text-3`}
        >
          <div>{t("common:labels.name")}</div>
          <div>{t("common:labels.status")}</div>
          <div>{t("sessions:opsControl.list.agentModel")}</div>
          <div>{t("common:selectors.shared.workspace")}</div>
          <div>{t("sessions:opsControl.list.started")}</div>
          <div>{t("sessions:opsControl.list.lastUpdated")}</div>
        </div>

        <div>
          {items.map((item) => {
            const dataAttributes = item.dataAttributes ?? {};
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                data-testid={item.testId}
                className={`grid w-full ${SESSION_TABLE_GRID_CLASS} items-center gap-4 border-b border-border-2 px-5 py-2 text-left transition-colors hover:bg-fill-1 ${
                  item.active ? "bg-fill-1" : ""
                } ${item.disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}
                onClick={() => {
                  if (item.disabled) return;
                  onSelect?.(item);
                }}
                {...dataAttributes}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] font-medium text-text-1">
                      {item.title}
                    </span>
                  </div>
                  {item.description ? (
                    <div
                      className="mt-0.5 truncate text-[11px] text-text-3"
                      title={
                        typeof item.description === "string"
                          ? item.description
                          : undefined
                      }
                    >
                      {item.description}
                    </div>
                  ) : null}
                </div>

                <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        item.statusColor ?? "var(--color-fill-4)",
                    }}
                  />
                  <span className="truncate">{item.statusLabel}</span>
                </div>

                <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-2">
                  {item.agentIcon}
                  <span className="min-w-0 truncate">
                    {item.agentLabel ?? EMPTY_CELL}
                  </span>
                  {item.modelLabel ? (
                    <>
                      <span className="shrink-0 text-text-4">·</span>
                      {item.modelIcon}
                      <span className="min-w-0 truncate">
                        {item.modelLabel}
                      </span>
                    </>
                  ) : null}
                </div>

                <div
                  className="truncate text-[12px] text-text-3"
                  title={item.workspaceTitle}
                >
                  {item.workspaceLabel ?? EMPTY_CELL}
                </div>

                <div className="truncate text-[12px] text-text-3">
                  {item.startedLabel ?? EMPTY_CELL}
                </div>

                <div className="truncate text-[12px] text-text-3">
                  {item.lastUpdatedLabel ?? EMPTY_CELL}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SessionTable;
