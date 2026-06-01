/**
 * AppSubtool-based event classification tests.
 * Verifies that getAppSubtool and getIDEEventType correctly classify tools
 * using Rust-aligned registry fixtures.
 */
import { describe, expect, it } from "vitest";

import { getAppSubtool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { getIDEEventType } from "@src/engines/SessionCore/rendering/registry/toolRegistryDomain";

describe("getAppSubtool classification", () => {
  it("classifies canonical coding tools from fixtures", () => {
    expect(getAppSubtool("read_file")).toBe("file_read");
    expect(getAppSubtool("edit_file")).toBe("file_write");
    expect(getAppSubtool("run_shell")).toBe("shell");
    expect(getAppSubtool("code_search")).toBe("explore");
  });

  it("maps CLI aliases to the same subtool semantics", () => {
    expect(getAppSubtool("read")).toBe("file_read");
    expect(getAppSubtool("Write")).toBe("file_write");
    expect(getAppSubtool("bash")).toBe("shell");
    expect(getAppSubtool("grep")).toBe("explore");
  });

  it("returns null for unrelated function names", () => {
    expect(getAppSubtool("unknown_tool_xyz")).toBeNull();
  });

  it("classifies delete_file as file_write", () => {
    expect(getAppSubtool("delete_file")).toBe("file_write");
  });
});

describe("getIDEEventType", () => {
  it("maps subtool to IDE event type", () => {
    expect(getIDEEventType("read_file")).toBe("read");
    expect(getIDEEventType("edit_file")).toBe("write");
    expect(getIDEEventType("run_shell")).toBe("shell");
    expect(getIDEEventType("code_search")).toBe("explore");
  });

  it("defaults unknown tools to read", () => {
    expect(getIDEEventType("unknown_tool")).toBe("read");
  });
});
