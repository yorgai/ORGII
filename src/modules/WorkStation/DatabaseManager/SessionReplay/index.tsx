/**
 * SessionReplayDatabase
 *
 * Simulator app that visualizes agent database operations
 * in a timeline/log view. Shows queries, results, and errors.
 */
import { Database, Play } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { SimulatorAppProps } from "@src/engines/Simulator/apps/core/types";
import {
  CountBadge,
  NoTabsPlaceholder,
  SimulatorReplayChrome,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "@src/modules/WorkStation/shared";
import { HEADER_CLASSES } from "@src/modules/WorkStation/shared/tokens";

import type { DatabaseOperation, SimulatorDatabaseState } from "./types";

const OPERATION_ICONS: Record<string, React.ReactNode> = {
  db_explore: <Database size={14} className="text-primary-6" />,
  db_run: <Play size={14} className="text-success-6" />,
};

function operationTypeLabel(
  type: string,
  t: ReturnType<typeof useTranslation<"sessions">>["t"]
): string {
  if (type === "db_explore") {
    return t("simulator.replay.database.operation.explore");
  }
  if (type === "db_run") {
    return t("simulator.replay.database.operation.runSql");
  }
  return type;
}

const OperationRow: React.FC<{
  op: DatabaseOperation;
  isSelected: boolean;
  t: ReturnType<typeof useTranslation<"sessions">>["t"];
}> = ({ op, isSelected, t }) => (
  <div
    className={`flex items-start gap-2 rounded-md px-3 py-2 text-[12px] ${
      isSelected ? "bg-primary-1 ring-1 ring-primary-6" : ""
    } ${op.isError ? "bg-danger-1" : ""}`}
  >
    <div className="mt-0.5 flex-shrink-0">
      {OPERATION_ICONS[op.type] ?? <Database size={14} />}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-medium text-text-1">
          {operationTypeLabel(op.type, t)}
        </span>
        {op.connectionName && (
          <span className="truncate text-text-3">@ {op.connectionName}</span>
        )}
        {op.duration !== undefined && (
          <span className="ml-auto flex-shrink-0 text-text-3">
            {op.duration}ms
          </span>
        )}
      </div>
      {op.sql && (
        <pre className="mt-1 truncate text-[11px] text-text-2">{op.sql}</pre>
      )}
      {op.table && !op.sql && (
        <span className="text-[11px] text-text-3">
          {t("simulator.replay.database.row.tablePrefix", { name: op.table })}
        </span>
      )}
      {op.resultSummary && (
        <div
          className={`mt-1 truncate text-[11px] ${op.isError ? "text-danger-6" : "text-text-3"}`}
        >
          {op.isError
            ? t("simulator.replay.database.row.resultErrorPrefix")
            : t("simulator.replay.database.row.resultArrowPrefix")}
          {op.resultSummary}
        </div>
      )}
    </div>
  </div>
);

const SessionReplayDatabase: React.FC<SimulatorAppProps> = ({
  state: appState,
  mode = "simulation",
}) => {
  const dbState = appState as SimulatorDatabaseState | undefined;
  const operations = dbState?.operations ?? [];
  const { t } = useTranslation("sessions");
  const simulatorPlaceholderActions = useSimulatorPlaceholderActions(mode);
  const simulatorAwaitingAgentCaption = useSimulatorAwaitingAgentCaption();

  const noopTabClick = () => {};

  if (operations.length === 0) {
    return (
      <SimulatorReplayChrome
        tabs={[]}
        activeEventId={null}
        onTabClick={noopTabClick}
      >
        <div className="min-h-0 flex-1">
          <NoTabsPlaceholder
            icon="database"
            caption={simulatorAwaitingAgentCaption}
            actions={simulatorPlaceholderActions}
          />
        </div>
      </SimulatorReplayChrome>
    );
  }

  return (
    <SimulatorReplayChrome
      tabs={[]}
      activeEventId={null}
      onTabClick={noopTabClick}
    >
      <div className={HEADER_CLASSES.pageHeader}>
        <Database size={14} className="text-text-3" />
        <span className="text-[12px] font-medium text-text-1">
          {t("simulator.replay.database.headerTitle")}
        </span>
        <CountBadge
          variant="neutral"
          count={operations.length}
          label=""
          showZero
        />
      </div>
      <div className="scrollbar-overlay flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-1">
          {operations.map((op) => (
            <OperationRow
              key={op.eventId}
              op={op}
              isSelected={op === dbState?.selectedOperation}
              t={t}
            />
          ))}
        </div>
      </div>
    </SimulatorReplayChrome>
  );
};

export { SessionReplayDatabase as SimulatorDatabase };
export default SessionReplayDatabase;
