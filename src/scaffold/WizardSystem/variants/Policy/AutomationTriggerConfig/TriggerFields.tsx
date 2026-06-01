import { Info } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Checkbox from "@src/components/Checkbox";
import Input from "@src/components/Input";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import Tooltip from "@src/components/Tooltip";
import { useTimezoneSelect } from "@src/hooks/geo";
import type {
  AutomationTrigger,
  GitEvent,
  ScheduleFrequency,
  ScheduleMonthlyMode,
  WeekOfMonth,
  Weekday,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  GIT_EVENTS,
  GIT_EVENT_LABELS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_FREQUENCY_LABELS,
  SCHEDULE_MONTHLY_MODES,
  SCHEDULE_MONTHLY_MODE_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  WEEK_OF_MONTH_LABELS,
  WEEK_OF_MONTH_OPTIONS,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import { SECTION_CONTROL_STYLE } from "@src/modules/shared/layouts/SectionLayout";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

import FileWatchPathsTable from "./FileWatchPathsTable";

const TriggerFields: React.FC<{
  trigger: AutomationTrigger;
  onChange: (trigger: AutomationTrigger) => void;
}> = ({ trigger, onChange }) => {
  const { t } = useTranslation("integrations");
  const timezoneSelectProps = useTimezoneSelect({
    value:
      trigger.type === "scheduledTime"
        ? trigger.timezone
        : DEFAULT_SCHEDULE_TIMEZONE,
    onChange: (value) => {
      if (trigger.type === "scheduledTime") {
        onChange({ ...trigger, timezone: value });
      }
    },
    excludeAuto: true,
    style: SECTION_CONTROL_STYLE,
    offsetPrefix: "UTC",
  });

  switch (trigger.type) {
    case "timer":
      return (
        <NumberInput
          value={trigger.intervalSecs}
          min={10}
          step={60}
          suffix="s"
          controlsPosition="sides"
          onChange={(val) => {
            if (val !== undefined) onChange({ ...trigger, intervalSecs: val });
          }}
          style={SECTION_CONTROL_STYLE}
        />
      );

    case "scheduledTime":
      return (
        <div className="flex w-full flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              value={trigger.frequency}
              onChange={(value) =>
                onChange({
                  ...trigger,
                  frequency: value as ScheduleFrequency,
                })
              }
              options={SCHEDULE_FREQUENCIES.map((frequency) => ({
                label: SCHEDULE_FREQUENCY_LABELS[frequency],
                value: frequency,
              }))}
              size="default"
              style={SECTION_CONTROL_STYLE}
              dropdownWidthMode="match"
            />
            <input
              type="time"
              value={trigger.time}
              onChange={(e) => onChange({ ...trigger, time: e.target.value })}
              style={SECTION_CONTROL_STYLE}
              className="h-8 rounded-md border border-border-2 bg-bg-1 px-2 text-sm text-text-1 outline-none"
            />
          </div>
          <CollapsibleSection
            title={t("agentOrgs.scheduleTimezone")}
            defaultOpen={false}
          >
            <div className="flex flex-col gap-2">
              <Select {...timezoneSelectProps} dropdownWidthMode="match" />
              <p className="text-[11px] text-text-3">
                {t("agentOrgs.scheduleTimezoneDesc")}
              </p>
            </div>
          </CollapsibleSection>
          {trigger.frequency === "weekly" && (
            <Checkbox.Group
              value={trigger.daysOfWeek ?? []}
              onChange={(values) =>
                onChange({ ...trigger, daysOfWeek: values as Weekday[] })
              }
              direction="horizontal"
              options={WEEKDAYS.map((weekday) => ({
                label: WEEKDAY_LABELS[weekday],
                value: weekday,
              }))}
            />
          )}
          {trigger.frequency === "monthly" && (
            <div className="flex flex-col gap-3">
              <Select
                value={trigger.monthlyMode ?? "dayOfMonth"}
                onChange={(value) =>
                  onChange({
                    ...trigger,
                    monthlyMode: value as ScheduleMonthlyMode,
                  })
                }
                options={SCHEDULE_MONTHLY_MODES.map((mode) => ({
                  label: SCHEDULE_MONTHLY_MODE_LABELS[mode],
                  value: mode,
                }))}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dropdownWidthMode="match"
              />
              {(trigger.monthlyMode ?? "dayOfMonth") === "dayOfMonth" && (
                <NumberInput
                  value={trigger.dayOfMonth ?? 1}
                  min={1}
                  max={31}
                  step={1}
                  controlsPosition="sides"
                  onChange={(value) =>
                    onChange({ ...trigger, dayOfMonth: value ?? 1 })
                  }
                  style={SECTION_CONTROL_STYLE}
                />
              )}
              {(trigger.monthlyMode ?? "dayOfMonth") === "weekdayOfMonth" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    value={trigger.weekOfMonth ?? "first"}
                    onChange={(value) =>
                      onChange({
                        ...trigger,
                        weekOfMonth: value as WeekOfMonth,
                      })
                    }
                    options={WEEK_OF_MONTH_OPTIONS.map((week) => ({
                      label: WEEK_OF_MONTH_LABELS[week],
                      value: week,
                    }))}
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dropdownWidthMode="match"
                  />
                  <Select
                    value={trigger.weekdayOfMonth ?? "monday"}
                    onChange={(value) =>
                      onChange({
                        ...trigger,
                        weekdayOfMonth: value as Weekday,
                      })
                    }
                    options={WEEKDAYS.map((weekday) => ({
                      label: WEEKDAY_LABELS[weekday],
                      value: weekday,
                    }))}
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dropdownWidthMode="match"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      );

    case "cron":
      return (
        <div className="flex items-center gap-2">
          <Tooltip content={t("agentOrgs.cronHint")} position="left">
            <span className="flex cursor-help items-center p-1">
              <Info size={14} className="text-text-3" />
            </span>
          </Tooltip>
          <Input
            value={trigger.expression}
            onChange={(val) => onChange({ ...trigger, expression: val })}
            placeholder={t("agentOrgs.cronExpression")}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </div>
      );

    case "gitActivity":
      return (
        <Checkbox.Group
          value={trigger.events}
          onChange={(values) =>
            onChange({ ...trigger, events: values as GitEvent[] })
          }
          direction="horizontal"
          options={GIT_EVENTS.map((event) => ({
            label: GIT_EVENT_LABELS[event],
            value: event,
          }))}
        />
      );

    case "channelMessage":
      return (
        <Input
          value={trigger.channel}
          onChange={(val) => onChange({ ...trigger, channel: val })}
          placeholder={t("agentOrgs.channel")}
          size="default"
          style={SECTION_CONTROL_STYLE}
        />
      );

    case "fileWatch":
      return (
        <FileWatchPathsTable
          paths={trigger.paths}
          onChange={(paths) => onChange({ ...trigger, paths })}
        />
      );

    case "webhook":
      return (
        <div className="flex items-center gap-2">
          <Tooltip content={t("agentOrgs.webhookHint")} position="left">
            <span className="flex cursor-help items-center p-1">
              <Info size={14} className="text-text-3" />
            </span>
          </Tooltip>
          <Input
            value={trigger.route}
            onChange={(val) => onChange({ ...trigger, route: val })}
            placeholder={t("agentOrgs.webhookRoute")}
            size="default"
            style={SECTION_CONTROL_STYLE}
          />
        </div>
      );
  }
};

export default TriggerFields;
