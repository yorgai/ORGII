import { Check } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";

import type { ReplayTab } from "./ReplayTabBar";

export type ReplayEventFilterCategory =
  | "key_interactions"
  | "file_changes"
  | "terminal"
  | "explore"
  | "other";

export const REPLAY_EVENT_FILTER_CATEGORIES: ReplayEventFilterCategory[] = [
  "key_interactions",
  "file_changes",
  "terminal",
  "explore",
  "other",
];

export type ReplayEventFilterSelection = "all" | ReplayEventFilterCategory[];

interface ReplayEventFilterOption {
  value: "all" | ReplayEventFilterCategory;
  labelKey: string;
  fallback: string;
}

const FILTER_OPTIONS: ReplayEventFilterOption[] = [
  {
    value: "all",
    labelKey: "simulator.replay.eventFilters.all",
    fallback: "All events",
  },
  {
    value: "key_interactions",
    labelKey: "simulator.replay.eventFilters.keyInteractions",
    fallback: "Key interactions",
  },
  {
    value: "file_changes",
    labelKey: "simulator.replay.eventFilters.fileChanges",
    fallback: "File changes",
  },
  {
    value: "terminal",
    labelKey: "simulator.replay.eventFilters.terminal",
    fallback: "Terminal events",
  },
  {
    value: "explore",
    labelKey: "simulator.replay.eventFilters.explore",
    fallback: "Explore",
  },
  {
    value: "other",
    labelKey: "simulator.replay.eventFilters.other",
    fallback: "Other",
  },
];

function normalizeSelection(
  selection: ReplayEventFilterSelection
): ReplayEventFilterCategory[] {
  return selection === "all" ? REPLAY_EVENT_FILTER_CATEGORIES : selection;
}

export function getReplayEventFilterCategory(
  tab: Pick<ReplayTab, "kind">
): ReplayEventFilterCategory {
  switch (tab.kind) {
    case "file":
      return "file_changes";
    case "terminal":
      return "terminal";
    case "explore":
    case "web_search":
    case "web_fetch":
      return "explore";
    case "tool":
      return "other";
    default:
      return "key_interactions";
  }
}

export function filterReplayTabsBySelection<
  TTab extends Pick<ReplayTab, "kind">,
>(tabs: readonly TTab[], selection: ReplayEventFilterSelection): TTab[] {
  if (selection === "all") return [...tabs];
  const selected = new Set(selection);
  return tabs.filter((tab) => selected.has(getReplayEventFilterCategory(tab)));
}

interface ReplayEventFilterProps {
  value: ReplayEventFilterSelection;
  onChange: (value: ReplayEventFilterSelection) => void;
}

export const ReplayEventFilter: React.FC<ReplayEventFilterProps> = memo(
  ({ value, onChange }) => {
    const { t } = useTranslation("sessions");
    const [open, setOpen] = useState(false);
    const selectedCategories = useMemo(
      () => normalizeSelection(value),
      [value]
    );
    const selectedSet = useMemo(
      () => new Set(selectedCategories),
      [selectedCategories]
    );

    const labelByValue = useMemo(
      () =>
        new Map(
          FILTER_OPTIONS.map((option) => [
            option.value,
            t(option.labelKey, option.fallback),
          ])
        ),
      [t]
    );

    const triggerLabel = useMemo(() => {
      if (value === "all") return labelByValue.get("all") ?? "All events";
      if (selectedCategories.length === 1) {
        return labelByValue.get(selectedCategories[0]) ?? "Events";
      }
      return t("simulator.replay.eventFilters.selectedCount", {
        count: selectedCategories.length,
        defaultValue: "{{count}} filters",
      });
    }, [labelByValue, selectedCategories, t, value]);

    const handleAllClick = useCallback(() => {
      onChange("all");
    }, [onChange]);

    const handleCategoryClick = useCallback(
      (category: ReplayEventFilterCategory) => {
        const next = selectedSet.has(category)
          ? selectedCategories.filter((item) => item !== category)
          : [...selectedCategories, category];
        onChange(
          next.length === REPLAY_EVENT_FILTER_CATEGORIES.length ? "all" : next
        );
      },
      [onChange, selectedCategories, selectedSet]
    );

    return (
      <Dropdown
        trigger="click"
        position="bottom-end"
        popupVisible={open}
        onVisibleChange={setOpen}
        droplist={
          <div className={`${DROPDOWN_CLASSES.menuPanel} min-w-[180px]`}>
            {FILTER_OPTIONS.map((option) => {
              const categoryValue =
                option.value === "all" ? null : option.value;
              const isSelected = categoryValue
                ? value !== "all" && selectedSet.has(categoryValue)
                : value === "all";
              return (
                <button
                  key={option.value}
                  type="button"
                  className={DROPDOWN_CLASSES.menuActionItem}
                  onClick={() =>
                    categoryValue
                      ? handleCategoryClick(categoryValue)
                      : handleAllClick()
                  }
                  data-testid={`replay-event-filter-${option.value}`}
                >
                  <span className="flex-1 text-left">
                    {labelByValue.get(option.value)}
                  </span>
                  {isSelected ? (
                    <Check size={13} className="text-primary-6" />
                  ) : null}
                </button>
              );
            })}
          </div>
        }
      >
        <Button
          htmlType="button"
          variant="tertiary"
          size="small"
          className={open ? "!bg-fill-2 !text-primary-6" : ""}
          data-testid="replay-event-filter-trigger"
        >
          {triggerLabel}
        </Button>
      </Dropdown>
    );
  }
);

ReplayEventFilter.displayName = "ReplayEventFilter";
