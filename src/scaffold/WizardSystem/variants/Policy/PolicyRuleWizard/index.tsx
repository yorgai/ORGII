/**
 * PolicyRuleWizard — Wizard for adding/editing markdown rules.
 *
 * Handles create/edit for markdown rules.
 * Automation rules are handled by AutomationWizard.
 */
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { SECTION_GAP_CLASSES } from "@src/modules/shared/layouts/SectionLayout";
import {
  WizardShell,
  WizardStepLayout,
} from "@src/scaffold/WizardSystem/primitives";

import MarkdownRuleForm from "./MarkdownRuleForm";
import { type PolicyRuleWizardProps, defaultMarkdownRuleState } from "./types";

const PolicyRuleWizard: React.FC<PolicyRuleWizardProps> = ({
  markdownRule,
  agents: agentDefs = [],
  onSaveMarkdownRule,
  onCancel,
  cursorRepos = [],
}) => {
  const { t } = useTranslation("integrations");

  const isEditing = !!markdownRule;

  const [mdState, setMdState] = useState(() =>
    defaultMarkdownRuleState(markdownRule, "global", cursorRepos)
  );

  const canSaveMarkdown =
    mdState.name.trim().length > 0 &&
    (mdState.source !== "workspace" || !!mdState.repoId);

  const handleSaveMarkdownRule = useCallback(() => {
    if (!canSaveMarkdown) return;
    onSaveMarkdownRule({
      name: mdState.name.trim(),
      content: mdState.content,
      source: mdState.source,
      agents: mdState.agentIds,
      isNew: !markdownRule,
      scopeMode: mdState.scopeMode,
      scopeRepoIds:
        mdState.scopeMode === "specific" ? mdState.scopeRepoIds : undefined,
      repoPath:
        mdState.source === "workspace"
          ? (mdState.repoId ?? undefined)
          : undefined,
    });
  }, [canSaveMarkdown, markdownRule, mdState, onSaveMarkdownRule]);

  const wizardTitle = isEditing
    ? t("agentOrgs.editRule")
    : t("agentOrgs.addRule");

  const stepActions = (
    <>
      <Button variant="secondary" size="small" onClick={onCancel}>
        {t("common:actions.cancel")}
      </Button>
      <Button
        variant="primary"
        size="small"
        disabled={!canSaveMarkdown}
        onClick={handleSaveMarkdownRule}
      >
        {isEditing ? t("common:actions.save") : t("common:actions.done")}
      </Button>
    </>
  );

  return (
    <WizardShell title={wizardTitle} onCancel={onCancel}>
      <WizardStepLayout currentStep={1} totalSteps={1} actions={stepActions}>
        <div className={SECTION_GAP_CLASSES}>
          <MarkdownRuleForm
            state={mdState}
            onChange={setMdState}
            agents={agentDefs}
            cursorRepos={cursorRepos}
            isEditing={isEditing}
          />
        </div>
      </WizardStepLayout>
    </WizardShell>
  );
};

export default PolicyRuleWizard;
