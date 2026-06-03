import { ArrowDown, ArrowUp } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import {
  CollapsibleSection,
  DETAIL_PANEL_TOKENS,
  InternalHeader,
} from "@src/modules/shared/layouts/blocks";

import { CHANGELOG_MONTHS } from "./changelogData";
import type { ChangelogDay, ChangelogMonth } from "./types";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatMonth(month: ChangelogMonth): string {
  const [yearText, monthText] = month.month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const monthLabel = MONTH_LABELS[monthIndex] ?? month.month;

  return `${monthLabel} ${year}`;
}

interface DayCardProps {
  day: ChangelogDay;
  isLast: boolean;
}

const DayCard: React.FC<DayCardProps> = ({ day, isLast }) => {
  const { t } = useTranslation("navigation");
  const frontendChangeBullets = day.frontendChangeBullets;
  const backendChangeBullets = day.backendChangeBullets;

  return (
    <article className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
      <div className="relative flex justify-center">
        {!isLast && (
          <span className="absolute bottom-[-1.25rem] top-4 w-px bg-border-2" />
        )}
        <span className="relative mt-1.5 h-2.5 w-2.5 rounded-full bg-primary-6 ring-4 ring-bg-1" />
      </div>
      <div className="min-w-0 pb-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[13px] font-semibold text-text-1">
            {day.date}
          </span>
          <span className="text-text-3">·</span>
          <span className="text-[13px] font-semibold text-text-2">
            {t("changelog.commitCount", { count: day.commitCount })}
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-text-2">{day.summary}</p>
        {day.modelsUsed.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {day.modelsUsed.map((modelName) => (
              <span
                key={modelName}
                className="inline-flex items-center gap-1.5 rounded-full py-1 text-[12px] font-medium text-text-2"
              >
                <ModelIcon modelName={modelName} size={14} />
                {modelName}
              </span>
            ))}
          </div>
        )}
        {(frontendChangeBullets.length > 0 ||
          backendChangeBullets.length > 0) && (
          <CollapsibleSection
            title={t("changelog.details")}
            defaultOpen={false}
            compact
            className="mt-4"
            headerRowClassName="mb-2 h-5"
            titleButtonClassName="text-[12px]"
            chevronSize={12}
          >
            <div className="space-y-2 text-[12px] leading-5 text-text-2">
              {frontendChangeBullets.length > 0 && (
                <section>
                  <h3 className="mb-1.5 font-semibold text-text-1">
                    {t("changelog.frontend")}
                  </h3>
                  <ul className="space-y-1.5 pl-5">
                    {frontendChangeBullets.map((changeBullet) => (
                      <li key={changeBullet} className="list-disc">
                        {changeBullet}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {backendChangeBullets.length > 0 && (
                <section>
                  <h3 className="mb-1.5 font-semibold text-text-1">
                    {t("changelog.backend")}
                  </h3>
                  <ul className="space-y-1.5 pl-5">
                    {backendChangeBullets.map((changeBullet) => (
                      <li key={changeBullet} className="list-disc">
                        {changeBullet}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </article>
  );
};

const ChangelogPage: React.FC = () => {
  const { t } = useTranslation("common");
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);

  const selectedMonth =
    CHANGELOG_MONTHS[selectedMonthIndex] ?? CHANGELOG_MONTHS[0];
  const canShowNewerMonth = selectedMonthIndex > 0;
  const canShowOlderMonth = selectedMonthIndex < CHANGELOG_MONTHS.length - 1;

  const selectedDays = useMemo(
    () =>
      [...selectedMonth.days].sort((left, right) =>
        right.date.localeCompare(left.date)
      ),
    [selectedMonth]
  );

  const showOlderMonth = () => {
    setSelectedMonthIndex((current) =>
      Math.min(current + 1, CHANGELOG_MONTHS.length - 1)
    );
  };

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden">
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <div className="relative flex h-7 w-full items-center justify-center">
            <h2 className="truncate text-center text-base font-semibold text-text-1">
              {formatMonth(selectedMonth)}
            </h2>
            <div className="absolute right-0 flex items-center gap-1">
              <Button
                htmlType="button"
                variant="tertiary"
                size="mini"
                shape="circle"
                iconOnly
                disabled={!canShowNewerMonth}
                icon={<ArrowUp size={14} />}
                onClick={() =>
                  setSelectedMonthIndex((current) => Math.max(current - 1, 0))
                }
              />
              <Button
                htmlType="button"
                variant="tertiary"
                size="mini"
                shape="circle"
                iconOnly
                disabled={!canShowOlderMonth}
                icon={<ArrowDown size={14} />}
                onClick={showOlderMonth}
              />
            </div>
          </div>
        }
      />
      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
          <section>
            {selectedDays.map((day, dayIndex) => (
              <DayCard
                key={day.date}
                day={day}
                isLast={dayIndex === selectedDays.length - 1}
              />
            ))}
            {canShowOlderMonth && (
              <div className="flex justify-center pt-2">
                <Button
                  htmlType="button"
                  variant="tertiary"
                  size="small"
                  onClick={showOlderMonth}
                >
                  {t("actions.loadMore")}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ChangelogPage;
