/**
 * SourceControlFilterHeader
 *
 * Filter-mode select (Uncommitted / Unstaged / Staged / Branch) + optional
 * refresh button, designed for the Source Control 40px workstation header.
 * Shared Source Control filter header for Diff and Source Control tabs so their
 * tab-specific sidebar gets the same filter UX across every host.
 *
 * Repo-agnostic: all state is owned by the caller (`useSourceControlSidebarModule`).
 */
import {
  Archive,
  Check,
  CircleDot,
  Ellipsis,
  FileDiff,
  GitBranch as GitBranchIcon,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import type { DropdownOption } from "@src/components/Dropdown/types";
import Select from "@src/components/Select";
import { useRefreshSpin } from "@src/hooks/ui";
import { HEADER_ICON_SIZE } from "@src/modules/WorkStation/shared/tokens";

export type SourceControlFilterMode =
  | "uncommitted"
  | "unstaged"
  | "staged"
  | "stashed"
  | "history";

export interface SourceControlFilterCounts {
  uncommitted: number;
  unstaged: number;
  staged: number;
  stashed: number;
}

interface FilterRowEntry {
  id: SourceControlFilterMode;
  labelKey: string;
  icon: LucideIcon;
}

const FILE_FILTER_ROWS: FilterRowEntry[] = [
  {
    id: "uncommitted",
    labelKey: "controlTower.git.filterUncommitted",
    icon: FileDiff,
  },
  {
    id: "unstaged",
    labelKey: "controlTower.git.filterUnstaged",
    icon: CircleDot,
  },
  { id: "staged", labelKey: "controlTower.git.filterStaged", icon: Check },
  {
    id: "stashed",
    labelKey: "controlTower.git.filterStashed",
    icon: Archive,
  },
];

export interface SourceControlFilterHeaderProps {
  /** Active filter mode. */
  mode: SourceControlFilterMode;
  /** Pick a new filter mode. */
  onChangeMode: (mode: SourceControlFilterMode) => void;
  /** Refresh git status. */
  onRefresh: () => void;
  /** Whether refresh is in progress (drives spin animation). */
  refreshLoading?: boolean;
  /** Stable id used to scope the refresh-spin animation. */
  spinScope?: string;
  /** Whether to show the refresh action next to the filter select. */
  showRefresh?: boolean;
  /** Counts shown in the trigger label. */
  counts?: SourceControlFilterCounts;
}

const SourceControlFilterHeader: React.FC<SourceControlFilterHeaderProps> =
  memo(
    ({
      mode,
      onChangeMode,
      onRefresh,
      refreshLoading = false,
      spinScope,
      showRefresh = true,
      counts,
    }) => {
      const { t } = useTranslation("sessions");

      const getModeCount = useCallback(
        (modeId: SourceControlFilterMode) => {
          if (!counts || modeId === "history") return undefined;
          return counts[modeId];
        },
        [counts]
      );

      const getCountLabel = useCallback(
        (count: number, label: string) =>
          t("controlTower.git.filterCountLabel", {
            count,
            label: label.toLowerCase(),
          }),
        [t]
      );

      const options = useMemo<DropdownOption[]>(() => {
        const fileOptions = FILE_FILTER_ROWS.map((row) => {
          const Icon = row.icon;
          const label = t(row.labelKey);
          const count = getModeCount(row.id);
          const triggerLabel =
            typeof count === "number" ? getCountLabel(count, label) : label;
          return {
            value: row.id,
            label: (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Icon size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
                <span>{triggerLabel}</span>
              </span>
            ),
            triggerLabel,
          };
        });

        return [
          ...fileOptions,
          {
            value: "history",
            label: (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <GitBranchIcon
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
                <span>{t("common:labels.gitHistory")}</span>
              </span>
            ),
            triggerLabel: t("common:labels.gitHistory"),
          },
        ];
      }, [getCountLabel, getModeCount, t]);

      const [moreMenuVisible, setMoreMenuVisible] = useState(false);

      const handleSelect = useCallback(
        (nextMode: string | number | (string | number)[]) => {
          if (Array.isArray(nextMode)) return;
          onChangeMode(nextMode as SourceControlFilterMode);
        },
        [onChangeMode]
      );

      const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
        useRefreshSpin(onRefresh, refreshLoading, spinScope);
      const handleRefreshMenuClick = useCallback(() => {
        handleRefreshClick();
        setMoreMenuVisible(false);
      }, [handleRefreshClick]);

      return (
        <div className="flex flex-none items-center gap-1 overflow-visible">
          <Select
            value={mode}
            onChange={handleSelect}
            options={options}
            size="small"
            variant="ghost"
            radius="lg"
            dropdownWidthMode="auto"
            className="w-auto"
          />

          {showRefresh && (
            <Dropdown
              droplist={
                <div className={DROPDOWN_CLASSES.menuPanel}>
                  <button
                    type="button"
                    onClick={handleRefreshMenuClick}
                    className={DROPDOWN_CLASSES.menuActionItem}
                  >
                    <RefreshCw
                      size={HEADER_ICON_SIZE.sm}
                      className={refreshSpinClass}
                    />
                    <span>
                      {t("controlTower.diff.refresh", "Refresh Git status")}
                    </span>
                  </button>
                </div>
              }
              position="bottom-end"
              trigger="click"
              popupVisible={moreMenuVisible}
              onVisibleChange={setMoreMenuVisible}
            >
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                title={t("common:actions.more")}
                className={moreMenuVisible ? "!bg-fill-2 !text-primary-6" : ""}
                icon={
                  <Ellipsis size={HEADER_ICON_SIZE.sm} strokeWidth={1.75} />
                }
              />
            </Dropdown>
          )}
        </div>
      );
    }
  );
SourceControlFilterHeader.displayName = "SourceControlFilterHeader";

export default SourceControlFilterHeader;
