import { GitCompare } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";

import {
  KANBAN_AUTO_ARCHIVE_TTLS,
  KANBAN_TIME_FILTERS,
  type KanbanAutoArchiveTtl,
  type KanbanTimeFilter,
} from "../../config";

export interface KanbanHeaderTrailingControlsProps {
  worktreeSessionCount: number;
  onCompareWorktrees: () => void;
  autoArchiveTtl: KanbanAutoArchiveTtl;
  onAutoArchiveTtlChange: (ttl: KanbanAutoArchiveTtl) => void;
  timeFilter: KanbanTimeFilter;
  onTimeFilterChange: (filter: KanbanTimeFilter) => void;
}

const KanbanHeaderTrailingControls: React.FC<
  KanbanHeaderTrailingControlsProps
> = ({
  worktreeSessionCount,
  onCompareWorktrees,
  autoArchiveTtl,
  onAutoArchiveTtlChange,
  timeFilter,
  onTimeFilterChange,
}) => {
  const { t } = useTranslation("sessions");

  const timePillTabs: TabPillItem[] = useMemo(
    () =>
      KANBAN_TIME_FILTERS.map((filter) => ({
        key: filter.key,
        label: t(filter.labelKey),
      })),
    [t]
  );

  const autoArchiveOptions = useMemo<SelectOption[]>(
    () =>
      KANBAN_AUTO_ARCHIVE_TTLS.map((ttl) => {
        const label = t(ttl.labelKey);
        return {
          label,
          value: ttl.key,
          triggerLabel: `${t("kanban.autoArchive.label")}: ${label}`,
        };
      }),
    [t]
  );

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-visible">
      {worktreeSessionCount >= 2 && (
        <button
          type="button"
          onClick={onCompareWorktrees}
          title={t("worktreeCompare.buttonTooltip")}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-text-2 transition-colors hover:bg-fill-1 hover:text-text-1"
        >
          <GitCompare size={14} strokeWidth={1.75} />
          <span>{t("worktreeCompare.button")}</span>
        </button>
      )}
      <Select
        value={autoArchiveTtl}
        options={autoArchiveOptions}
        onChange={(value) =>
          onAutoArchiveTtlChange(value as KanbanAutoArchiveTtl)
        }
        size="small"
        radius="lg"
        variant="ghost"
        dropdownAlign="right"
        dropdownWidthMode="min-match"
        className="w-auto text-[12px]"
      />
      <TabPill
        tabs={timePillTabs}
        activeTab={timeFilter}
        onChange={(key) => onTimeFilterChange(key as KanbanTimeFilter)}
        variant="pill"
        fillWidth={false}
        size="small"
      />
    </div>
  );
};

export default KanbanHeaderTrailingControls;
