import { FolderOpen, Pencil, Trash2, Zap } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Markdown from "@src/components/MarkDown";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import Switch from "@src/components/Switch";
import type { PolicyInfo, PolicySource } from "@src/hooks/policies";
import {
  CollapsibleTableSection,
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PanelHeader,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import { TRIGGER_CONFIG } from "../config";
import type { AutomationRule } from "../types";

interface PolicyGroupTableProps {
  selectedGroupLabel: string;
  selectedGroupRules: PolicyInfo[];
  selectedGroupAutomationRules: AutomationRule[];
  readRule: (
    name: string,
    source: PolicySource,
    overridePath?: string
  ) => Promise<string>;
  onMarkdownRuleToggle: (ruleName: string, enabled: boolean) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onEditGroupMarkdownRule: (rule: PolicyInfo) => void;
  onDeleteGroupMarkdownRule: (rule: PolicyInfo) => void;
  onEditGroupAutomationRule: (rule: AutomationRule) => void;
  onDeleteGroupAutomationRule: (rule: AutomationRule) => void;
}

const PolicyGroupTable: React.FC<PolicyGroupTableProps> = ({
  selectedGroupLabel,
  selectedGroupRules,
  selectedGroupAutomationRules,
  readRule,
  onMarkdownRuleToggle,
  onToggleEnabled,
  onEditGroupMarkdownRule,
  onDeleteGroupMarkdownRule,
  onEditGroupAutomationRule,
  onDeleteGroupAutomationRule,
}) => {
  const { t } = useTranslation("integrations");

  const [expandedState, setExpandedState] = useState<{
    groupLabel: string | null;
    contents: Record<string, string>;
  }>({ groupLabel: null, contents: {} });

  const expandedContents = useMemo(
    () =>
      expandedState.groupLabel === selectedGroupLabel
        ? expandedState.contents
        : {},
    [expandedState, selectedGroupLabel]
  );

  const loadRuleContent = useCallback(
    (rule: PolicyInfo) => {
      const key = `${rule.source}:${rule.name}`;
      if (expandedContents[key] !== undefined) return;
      readRule(rule.name, rule.source, rule.repoPath)
        .then((content) => {
          setExpandedState((prev) => ({
            groupLabel: selectedGroupLabel,
            contents: { ...prev.contents, [key]: content },
          }));
        })
        .catch(() => {
          setExpandedState((prev) => ({
            groupLabel: selectedGroupLabel,
            contents: { ...prev.contents, [key]: "" },
          }));
        });
    },
    [expandedContents, readRule, selectedGroupLabel]
  );

  const groupRuleColumns = useMemo<SettingsTableColumn<PolicyInfo>[]>(
    () => [
      {
        key: "name",
        label: t("agentOrgs.ruleKinds.rule"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (ruleA, ruleB) => ruleA.name.localeCompare(ruleB.name),
        renderCell: (rule) => (
          <span
            className={`${SETTINGS_TABLE_CELL.primary} min-w-0 truncate font-bold`}
          >
            {rule.name}
          </span>
        ),
      },
      {
        key: "actions",
        label: "",
        width: "140px",
        align: "right",
        renderCell: (rule) => (
          <div className="flex items-center justify-end gap-2">
            <Switch
              size="small"
              checked={rule.enabled}
              onChange={(enabled: boolean) => {
                onMarkdownRuleToggle(rule.name, enabled);
              }}
            />
            <Button
              size="small"
              icon={<Pencil size={14} />}
              iconOnly
              onClick={(event) => {
                event.stopPropagation();
                onEditGroupMarkdownRule(rule);
              }}
            />
            <Button
              size="small"
              icon={<Trash2 size={14} />}
              iconOnly
              onClick={(event) => {
                event.stopPropagation();
                onDeleteGroupMarkdownRule(rule);
              }}
            />
          </div>
        ),
      },
    ],
    [
      t,
      onMarkdownRuleToggle,
      onEditGroupMarkdownRule,
      onDeleteGroupMarkdownRule,
    ]
  );

  const groupAutomationColumns = useMemo<SettingsTableColumn<AutomationRule>[]>(
    () => [
      {
        key: "name",
        label: t("agentOrgs.ruleKinds.automation"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (ruleA, ruleB) => ruleA.name.localeCompare(ruleB.name),
        renderCell: (rule) => (
          <span className={`${SETTINGS_TABLE_CELL.primary} truncate font-bold`}>
            {rule.name}
          </span>
        ),
      },
      {
        key: "trigger",
        label: t("agentOrgs.trigger"),
        width: SETTINGS_TABLE_COL.valueSm,
        sorter: (ruleA, ruleB) =>
          (
            TRIGGER_CONFIG[ruleA.trigger.type]?.label ?? ruleA.trigger.type
          ).localeCompare(
            TRIGGER_CONFIG[ruleB.trigger.type]?.label ?? ruleB.trigger.type
          ),
        renderCell: (rule) => (
          <span className={SETTINGS_TABLE_CELL.muted}>
            {TRIGGER_CONFIG[rule.trigger.type]?.label ?? rule.trigger.type}
          </span>
        ),
      },
      {
        key: "actions",
        label: "",
        width: "140px",
        align: "right",
        renderCell: (rule) => (
          <div className="flex items-center justify-end gap-2">
            <Switch
              size="small"
              checked={rule.enabled}
              onChange={(enabled: boolean) => {
                onToggleEnabled(enabled);
              }}
            />
            <Button
              size="small"
              icon={<Pencil size={14} />}
              iconOnly
              onClick={(event) => {
                event.stopPropagation();
                onEditGroupAutomationRule(rule);
              }}
            />
            <Button
              size="small"
              icon={<Trash2 size={14} />}
              iconOnly
              onClick={(event) => {
                event.stopPropagation();
                onDeleteGroupAutomationRule(rule);
              }}
            />
          </div>
        ),
      },
    ],
    [t, onToggleEnabled, onEditGroupAutomationRule, onDeleteGroupAutomationRule]
  );

  return (
    <DetailPanelContainer>
      <PanelHeader
        iconElement={<FolderOpen size={14} className="text-primary-6" />}
        breadcrumb={{
          parent: t("agentOrgs.tabs.rules"),
          current: selectedGroupLabel,
        }}
      />
      <div
        className={`${DETAIL_PANEL_TOKENS.scrollContent} scrollbar-gutter-stable overflow-x-hidden`}
      >
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPadding}>
          {selectedGroupRules.length > 0 && (
            <CollapsibleTableSection
              noWrapper
              title={t("agentOrgs.ruleKinds.rule")}
              overflowHidden
            >
              <SettingsTable<PolicyInfo>
                hover
                columns={groupRuleColumns}
                rows={selectedGroupRules}
                getRowKey={(rule) => `${rule.source}:${rule.name}`}
                headerHeight="tall"
                expandable={{
                  expandedRowRender: (rule) => {
                    const key = `${rule.source}:${rule.name}`;
                    const content = expandedContents[key];
                    if (content === undefined) {
                      loadRuleContent(rule);
                      return (
                        <div className="max-h-[400px] rounded-lg bg-bg-2 p-4">
                          <Placeholder variant="loading" placement="sidebar" />
                        </div>
                      );
                    }
                    return (
                      <div className="scrollbar-overlay scrollbar-gutter-stable max-h-[400px] min-w-0 overflow-x-auto overflow-y-auto rounded-lg bg-bg-2 p-4">
                        {content.trim() ? (
                          <Markdown textContent={content} skipPreprocess />
                        ) : (
                          <span className="text-[13px] text-text-3">
                            {t("agentOrgs.noMarkdownContent")}
                          </span>
                        )}
                      </div>
                    );
                  },
                }}
              />
            </CollapsibleTableSection>
          )}

          {selectedGroupAutomationRules.length > 0 && (
            <CollapsibleTableSection
              noWrapper
              title={t("agentOrgs.ruleKinds.automation")}
              overflowHidden
            >
              <SettingsTable<AutomationRule>
                hover
                columns={groupAutomationColumns}
                rows={selectedGroupAutomationRules}
                getRowKey={(rule) => rule.id}
                headerHeight="tall"
                expandable={{
                  expandedRowRender: (rule) => (
                    <div className="rounded-lg border border-border-2 bg-bg-1 p-4">
                      <div className="mb-3 flex items-center gap-3">
                        <Zap size={14} className="text-primary-6" />
                        <div>
                          <h3 className="text-[14px] font-semibold text-text-1">
                            {rule.name}
                          </h3>
                          <span className="text-[12px] text-text-3">
                            {TRIGGER_CONFIG[rule.trigger.type]?.label ??
                              rule.trigger.type}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
                        <div className="rounded-md bg-fill-2 px-3 py-2">
                          <div className="text-[12px] text-text-3">
                            {t("agentOrgs.overview.actions")}
                          </div>
                          <div className="mt-0.5 text-[12px] font-semibold text-text-1">
                            {rule.actions.length}
                          </div>
                        </div>
                        {rule.cooldownSecs != null && (
                          <div className="rounded-md bg-fill-2 px-3 py-2">
                            <div className="text-[12px] text-text-3">
                              {t("agentOrgs.cooldown")}
                            </div>
                            <div className="mt-0.5 text-[12px] font-semibold text-text-1">
                              {rule.cooldownSecs}s
                            </div>
                          </div>
                        )}
                        {rule.maxFires != null && (
                          <div className="rounded-md bg-fill-2 px-3 py-2">
                            <div className="text-[12px] text-text-3">
                              {t("agentOrgs.overview.maxFires")}
                            </div>
                            <div className="mt-0.5 text-[12px] font-semibold text-text-1">
                              {rule.maxFires}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                }}
              />
            </CollapsibleTableSection>
          )}
        </div>
      </div>
    </DetailPanelContainer>
  );
};

export default PolicyGroupTable;
