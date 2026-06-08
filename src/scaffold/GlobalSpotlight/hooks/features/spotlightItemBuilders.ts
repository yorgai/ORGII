/**
 * Spotlight Item Builders
 *
 * Pure builder functions that convert action / repo / branch / nav definitions
 * into the `SpotlightItem` shape consumed by the palette. No React, no hooks —
 * all builders are deterministic functions of their arguments.
 */
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@src/i18n";

import {
  ACTIONS,
  ICONS,
  type NavDestination,
  type NavDestinationGroup,
} from "../../config";
import { describeNavDestination } from "../../navDestinations";
import { EDITOR_PALETTE_CONFIG } from "../../palettes/config";
import type { ActionDefinition, SpotlightItem } from "../../types";
import type {
  SpotlightEditorActionDefinition,
  SpotlightEditorActionId,
  SpotlightStaticActionDefinition,
} from "./spotlightActionDefinitions";
import { EDITOR_ACTIONS } from "./spotlightActionDefinitions";

export type Translator = (key: string) => string;

// ============================================
// Header & label helpers
// ============================================

function buildSectionHeader(id: string, label: string): SpotlightItem {
  return {
    id: `section-${id}`,
    label,
    type: "option",
    data: { isHeader: true },
  };
}

export function resolveActionLabel(
  action: ActionDefinition,
  translate: Translator
): string {
  return action.labelKey ? translate(action.labelKey) : action.label;
}

function namespaceSectionItems(
  sectionId: string,
  items: SpotlightItem[]
): SpotlightItem[] {
  return items.map((item) => ({
    ...item,
    id: `${sectionId}-${item.id}`,
  }));
}

// ============================================
// Action item builders
// ============================================

export function buildActionItems(
  onSelectAction: (action: ActionDefinition) => void,
  translate: Translator
): SpotlightItem[] {
  return ACTIONS.map((action) => ({
    id: action.id,
    label: resolveActionLabel(action, translate),
    icon: action.icon,
    type: "action" as const,
    action: () => onSelectAction(action),
  }));
}

export function buildRepoActionItems(
  onSelectAction: (action: ActionDefinition) => void,
  translate: Translator
): SpotlightItem[] {
  return ACTIONS.filter((actionDef) =>
    actionDef.requiredParams.includes("repo")
  ).map((action) => ({
    id: action.id,
    label: resolveActionLabel(action, translate),
    icon: action.icon,
    type: "action" as const,
    action: () => onSelectAction(action),
  }));
}

export function buildStaticActionItems(
  actions: SpotlightStaticActionDefinition[],
  onSelectStaticAction: (action: SpotlightStaticActionDefinition) => void,
  translate: Translator
): SpotlightItem[] {
  return actions.map((action) => ({
    id: action.id,
    label: translate(action.labelKey),
    icon: action.icon,
    type: "action" as const,
    shortcut: action.shortcut,
    action: () => onSelectStaticAction(action),
  }));
}

export function buildLanguageItems(
  currentLanguage: SupportedLanguage,
  searchQuery: string,
  onSelectLanguage: (language: SupportedLanguage, label: string) => void,
  translate: Translator
): SpotlightItem[] {
  const queryLower = searchQuery.trim().toLowerCase();

  return SUPPORTED_LANGUAGES.flatMap((language) => {
    const translatedName = translate(
      `settings:general.languageNames.${language}`
    );
    const nativeName = LANGUAGE_NAMES[language];
    const label =
      translatedName === nativeName
        ? nativeName
        : `${translatedName} · ${nativeName}`;
    const matches =
      !queryLower ||
      language.toLowerCase().includes(queryLower) ||
      translatedName.toLowerCase().includes(queryLower) ||
      nativeName.toLowerCase().includes(queryLower);

    if (!matches) return [];

    return [
      {
        id: `language-${language}`,
        label,
        icon: ICONS.language,
        type: "option" as const,
        data: {
          isCurrentSelection: language === currentLanguage,
        },
        action: () => onSelectLanguage(language, label),
      },
    ];
  });
}

export function buildEditorActionItems(
  onSelectEditorAction: (actionId: SpotlightEditorActionId) => void,
  translate: Translator
): SpotlightItem[] {
  return EDITOR_ACTIONS.map((action) =>
    buildEditorActionItem(action, onSelectEditorAction, translate)
  );
}

function buildEditorActionItem(
  action: SpotlightEditorActionDefinition,
  onSelectEditorAction: (actionId: SpotlightEditorActionId) => void,
  translate: Translator
): SpotlightItem {
  const modeConfig = EDITOR_PALETTE_CONFIG.modes[action.modeKey];
  return {
    id: action.id,
    label: translate(
      `selectors.editorSpotlight.modes.${action.modeKey}.${action.labelKey}`
    ),
    icon: modeConfig.icon,
    type: "action" as const,
    shortcut: action.shortcut,
    data: {
      prefix: action.prefix,
    },
    action: () => onSelectEditorAction(action.id),
  };
}

// ============================================
// Default grouped sections
// ============================================

export function buildGroupedDefaultItems(
  agentSessionItems: SpotlightItem[],
  workspaceItems: SpotlightItem[],
  quickNavigationItems: SpotlightItem[],
  editorItems: SpotlightItem[],
  viewItems: SpotlightItem[],
  navActionItems: SpotlightItem[],
  translate: Translator
): SpotlightItem[] {
  const items = [
    buildSectionHeader(
      "agent-session",
      translate("selectors.spotlight.groups.agentSession")
    ),
    ...namespaceSectionItems("agent-session", agentSessionItems),
    buildSectionHeader(
      "workspace",
      translate("selectors.spotlight.groups.workspace")
    ),
    ...namespaceSectionItems("workspace", workspaceItems),
  ];

  const quickNavigationGroupItems = [...quickNavigationItems, ...editorItems];

  if (quickNavigationGroupItems.length > 0) {
    items.push(
      buildSectionHeader(
        "quick-navigation",
        translate("selectors.spotlight.groups.quickNavigation")
      ),
      ...namespaceSectionItems("quick-navigation", quickNavigationGroupItems)
    );
  }

  items.push(
    buildSectionHeader("view", translate("selectors.spotlight.groups.view")),
    ...namespaceSectionItems("view", viewItems)
  );

  if (navActionItems.length > 0) {
    items.push(
      buildSectionHeader(
        "actions",
        translate("selectors.spotlight.groups.actions")
      ),
      ...namespaceSectionItems("actions", navActionItems)
    );
  }

  return items;
}

// ============================================
// Navigation destination items
// ============================================

/**
 * Navigation destinations are surfaced inline in global search so the user
 * can type e.g. "mcp" and jump straight to "Manage MCP". Selecting one routes
 * through `onSelectPath`, which the parent wires to react-router navigate.
 */
const NAV_DESTINATION_GROUP_ORDER: NavDestinationGroup[] = [
  "pages",
  "settings",
  "integrations",
  "actions",
];

export function buildNavDestinationItem(
  dest: NavDestination,
  onSelectPath: (
    path: string,
    label: string,
    icon: SpotlightItem["icon"]
  ) => void,
  translate: Translator
): SpotlightItem {
  const { label, description } = describeNavDestination(dest, translate);
  return {
    id: dest.id,
    label,
    icon: dest.icon,
    type: "page" as const,
    data: {
      rightLabel: description || dest.path,
    },
    action: () => onSelectPath(dest.path, label, dest.icon),
  };
}

export function buildGroupedNavItems(
  destinations: NavDestination[],
  onSelectPath: (
    path: string,
    label: string,
    icon: SpotlightItem["icon"]
  ) => void,
  translate: Translator
): SpotlightItem[] {
  const itemsByGroup = new Map<NavDestinationGroup, SpotlightItem[]>();

  for (const dest of destinations) {
    const groupItems = itemsByGroup.get(dest.group) ?? [];
    groupItems.push(buildNavDestinationItem(dest, onSelectPath, translate));
    itemsByGroup.set(dest.group, groupItems);
  }

  const items: SpotlightItem[] = [];
  for (const group of NAV_DESTINATION_GROUP_ORDER) {
    const groupItems = itemsByGroup.get(group);
    if (!groupItems?.length) continue;

    items.push(
      buildSectionHeader(
        `nav-${group}`,
        translate(`selectors.spotlight.groups.${group}`)
      ),
      ...namespaceSectionItems(`nav-${group}`, groupItems)
    );
  }

  return items;
}
