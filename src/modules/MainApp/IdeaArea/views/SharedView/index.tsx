/**
 * SharedView — ideas shared by the community.
 */
import { Search } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  Placeholder,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import IdeaCard from "../../components/IdeaCard";
import { type IdeaItem, SHARED_IDEAS } from "../../demoData";

const SharedView: React.FC = () => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = useMemo<IdeaItem[]>(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return SHARED_IDEAS;
    return SHARED_IDEAS.filter(
      (idea) =>
        idea.title.toLowerCase().includes(lower) ||
        idea.description.toLowerCase().includes(lower) ||
        idea.tags.some((tag) => tag.includes(lower))
    );
  }, [query]);

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={[{ key: "shared", label: t("ideaArea.shared.title") }]}
            activeTab="shared"
            onChange={() => {}}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border-1 bg-fill-1 px-2.5 py-1.5 focus-within:border-border-2">
            <Search size={12} className="shrink-0 text-text-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ideaArea.shared.searchPlaceholder")}
              className="w-36 bg-transparent text-[12px] text-text-1 placeholder:text-text-3 focus:outline-none"
            />
          </div>
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-3`}
        >
          {filtered.length === 0 ? (
            <Placeholder
              variant="no-results"
              placement="detail-panel"
              title={t("ideaArea.shared.noResults")}
            />
          ) : (
            filtered.map((idea: IdeaItem) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))
          )}
        </div>
      </ScrollFadeContainer>
    </DetailPanelContainer>
  );
};

export default SharedView;
