import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { MockChatItem } from "@src/modules/MainApp/ToolPreview/mockData/scenarios";

export const LIVE_MOCK_SCENARIO_ID = "__live_mock__";
export const CUSTOM_SCRIPT_PRESET_ID = "__custom_script__";

export interface LiveChatItem extends MockChatItem {
  id: string;
}

export interface LiveFlowStep {
  delayMs: number;
  item: LiveChatItem;
}

export interface ScriptActivityStep {
  type: "activity";
  delayMs?: number;
  function: string;
  uiCanonical?: string;
  status?: "running" | "completed" | "failed";
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface ScriptMessageStep {
  type: "message";
  delayMs?: number;
  content: string;
}

export type ScriptStep = ScriptActivityStep | ScriptMessageStep;

export interface LiveFlowBranch {
  id: string;
  keywords: string[];
  intro?: string;
  final?: string;
  steps: ScriptStep[];
}

export interface LiveFlowScript {
  intro?: string;
  final?: string;
  steps?: ScriptStep[];
  branches?: LiveFlowBranch[];
}

export interface ScriptPresetEntry {
  id: string;
  label: string;
  script: LiveFlowScript;
}

export interface ParsedLiveFlowScript {
  data: LiveFlowScript | null;
  error: string | null;
}

export interface ResolvedScriptRun {
  intro?: string;
  final?: string;
  steps: ScriptStep[];
  matchedBranchId?: string;
}

export interface BuiltLiveFlow {
  intro: LiveChatItem;
  steps: LiveFlowStep[];
  final: LiveChatItem;
}

export type LiveActivityStatus = NonNullable<ScriptActivityStep["status"]>;

export type LiveActivityEvent = SessionEvent;
