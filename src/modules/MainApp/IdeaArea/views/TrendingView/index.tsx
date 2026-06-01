/**
 * TrendingView — top-voted ideas trending this week.
 */
import React, { useMemo, useState } from "react";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import IdeaCard from "../../components/IdeaCard";
import {
  CATEGORY_LABELS,
  type IdeaCategory,
  type IdeaItem,
  TRENDING_IDEAS,
} from "../../demoData";

const ALL_FILTER = "all" as const;
type FilterValue = typeof ALL_FILTER | IdeaCategory;

const FILTER_TABS: { key: FilterValue; label: string }[] = [
  { key: ALL_FILTER, label: "All" },
  { key: "ai", label: CATEGORY_LABELS.ai },
  { key: "dev-tools", label: CATEGORY_LABELS["dev-tools"] },
  { key: "productivity", label: CATEGORY_LABELS.productivity },
  { key: "collaboration", label: CATEGORY_LABELS.collaboration },
];

const TrendingView: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<FilterValue>(ALL_FILTER);

  const filtered = useMemo<IdeaItem[]>(
    () =>
      activeFilter === ALL_FILTER
        ? TRENDING_IDEAS
        : TRENDING_IDEAS.filter((idea) => idea.category === activeFilter),
    [activeFilter]
  );

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={FILTER_TABS}
            activeTab={activeFilter}
            onChange={(tab) => setActiveFilter(tab as FilterValue)}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-3`}
        >
          {filtered.map((idea: IdeaItem) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </ScrollFadeContainer>
    </DetailPanelContainer>
  );
};

export default TrendingView;
