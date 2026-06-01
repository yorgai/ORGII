import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_TIMER_INTERVAL,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/config";
import type {
  AutomationTrigger,
  RuleScope,
  TriggerType,
} from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";
import { DEFAULT_SCHEDULE_TIMEZONE } from "@src/modules/MainApp/Integrations/RulesMemoryEvolution/types";

import type { TriggerConfigState } from "./types";

export function defaultTrigger(triggerType: TriggerType): AutomationTrigger {
  switch (triggerType) {
    case "timer":
      return { type: "timer", intervalSecs: DEFAULT_TIMER_INTERVAL };
    case "scheduledTime":
      return {
        type: "scheduledTime",
        frequency: "weekly",
        time: "20:00",
        timezone: DEFAULT_SCHEDULE_TIMEZONE,
        daysOfWeek: ["monday"],
        monthlyMode: "dayOfMonth",
        dayOfMonth: 1,
        weekOfMonth: "first",
        weekdayOfMonth: "monday",
      };
    case "cron":
      return { type: "cron", expression: "0 9 * * *" };
    case "gitActivity":
      return { type: "gitActivity", events: ["commit"] };
    case "channelMessage":
      return { type: "channelMessage", channel: "", pattern: undefined };
    case "fileWatch":
      return { type: "fileWatch", paths: [], debounceMs: DEFAULT_DEBOUNCE_MS };
    case "webhook":
      return { type: "webhook", route: "/automation/hook" };
  }
}

export function defaultTriggerConfigState(): TriggerConfigState {
  return {
    name: "",
    enabled: true,
    trigger: null,
    cooldownSecs: undefined,
    maxFires: undefined,
    agentId: null,
    scopeMode: "all",
    scopeRepoIds: [],
    scopeExcludeRepoIds: [],
  };
}

export function triggerConfigFromRule(rule: {
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  cooldownSecs?: number;
  maxFires?: number;
  agentId?: string | null;
  scope?: RuleScope;
}): TriggerConfigState {
  return {
    name: rule.name,
    enabled: rule.enabled,
    trigger: rule.trigger,
    cooldownSecs: rule.cooldownSecs,
    maxFires: rule.maxFires,
    agentId: rule.agentId ?? null,
    scopeMode: rule.scope?.mode ?? "all",
    scopeRepoIds: rule.scope?.repoIds ?? [],
    scopeExcludeRepoIds: rule.scope?.excludeRepoIds ?? [],
  };
}
