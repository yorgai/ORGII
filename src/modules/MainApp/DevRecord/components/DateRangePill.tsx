/**
 * DateRangePill — Short preset pills + a "More" dropdown for extended ranges.
 *
 * Pills: 24h, 3d, 1w, 1m (inline)
 * More (...): dropdown with 3m, 6m, 1y, Custom items.
 *             Range picker only appears when Custom is the active selection.
 *
 * When a dropdown option is active, the "..." pill shows the selected label.
 */
import { Ellipsis } from "lucide-react";
import React, { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import DatePicker from "@src/components/DatePicker";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import type { TabPillItem } from "@src/components/TabPill";
import TabPill from "@src/components/TabPill";

export interface DateRangePillOption {
  key: string;
  label: string;
}

interface DateRangePillProps {
  options: readonly DateRangePillOption[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Called when custom dates are picked. Both dates are ISO strings (YYYY-MM-DD). */
  onCustomDatesChange?: (startDate: string, endDate: string) => void;
  /** Current custom start date (ISO string) */
  customStartDate?: string;
  /** Current custom end date (ISO string) */
  customEndDate?: string;
}

/** Keys that go into the dropdown instead of inline pills */
const DROPDOWN_KEYS = new Set(["3m", "6m", "1y", "custom"]);

/** Format a date string as "MMM D" */
function fmtShort(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DateRangePill: React.FC<DateRangePillProps> = ({
  options,
  activeKey,
  onChange,
  onCustomDatesChange,
  customStartDate,
  customEndDate,
}) => {
  const { t } = useTranslation();
  const closeRef = useRef<(() => void) | null>(null);

  // Split options into inline pills vs dropdown items
  const inlineOptions = useMemo(
    () => options.filter((opt) => !DROPDOWN_KEYS.has(opt.key)),
    [options]
  );
  const dropdownOptions = useMemo(
    () => options.filter((opt) => DROPDOWN_KEYS.has(opt.key)),
    [options]
  );

  const handleStartChange = useCallback(
    (date: Date | null) => {
      const startStr = date ? date.toISOString().slice(0, 10) : "";
      const endStr = customEndDate ?? "";
      // Enforce end >= start: if new start > end, use start for both
      const effectiveEnd =
        startStr && endStr && startStr > endStr ? startStr : endStr;
      if (startStr && effectiveEnd) {
        onChange("custom");
        onCustomDatesChange?.(startStr, effectiveEnd);
      } else if (startStr) {
        onChange("custom");
        onCustomDatesChange?.(startStr, startStr);
      }
    },
    [onChange, onCustomDatesChange, customEndDate]
  );

  const handleEndChange = useCallback(
    (date: Date | null) => {
      const endStr = date ? date.toISOString().slice(0, 10) : "";
      const startStr = customStartDate ?? "";
      // Enforce end >= start: if new end < start, use end for both
      const effectiveStart =
        startStr && endStr && endStr < startStr ? endStr : startStr;
      if (effectiveStart && endStr) {
        onChange("custom");
        onCustomDatesChange?.(effectiveStart, endStr);
      } else if (endStr) {
        onChange("custom");
        onCustomDatesChange?.(endStr, endStr);
      }
    },
    [onChange, onCustomDatesChange, customStartDate]
  );

  const startValue = useMemo(
    () => (customStartDate ? new Date(customStartDate) : null),
    [customStartDate]
  );
  const endValue = useMemo(
    () => (customEndDate ? new Date(customEndDate) : null),
    [customEndDate]
  );

  const handleDropdownItemClick = useCallback(
    (key: string) => {
      if (key === "custom") {
        onChange("custom");
        return;
      }
      onChange(key);
      closeRef.current?.();
    },
    [onChange]
  );

  const isCustomActive = activeKey === "custom";

  // Build dropdown content: 3m / 6m / 1y / Custom — same structure as Select (timezone picker)
  const dropdownContent = useMemo(
    () => (
      <div style={{ minWidth: 180 }}>
        <div className={DROPDOWN_CLASSES.optionsContainer}>
          {dropdownOptions.map((opt) => {
            const isSelected = activeKey === opt.key;
            return (
              <div
                key={opt.key}
                role="option"
                aria-selected={isSelected}
                className={[
                  DROPDOWN_CLASSES.item,
                  DROPDOWN_CLASSES.itemHover,
                  isSelected && DROPDOWN_CLASSES.itemSelected,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => handleDropdownItemClick(opt.key)}
              >
                <span
                  className={`flex-1 ${isSelected ? "text-primary-6" : "text-text-1"}`}
                >
                  {opt.key === "custom" ? t("devRecord.custom") : opt.label}
                </span>
                {isSelected && <DropdownSelectedCheck />}
              </div>
            );
          })}
        </div>
        {isCustomActive && (
          <div className="flex flex-col gap-1 px-2 pb-2 pt-1">
            <DatePicker
              value={startValue}
              onChange={handleStartChange}
              placeholder={t("devRecord.startDate")}
              size="small"
              allowClear={false}
              max={customEndDate ?? undefined}
            />
            <DatePicker
              value={endValue}
              onChange={handleEndChange}
              placeholder={t("devRecord.endDate")}
              size="small"
              allowClear={false}
              min={customStartDate ?? undefined}
            />
          </div>
        )}
      </div>
    ),
    [
      dropdownOptions,
      activeKey,
      isCustomActive,
      startValue,
      endValue,
      handleStartChange,
      handleEndChange,
      handleDropdownItemClick,
      t,
      customStartDate,
      customEndDate,
    ]
  );

  // Determine the "more" pill label
  const isDropdownKeyActive = DROPDOWN_KEYS.has(activeKey);
  const hasCustomDates = isCustomActive && customStartDate && customEndDate;

  const moreLabel = useMemo(() => {
    if (hasCustomDates) {
      return `${fmtShort(customStartDate)} – ${fmtShort(customEndDate)}`;
    }
    if (isDropdownKeyActive && !isCustomActive) {
      const match = dropdownOptions.find((opt) => opt.key === activeKey);
      return match?.label ?? activeKey;
    }
    return "";
  }, [
    hasCustomDates,
    isDropdownKeyActive,
    isCustomActive,
    activeKey,
    customStartDate,
    customEndDate,
    dropdownOptions,
  ]);

  // Build tab items: inline pills + "more" pill
  const tabItems = useMemo<TabPillItem[]>(() => {
    const items: TabPillItem[] = inlineOptions.map((opt) => ({
      key: opt.key,
      label: opt.label,
    }));

    items.push({
      key: "__more__",
      label: moreLabel,
      icon: !moreLabel ? <Ellipsis size={DROPDOWN_ITEM.iconSize} /> : undefined,
      dropdown: dropdownContent,
    });

    return items;
  }, [inlineOptions, moreLabel, dropdownContent]);

  const handleDropdownRef = useCallback((close: () => void) => {
    closeRef.current = close;
  }, []);

  const effectiveActiveTab = isDropdownKeyActive ? "__more__" : activeKey;

  const handleChange = useCallback(
    (key: string) => {
      if (key === "__more__") return;
      onChange(key);
    },
    [onChange]
  );

  return (
    <TabPill
      tabs={tabItems}
      activeTab={effectiveActiveTab}
      onChange={handleChange}
      variant="pill"
      fillWidth={false}
      size="small"
      onDropdownRef={handleDropdownRef}
    />
  );
};

export default memo(DateRangePill);
