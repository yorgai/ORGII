/**
 * toolbarPlusConfigs
 *
 * Pure helper functions that build per-category plus-button dropdown items
 * and route-specific toolbar configurations for useRouteToolbarConfig.
 */
import {
  Blocks,
  CalendarArrowUp,
  Database,
  Download,
  FileText,
  Key,
  Settings as SettingsIcon,
  Unplug,
} from "lucide-react";

import type {
  AddAction,
  IntegrationCategory,
} from "@src/api/types/integrations";
import { McpLogoIcon } from "@src/assets/channelIcons/McpLogoIcon";
import type {
  RouteToolbarConfig,
  ToolbarDropdownItem,
} from "@src/store/ui/routeToolbarAtom";

type TFn = (key: string, options?: Record<string, unknown>) => string;

export function getPlusConfigForCategory(
  category: IntegrationCategory,
  dispatch: (action: AddAction) => void,
  t: TFn
): Pick<RouteToolbarConfig, "onPlusClick" | "plusTitle" | "plusDropdownItems"> {
  switch (category) {
    case "models":
      return { plusDropdownItems: buildModelsDropdownItems(dispatch, t) };
    case "databases":
      return { plusDropdownItems: buildDatabasesDropdownItems(dispatch, t) };
    case "connections":
      return { plusDropdownItems: buildConnectionsDropdownItems(dispatch, t) };
    case "externalSkillsets":
      return {
        plusDropdownItems: buildExternalSkillsetsDropdownItems(dispatch, t),
      };
    case "rulesMemoryEvolution":
      return { plusDropdownItems: buildRulesDropdownItems(dispatch, t) };
    case "routines":
      return { plusDropdownItems: buildRoutinesDropdownItems(dispatch, t) };
    default:
      return {};
  }
}

function buildModelsDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "bring-own-key",
      label: t("toolbarPlusMenu.addProviderKey"),
      icon: Key,
      onClick: () => dispatch("add-model"),
    },
    {
      id: "create-orgii-api",
      label: t("toolbarPlusMenu.createOrgiiApiKey"),
      icon: SettingsIcon,
      onClick: () => dispatch("create-orgii-api-key"),
    },
  ];
}

function buildDatabasesDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "add-database",
      label: t("toolbarPlusMenu.addDatabaseConnection"),
      icon: Database,
      onClick: () => dispatch("add-database"),
    },
  ];
}

function buildConnectionsDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "add-connection",
      label: t("toolbarPlusMenu.addChannelOrService"),
      icon: Unplug,
      onClick: () => dispatch("add-connection"),
    },
  ];
}

function buildExternalSkillsetsDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    ...buildSkillsDropdownItems(dispatch, t),
    ...buildMcpDropdownItems(dispatch, t),
  ];
}

function buildMcpDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "mcp-server",
      label: t("toolbarPlusMenu.addMcpServer"),
      icon: McpLogoIcon,
      onClick: () => dispatch("add-mcp"),
    },
  ];
}

function buildSkillsDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "create-skill",
      label: t("toolbarPlusMenu.createSkill"),
      icon: Blocks,
      onClick: () => dispatch("create-skill"),
    },
    {
      id: "import-skill",
      label: t("toolbarPlusMenu.importSkill"),
      icon: Download,
      onClick: () => dispatch("import-skill"),
    },
  ];
}

function buildRoutinesDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "add-routine",
      label: t("toolbarPlusMenu.addRoutine"),
      icon: CalendarArrowUp,
      onClick: () => dispatch("add-routine"),
    },
  ];
}

function buildRulesDropdownItems(
  dispatch: (action: AddAction) => void,
  t: TFn
): ToolbarDropdownItem[] {
  return [
    {
      id: "add-rule",
      label: t("toolbarPlusMenu.createRule"),
      icon: FileText,
      onClick: () => dispatch("add-rule"),
    },
  ];
}
