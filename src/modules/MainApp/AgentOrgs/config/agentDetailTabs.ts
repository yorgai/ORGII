/**
 * agentDetailTabs — Single source of truth for the per-agent detail
 * tab list and order across OS / SDE / Wingman / Custom agents.
 *
 * The canonical order is the user's mental model of an agent: identity
 * (General), brain (Models), composition (Subagents), then the
 * resource buckets (Tools, Skills/MCPs/Plugins, Rules). Agent-specific extras
 * (Wingman: Cursor Style + Desktop Safety) come after the canonical tabs.
 * Memory & Evolution settings live in the top-level
 * Rules / Memory / Evolution page.
 *
 * To add or hide a tab for one agent kind, update `AGENT_KIND_TABS`
 * — never duplicate the canonical list inline. The detail views
 * (`AgentOSConfigSection`, `AgentSdeConfigSection`,
 * `CustomAgentDetailView`, `WingmanDetailView`) read from this module.
 *
 * CLI agents do not use this module — their tab list ("Core | Config")
 * is fundamentally different and lives in `CliAgentDetailView`.
 */
import type { TFunction } from "i18next";

import type { TabPillItem } from "@src/components/TabPill";

/** Canonical tab keys in canonical order. */
export const AGENT_DETAIL_TAB_KEY = {
  GENERAL: "general",
  MODELS: "models",
  SUBAGENTS: "subagents",
  TOOLS: "tools",
  SKILLSETS: "skillsets",
  RULES: "rules",
} as const;

export type AgentDetailTabKey =
  (typeof AGENT_DETAIL_TAB_KEY)[keyof typeof AGENT_DETAIL_TAB_KEY];

/** Canonical order (left → right). */
export const CANONICAL_TAB_ORDER: AgentDetailTabKey[] = [
  AGENT_DETAIL_TAB_KEY.GENERAL,
  AGENT_DETAIL_TAB_KEY.MODELS,
  AGENT_DETAIL_TAB_KEY.SUBAGENTS,
  AGENT_DETAIL_TAB_KEY.TOOLS,
  AGENT_DETAIL_TAB_KEY.SKILLSETS,
  AGENT_DETAIL_TAB_KEY.RULES,
];

/**
 * Built-in agent kinds that share the per-agent tab system.
 * (CLI agents use their own simpler "Core | Config" layout.)
 */
export type AgentDetailKind = "os" | "sde" | "wingman" | "custom";

/**
 * Per-kind allowed tabs. Order is enforced by `CANONICAL_TAB_ORDER`,
 * not by the order of entries in this set.
 *
 * - OS: canonical tabs
 * - SDE: canonical tabs
 * - Custom: canonical tabs
 * - Wingman: canonical tabs + Cursor Style + Desktop Safety extras
 */
const AGENT_KIND_TABS: Record<AgentDetailKind, Set<AgentDetailTabKey>> = {
  os: new Set<AgentDetailTabKey>([
    AGENT_DETAIL_TAB_KEY.GENERAL,
    AGENT_DETAIL_TAB_KEY.MODELS,
    AGENT_DETAIL_TAB_KEY.SUBAGENTS,
    AGENT_DETAIL_TAB_KEY.TOOLS,
    AGENT_DETAIL_TAB_KEY.SKILLSETS,
    AGENT_DETAIL_TAB_KEY.RULES,
  ]),
  sde: new Set<AgentDetailTabKey>([
    AGENT_DETAIL_TAB_KEY.GENERAL,
    AGENT_DETAIL_TAB_KEY.MODELS,
    AGENT_DETAIL_TAB_KEY.SUBAGENTS,
    AGENT_DETAIL_TAB_KEY.TOOLS,
    AGENT_DETAIL_TAB_KEY.SKILLSETS,
    AGENT_DETAIL_TAB_KEY.RULES,
  ]),
  wingman: new Set<AgentDetailTabKey>([
    AGENT_DETAIL_TAB_KEY.GENERAL,
    AGENT_DETAIL_TAB_KEY.MODELS,
    AGENT_DETAIL_TAB_KEY.SUBAGENTS,
    AGENT_DETAIL_TAB_KEY.TOOLS,
    AGENT_DETAIL_TAB_KEY.SKILLSETS,
    AGENT_DETAIL_TAB_KEY.RULES,
  ]),
  custom: new Set<AgentDetailTabKey>([
    AGENT_DETAIL_TAB_KEY.GENERAL,
    AGENT_DETAIL_TAB_KEY.MODELS,
    AGENT_DETAIL_TAB_KEY.SUBAGENTS,
    AGENT_DETAIL_TAB_KEY.TOOLS,
    AGENT_DETAIL_TAB_KEY.SKILLSETS,
    AGENT_DETAIL_TAB_KEY.RULES,
  ]),
};

/** Extras shown only for one kind after the canonical tabs. */
const AGENT_KIND_EXTRAS_AFTER_CANONICAL: Record<
  AgentDetailKind,
  AgentDetailTabKey[]
> = {
  os: [],
  sde: [],
  wingman: [],
  custom: [],
};

/**
 * Tabs that need the "full-height" scroll layout (their content owns
 * its own scroll container instead of inheriting the section gap+pad
 * layout). Same set across all kinds for consistency.
 */
export const FULL_HEIGHT_TABS: ReadonlySet<AgentDetailTabKey> = new Set([
  AGENT_DETAIL_TAB_KEY.TOOLS,
  AGENT_DETAIL_TAB_KEY.SKILLSETS,
]);

/**
 * Canonical i18n labels for each tab. Every tab now resolves to a key
 * under `sharedAgentConfig.*` (or the cross-namespace `common:`/
 * `integrations:` namespaces for tabs that genuinely share a concept
 * with other surfaces). No `defaultValue` fallbacks — each label is a
 * single i18n key that exists in all 13 locales.
 */
function tabLabel(
  key: AgentDetailTabKey,
  tSettings: TFunction,
  tIntegrations: TFunction
): string {
  switch (key) {
    case AGENT_DETAIL_TAB_KEY.GENERAL:
      return tSettings("sharedAgentConfig.generalTitle");
    case AGENT_DETAIL_TAB_KEY.MODELS:
      return tSettings("sharedAgentConfig.modelsTitle");
    case AGENT_DETAIL_TAB_KEY.SUBAGENTS:
      return tIntegrations("agentOrgs.agentWizard.subAgentsTab");
    case AGENT_DETAIL_TAB_KEY.TOOLS:
      return tIntegrations("categories.tools");
    case AGENT_DETAIL_TAB_KEY.SKILLSETS:
      return tIntegrations("categories.externalSkillsets");
    case AGENT_DETAIL_TAB_KEY.RULES:
      return tSettings("sharedAgentConfig.resourceTabs.rules");
  }
}

/** Caller-supplied extra tab (e.g. Wingman's Cursor Style / Desktop Safety). */
export interface AgentDetailExtraTab {
  key: string;
  label: string;
}

/**
 * Build the per-agent tab list in canonical order.
 *
 * @param kind The agent kind (os | sde | wingman | custom).
 * @param tSettings i18n `t` for the `settings` namespace.
 * @param tIntegrations i18n `t` for the `integrations` namespace.
 * @param extras Optional caller-appended tabs rendered after any kind extras.
 */
export function getAgentDetailTabs(
  kind: AgentDetailKind,
  tSettings: TFunction,
  tIntegrations: TFunction,
  extras?: AgentDetailExtraTab[]
): TabPillItem[] {
  const allowed = AGENT_KIND_TABS[kind];
  const items: TabPillItem[] = [];
  for (const key of CANONICAL_TAB_ORDER) {
    if (allowed.has(key)) {
      items.push({
        key,
        label: tabLabel(key, tSettings, tIntegrations),
        dataTestId: `agent-orgs-detail-tab-${key}`,
      });
    }
  }
  for (const key of AGENT_KIND_EXTRAS_AFTER_CANONICAL[kind]) {
    items.push({
      key,
      label: tabLabel(key, tSettings, tIntegrations),
      dataTestId: `agent-orgs-detail-tab-${key}`,
    });
  }
  if (extras) {
    for (const extra of extras) {
      items.push({
        ...extra,
        dataTestId: `agent-orgs-detail-tab-${extra.key}`,
      });
    }
  }
  return items;
}

export function isFullHeightAgentTab(key: string): boolean {
  return FULL_HEIGHT_TABS.has(key as AgentDetailTabKey);
}
