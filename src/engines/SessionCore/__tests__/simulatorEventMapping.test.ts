/**
 * Simulator Event Mapping Tests
 *
 * Verifies that event function names correctly route to simulator apps
 * (Browser, Channels, Code Editor, Project Manager).
 * Canvas-style tools map to CHANNELS.
 *
 * Tests expected tool names against `getAppTypeForEvent` (Rust map + CLI aliases)
 * for dock routing consistency.
 */
import { describe, expect, it } from "vitest";

import { getAppTypeForEvent } from "../rendering/registry/constants";

// ---------------------------------------------------------------------------
// Expected mappings (derived from tool_names.rs categories)
// AppType values: CODE_EDITOR, BROWSER, CHANNELS, STORY_MANAGER
// ---------------------------------------------------------------------------

const EXPECTED_BROWSER_TOOLS = [
  "web_search",
  "web_fetch",
  "control_browser_with_agent_browser",
  "control_browser_with_playwright",
  "control_external_browser",
  "control_desktop_with_peekaboo",
  "browser",
  "browser_navigate",
  "browser_act",
  "browser_screenshot",
  "browser_snapshot",
  "browser_open",
  "browser_visit",
  "web_navigate",
  "web_open",
  "navigate_url",
  "open_url",
  "visit_page",
];

const EXPECTED_CODE_EDITOR_TOOLS = [
  "read_file",
  "read",
  "Read",
  "edit_file",
  "edit",
  "Edit",
  "write",
  "Write",
  "create_file",
  "write_file",
  "delete_file",
  "list_dir",
  "ls",
  "run_shell",
  "run_command_line",
  "bash",
  "shell",
  "Shell",
  "Bash",
  "execute",
  "exec",
  "run_shell",
  "await_output",
  "code_search",
  "codebase_search",
  "grep",
  "Grep",
  "glob_file_search",
  "glob",
  "Glob",
  "file_search",
  "find_files",
  "search",
  "code_search",
  "manage_workspace",
  "query_lsp",
  "manage_lsp",
  "setup_repo",
  "manage_nodes",
  "mcp_tool",
  "tool_call",
];

const EXPECTED_CHANNELS_TOOLS = [
  "thinking",
  "assistant",
  "user",
  "message",
  "raw_event",
  "raw",
  "llm_thinking",
  "ask_user_questions",
  "ask_question",
  "send_message",
  "send_to_inbox",
  "manage_todo",
  "task_create",
  "task_update",
  "task_list",
  "task_get",
  "submit_output",
  "manage_session",
  "agent",
  "schedule_task",
  "manage_agent_def",
  "query_knowledge",
  "control_orgii",
];

const EXPECTED_STORY_MANAGER_TOOLS = ["manage_story", "manage_work_item"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Simulator Event Mapping — getAppTypeForEvent", () => {
  describe("BROWSER events", () => {
    for (const tool of EXPECTED_BROWSER_TOOLS) {
      it(`"${tool}" → BROWSER`, () => {
        expect(getAppTypeForEvent(tool)).toBe("BROWSER");
      });
    }
  });

  describe("CODE_EDITOR events", () => {
    for (const tool of EXPECTED_CODE_EDITOR_TOOLS) {
      it(`"${tool}" → CODE_EDITOR`, () => {
        expect(getAppTypeForEvent(tool)).toBe("CODE_EDITOR");
      });
    }
  });

  describe("CHANNELS events", () => {
    for (const tool of EXPECTED_CHANNELS_TOOLS) {
      it(`"${tool}" → CHANNELS`, () => {
        expect(getAppTypeForEvent(tool)).toBe("CHANNELS");
      });
    }
  });

  describe("STORY_MANAGER events", () => {
    for (const tool of EXPECTED_STORY_MANAGER_TOOLS) {
      it(`"${tool}" → STORY_MANAGER`, () => {
        expect(getAppTypeForEvent(tool)).toBe("STORY_MANAGER");
      });
    }
  });

  describe("null for unknown events", () => {
    it("returns null for unknown function name", () => {
      expect(getAppTypeForEvent("some_totally_unknown_event")).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(getAppTypeForEvent(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getAppTypeForEvent("")).toBeNull();
    });
  });
});
