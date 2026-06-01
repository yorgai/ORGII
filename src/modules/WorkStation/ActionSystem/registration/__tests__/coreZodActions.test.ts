/**
 * WorkStation core Zod actions: schema uniqueness, LLM tool JSON, and registry wiring.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ACTION_ID } from "../../actionIds";
import { spotlightZodActions } from "../../actions/spotlightActions.zod";
import { appZoomZodActions } from "../../actions/zoomActions.zod";
import { zodActionToLLMTool } from "../../schema/defineZodAction";
import { zodActionRegistry } from "../../schema/zodRegistry";
import {
  getAllCoreZodActions,
  registerCoreActions,
} from "../registerCoreActions";

const TEST_REPO = "/tmp/orgii-action-system-test-repo";

describe("getAllCoreZodActions", () => {
  it("returns unique action ids", () => {
    const actions = getAllCoreZodActions(TEST_REPO);
    const ids = actions.map((action) => action.meta.id);
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("produces OpenAI-style LLM tool definitions for every action without throwing", () => {
    const actions = getAllCoreZodActions(TEST_REPO);

    for (const action of actions) {
      const tool = zodActionToLLMTool(action);
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe(action.meta.id.replace(/\./g, "_"));
      expect(tool.function.description.length).toBeGreaterThan(0);
      expect(tool.function.parameters).toBeDefined();
    }
  });

  it("includes representative WorkStation and git action ids", () => {
    const ids = new Set(
      getAllCoreZodActions(TEST_REPO).map((action) => action.meta.id)
    );
    expect(ids.has("terminal.execute")).toBe(true);
    expect(ids.has("panel.showPrimary")).toBe(true);
    expect(ids.has("file.open")).toBe(true);
    expect(ids.has("git.status")).toBe(true);
    expect(ids.has(ACTION_ID.SIDEBAR_TOGGLE)).toBe(true);
    expect(ids.has(ACTION_ID.AGENT_STATION_CREATE_SESSION)).toBe(true);
    expect(ids.has(ACTION_ID.WORKSTATION_TOGGLE_CHAT_FOCUS)).toBe(true);
    expect(ids.has(ACTION_ID.WORKSTATION_TOGGLE_CHAT_PANEL_VISIBILITY)).toBe(
      true
    );
    expect(ids.has(ACTION_ID.WORKSTATION_TOGGLE_SIDEBAR)).toBe(true);
    expect(ids.has(ACTION_ID.WORKSTATION_OPEN_FILE_FOLDER_TAB)).toBe(true);
    expect(ids.has(ACTION_ID.WORKSTATION_OPEN_SOURCE_CONTROL_TAB)).toBe(true);
    expect(ids.has(ACTION_ID.WORKSTATION_OPEN_TERMINAL_TAB)).toBe(true);
  });
});

describe("app-level zoomZodActions", () => {
  it("registers zoom actions under the View category", () => {
    const actionsById = new Map(
      appZoomZodActions.map((action) => [action.meta.id, action])
    );

    expect(actionsById.get(ACTION_ID.APP_ZOOM_IN)?.meta.category).toBe("view");
    expect(actionsById.get(ACTION_ID.APP_ZOOM_OUT)?.meta.category).toBe("view");
    expect(actionsById.get(ACTION_ID.APP_ZOOM_RESET)?.meta.category).toBe(
      "view"
    );
  });
});

describe("app-level spotlightZodActions", () => {
  it("includes Spotlight UI flow actions", () => {
    const ids = new Set(spotlightZodActions.map((action) => action.meta.id));
    expect(ids.has(ACTION_ID.SPOTLIGHT_OPEN_WORKSPACE_PICKER)).toBe(true);
    expect(ids.has(ACTION_ID.SPOTLIGHT_OPEN_BRANCH_PICKER)).toBe(true);
    expect(ids.has(ACTION_ID.SPOTLIGHT_OPEN_EDITOR_FILE)).toBe(true);
    expect(ids.has(ACTION_ID.SPOTLIGHT_OPEN_EDITOR_COMMAND)).toBe(true);
  });

  it("produces OpenAI-style LLM tool definitions for Spotlight actions", () => {
    for (const action of spotlightZodActions) {
      const tool = zodActionToLLMTool(action);
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBe(action.meta.id.replace(/\./g, "_"));
      expect(tool.function.description.length).toBeGreaterThan(0);
      expect(tool.function.parameters).toBeDefined();
    }
  });
});

describe("registerCoreActions", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("registers all core actions on the global registry and clears on cleanup", () => {
    expect(zodActionRegistry.getActionIds().length).toBe(0);

    cleanup = registerCoreActions(TEST_REPO);
    const registered = zodActionRegistry.getActionIds();
    expect(registered.length).toBe(getAllCoreZodActions(TEST_REPO).length);

    cleanup();
    cleanup = undefined;
    expect(zodActionRegistry.getActionIds().length).toBe(0);
  });
});
