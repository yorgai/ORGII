import { afterEach, describe, expect, it } from "vitest";

import {
  type AliasEntry,
  type ToolActionInfo,
  _resetToolRegistry,
  _setBuiltinActionsMap,
  _setBuiltinDisplayBehaviorMap,
  _setCliToolAliasMap,
  getToolDisplayBehavior,
} from "../initToolRegistry";
import { TOOL_DISPLAY_BEHAVIOR } from "../types";

function aliasEntry(ui: string): AliasEntry {
  return {
    storage: ui,
    ui,
    simulatorApp: "CodeEditor",
    appSubtool: "other_tool",
    chatBlock: "fallback",
  };
}

describe("getToolDisplayBehavior", () => {
  afterEach(() => {
    _resetToolRegistry();
  });

  it("returns tool-level behavior", () => {
    _setBuiltinDisplayBehaviorMap(
      new Map([["read_file", TOOL_DISPLAY_BEHAVIOR.INSTANT]])
    );

    expect(getToolDisplayBehavior("read_file")).toBe(
      TOOL_DISPLAY_BEHAVIOR.INSTANT
    );
  });

  it("returns action-level behavior before tool-level behavior", () => {
    _setBuiltinDisplayBehaviorMap(
      new Map([["await_output", TOOL_DISPLAY_BEHAVIOR.STREAM]])
    );
    _setBuiltinActionsMap(
      new Map<string, ToolActionInfo[]>([
        [
          "await_output",
          [
            {
              name: "list",
              summary: "List jobs",
              displayBehavior: TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT,
              labelRunning: "",
              labelDone: "",
              labelFailed: "",
            },
          ],
        ],
      ])
    );

    expect(getToolDisplayBehavior("await_output", "list")).toBe(
      TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT
    );
  });

  it("uses CLI aliases before falling back", () => {
    _setBuiltinDisplayBehaviorMap(
      new Map([["read_file", TOOL_DISPLAY_BEHAVIOR.INSTANT]])
    );
    _setCliToolAliasMap(new Map([["Read", aliasEntry("read_file")]]));

    expect(getToolDisplayBehavior("Read")).toBe(TOOL_DISPLAY_BEHAVIOR.INSTANT);
  });

  it("falls back to wait_for_result", () => {
    expect(getToolDisplayBehavior("unknown_tool")).toBe(
      TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT
    );
  });
});
