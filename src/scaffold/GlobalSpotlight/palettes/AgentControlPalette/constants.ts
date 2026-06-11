import type { AgentExecMode } from "@src/features/SessionCreator/config";

export const ADE_MANAGER_TOGGLE_SHORTCUT_ID = "toggle_ade_manager";
export const ADE_MANAGER_SUBMIT_EVENT = "orgii:ade-manager-submit";

export const ADE_MANAGER_AGENT_NAME = "ADE Manager";
export const ADE_MANAGER_SESSION_NAME = "ADE Manager";
export const ADE_MANAGER_AGENT_ICON_ID = "drafting-compass";
export const ADE_MANAGER_AGENT_EXEC_MODE: AgentExecMode = "build";

/** @deprecated Use ADE_MANAGER_TOGGLE_SHORTCUT_ID */
export const GUI_CONTROL_TOGGLE_SHORTCUT_ID = ADE_MANAGER_TOGGLE_SHORTCUT_ID;
/** @deprecated Use ADE_MANAGER_SUBMIT_EVENT */
export const GUI_CONTROL_SUBMIT_EVENT = ADE_MANAGER_SUBMIT_EVENT;
