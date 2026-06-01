// ============================================
// PanelContent Component
// ============================================
import React, { useMemo } from "react";

import Table, { type TableColumn } from "@src/components/Table";
import type { ApiCall } from "@src/util/monitoring/apiTracker";

import {
  formatApiUrl,
  formatTime,
  getStatusInfo,
  getTriggerLabel,
} from "../utils";
import ApiCallDetails from "./ApiCallDetails";
import EmptyState from "./EmptyState";

// ============================================
// Type Definitions
// ============================================

export interface PanelContentProps {
  apiCalls: ApiCall[];
  expandedCall: string | null;
  onToggleExpand: (id: string) => void;
  onExpandedChange: (id: string | null) => void;
}

// ============================================
// Component
// ============================================

const PanelContent: React.FC<PanelContentProps> = ({
  apiCalls,
  expandedCall,
  onToggleExpand,
  onExpandedChange,
}) => {
  const columns = useMemo<TableColumn<ApiCall>[]>(
    () => [
      {
        key: "backend",
        dataIndex: "backend",
        title: "Backend",
        width: "10%",
        sorter: (callA, callB) => callA.backend.localeCompare(callB.backend),
        render: (_value, call) => (
          <span className="text-[11px] text-text-3">
            {call.backend === "rust" ? "Rust" : "Python"}
          </span>
        ),
      },
      {
        key: "method",
        dataIndex: "method",
        title: "Method",
        width: "10%",
        sorter: (callA, callB) => callA.method.localeCompare(callB.method),
        render: (_value, call) => (
          <span className="text-[11px] text-text-2">{call.method}</span>
        ),
      },
      {
        key: "target",
        dataIndex: "url",
        title: "Target",
        width: "34%",
        sorter: (callA, callB) => {
          const targetA =
            callA.backend === "rust"
              ? callA.tauriCommand || callA.url
              : callA.fullUrl;
          const targetB =
            callB.backend === "rust"
              ? callB.tauriCommand || callB.url
              : callB.fullUrl;
          return targetA.localeCompare(targetB);
        },
        render: (_value, call) => (
          <button
            type="button"
            className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-left text-[11px] text-primary-6"
            onClick={() => onToggleExpand(call.id)}
            title={call.fullUrl}
          >
            {call.backend === "rust"
              ? call.tauriCommand || call.url
              : formatApiUrl(call.fullUrl)}
          </button>
        ),
      },
      {
        key: "time",
        dataIndex: "timestamp",
        title: "Time",
        width: "12%",
        sorter: (callA, callB) =>
          new Date(callA.timestamp).getTime() -
          new Date(callB.timestamp).getTime(),
        render: (_value, call) => (
          <span className="text-[11px] text-text-2">
            {formatTime(call.timestamp)}
          </span>
        ),
      },
      {
        key: "trigger",
        dataIndex: "interactionType",
        title: "Trigger",
        width: "10%",
        sorter: (callA, callB) =>
          (callA.interactionType ?? "auto").localeCompare(
            callB.interactionType ?? "auto"
          ),
        render: (_value, call) => (
          <span className="text-[11px] text-text-2">
            {getTriggerLabel(call.interactionType)}
          </span>
        ),
      },
      {
        key: "status",
        dataIndex: "status",
        title: "Status",
        width: "12%",
        sorter: (callA, callB) => {
          const statusA = callA.status ?? (callA.error ? 500 : 0);
          const statusB = callB.status ?? (callB.error ? 500 : 0);
          return statusA - statusB;
        },
        render: (_value, call) => {
          const statusInfo = getStatusInfo(
            call.status,
            call.error,
            call.duration
          );
          const statusToneClass =
            statusInfo.class === "status-error"
              ? "text-danger-6"
              : statusInfo.class === "status-pending"
                ? "text-warning-6"
                : "text-success-6";
          const statusDotClass =
            statusInfo.class === "status-error"
              ? "bg-danger-6"
              : statusInfo.class === "status-pending"
                ? "bg-warning-6 animate-pulse"
                : "bg-success-6";
          return (
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusToneClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
              {statusInfo.label}
            </span>
          );
        },
      },
      {
        key: "component",
        dataIndex: "componentName",
        title: "Component",
        width: "12%",
        sorter: (callA, callB) =>
          (callA.componentName ?? "").localeCompare(callB.componentName ?? ""),
        render: (_value, call) =>
          call.componentName ? (
            <span
              className="text-[11px] text-text-2"
              title={call.filePath || call.componentName}
            >
              {call.componentName}
              {call.lineNumber ? `:${call.lineNumber}` : ""}
            </span>
          ) : (
            <span className="text-[11px] text-text-4">—</span>
          ),
      },
    ],
    [onToggleExpand]
  );

  const expandable = useMemo(
    () => ({
      expandedRowRender: (call: ApiCall) => (
        <div className="border-t border-border-2 bg-bg-3 px-4 py-3">
          <ApiCallDetails call={call} />
        </div>
      ),
      expandedRowKeys: expandedCall ? [expandedCall] : [],
      onExpandedRowsChange: (keys: string[]) => {
        onExpandedChange(keys[0] ?? null);
      },
    }),
    [expandedCall, onExpandedChange]
  );

  if (apiCalls.length === 0) {
    return <EmptyState />;
  }

  return (
    <Table<ApiCall>
      columns={columns}
      data={apiCalls}
      rowKey="id"
      pagination={false}
      hover
      stripe={false}
      border={false}
      size="small"
      className="!border-0"
      expandable={expandable}
      rowClassName={(call, index) =>
        index === 0 ? "!bg-primary-6/10 hover:!bg-fill-1" : "hover:!bg-fill-1"
      }
    />
  );
};

export default PanelContent;
