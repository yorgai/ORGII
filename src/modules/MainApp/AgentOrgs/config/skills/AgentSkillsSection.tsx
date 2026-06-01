/**
 * Agent Skills Settings Section — layout shell.
 *
 * Calls useSkills for data, delegates display to AgentSkillsTable.
 * This separation prevents skill-toggle re-renders from causing
 * ScrollPreservation thrash.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import {
  DETAIL_PANEL_TOKENS,
  ScrollPreservation,
} from "@src/modules/shared/layouts/blocks";

import AgentSkillsTable from "./AgentSkillsTable";
import { useSkills } from "./useSkills";

interface AgentSkillsSectionProps {
  headerElement?: React.ReactNode;
  embedded?: boolean;
  /** Workspace path used by the skills loader. */
  workspacePath?: string;
  /**
   * Agent definition ID that owns the disabled-skills list. Pass the
   * builtin ID for OS / SDE detail views, the custom agent's id for
   * the AgentWizard / detail view. When undefined the backend falls
   * back to the workspace-presence heuristic (OS without workspace, SDE
   * with workspace).
   */
  agentId?: string;
}

const AgentSkillsSection: React.FC<AgentSkillsSectionProps> = ({
  headerElement,
  embedded = false,
  workspacePath,
  agentId,
}) => {
  const { t } = useTranslation("settings");
  const { goToIntegrations } = useAppNavigation();
  const { skills, loading, toggleSkill } = useSkills(workspacePath, agentId);
  const [searchQuery, setSearchQuery] = useState("");

  const handleAddSkill = useCallback(() => {
    goToIntegrations({ category: "externalSkillsets", skillsetTab: "skills" });
  }, [goToIntegrations]);

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description?.toLowerCase().includes(query)
    );
  }, [skills, searchQuery]);

  const isFiltered = searchQuery.length > 0;

  const tableBody = (
    <div className="flex flex-col gap-3">
      <AgentSkillsTable
        skills={filteredSkills}
        loading={loading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        toggleSkill={toggleSkill}
        emptyTitle={
          isFiltered
            ? t("common:placeholders.noMatchingResults")
            : t("skills.noSkills")
        }
        emptySubtitle={isFiltered ? undefined : t("skills.noSkillsDesc")}
        onAddSkill={handleAddSkill}
        addSkillLabel={t("skills.addSkill")}
      />
    </div>
  );

  const contentBody = embedded ? (
    tableBody
  ) : (
    <ScrollPreservation className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
      <div className={DETAIL_PANEL_TOKENS.contentWidthWithPaddingNoTop}>
        {tableBody}
      </div>
    </ScrollPreservation>
  );

  if (headerElement) {
    return (
      <>
        {headerElement}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {contentBody}
        </div>
      </>
    );
  }

  return contentBody;
};

export default AgentSkillsSection;
