/**
 * Agent Automation API
 *
 * Desktop permissions, automation rules, and webhook triggers.
 */
import type { AutomationStatus } from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import { invokeTauri } from "@src/util/platform/tauri/init";

import type { AutomationRule, DesktopPermission } from "./types";

export async function checkDesktopPermissions(): Promise<DesktopPermission[]> {
  return invokeTauri<DesktopPermission[]>("agent_check_desktop_permissions");
}

export async function requestDesktopPermissions(
  permission: string
): Promise<{ triggered: boolean; permissions: DesktopPermission[] }> {
  return invokeTauri<{ triggered: boolean; permissions: DesktopPermission[] }>(
    "agent_request_desktop_permissions",
    { permission }
  );
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  return invokeTauri<AutomationRule[]>("agent_automation_list_rules");
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  return invokeTauri<AutomationStatus>("agent_automation_get_status");
}

export async function addAutomationRule(
  rule: Omit<AutomationRule, "id">
): Promise<string> {
  const ruleJson = JSON.stringify(rule);
  return invokeTauri<string>("agent_automation_add_rule", { ruleJson });
}

export async function updateAutomationRule(
  rule: AutomationRule
): Promise<void> {
  const ruleJson = JSON.stringify(rule);
  return invokeTauri<void>("agent_automation_update_rule", { ruleJson });
}

export async function removeAutomationRule(ruleId: string): Promise<boolean> {
  return invokeTauri<boolean>("agent_automation_remove_rule", { ruleId });
}

export async function fireAutomationWebhook(route: string): Promise<boolean> {
  return invokeTauri<boolean>("agent_automation_fire_webhook", {
    route,
  });
}

// ── Desktop sub-gates ───────────────────────────────────────────────

export interface DesktopConfig {
  hideBeforeAction: boolean;
  antiDetection: boolean;
  humanInputProfile: boolean;
  escapeAbort: boolean;
}

export async function getDesktopConfig(): Promise<DesktopConfig> {
  return invokeTauri<DesktopConfig>("agent_get_desktop_config");
}

export async function setDesktopConfig(config: DesktopConfig): Promise<void> {
  return invokeTauri<void>("agent_set_desktop_config", { config });
}
