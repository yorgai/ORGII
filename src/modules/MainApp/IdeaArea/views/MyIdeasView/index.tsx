/**
 * MyIdeasView — the user's own submitted ideas.
 */
import { Plus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InternalHeader,
  ScrollFadeContainer,
} from "@src/modules/shared/layouts/blocks";

import IdeaCard from "../../components/IdeaCard";
import { type IdeaItem, MY_IDEAS } from "../../demoData";

const MyIdeasView: React.FC = () => {
  const { t } = useTranslation();

  return (
    <DetailPanelContainer>
      <InternalHeader
        noPanelHeader
        contentPadding
        className={DETAIL_PANEL_TOKENS.headerWidth}
        tabs={
          <TabPill
            tabs={[{ key: "my-ideas", label: t("ideaArea.myIdeas.title") }]}
            activeTab="my-ideas"
            onChange={() => {}}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
        actions={
          <button className="flex items-center gap-1.5 rounded-lg bg-primary-6 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-primary-5">
            <Plus size={13} />
            {t("ideaArea.myIdeas.newIdea")}
          </button>
        }
      />

      <ScrollFadeContainer className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        <div
          className={`${DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop} flex flex-col gap-3`}
        >
          {MY_IDEAS.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-[13px] text-text-2">
                {t("ideaArea.myIdeas.empty")}
              </p>
              <button className="flex items-center gap-1.5 rounded-lg bg-primary-6 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-5">
                <Plus size={14} />
                {t("ideaArea.myIdeas.newIdea")}
              </button>
            </div>
          ) : (
            MY_IDEAS.map((idea: IdeaItem) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))
          )}
        </div>
      </ScrollFadeContainer>
    </DetailPanelContainer>
  );
};

export default MyIdeasView;
