/**
 * Contract test: `TOOL_NAMES` (TS) must match the Rust source of truth at
 * `src-tauri/src/agent_core/core/tools/names.rs`.
 *
 * The TS side intentionally only mirrors the subset of names the frontend
 * actually references; we do NOT require completeness. We only require that
 * every TS value is also defined on the Rust side with the same string.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../toolNames";

function loadRustToolNames(): Record<string, string> {
  const path = resolve(
    __dirname,
    "../../../../../src-tauri/crates/types/src/tool_names.rs"
  );
  const src = readFileSync(path, "utf-8");
  const re = /pub const ([A-Z0-9_]+):\s*&str\s*=\s*"([^"]+)"\s*;/g;
  const out: Record<string, string> = {};
  for (const match of src.matchAll(re)) {
    out[match[1]] = match[2];
  }
  return out;
}

describe("TOOL_NAMES Rust↔TS contract", () => {
  const rust = loadRustToolNames();

  it("Rust file parses to a non-empty map", () => {
    expect(Object.keys(rust).length).toBeGreaterThan(20);
  });

  it("every TS TOOL_NAMES value matches a Rust constant with the same wire string", () => {
    const errors: string[] = [];
    for (const [tsKey, tsValue] of Object.entries(TOOL_NAMES)) {
      const rustValue = rust[tsKey];
      if (rustValue === undefined) {
        errors.push(
          `TOOL_NAMES.${tsKey} = "${tsValue}" but Rust names.rs has no constant named ${tsKey}`
        );
        continue;
      }
      if (rustValue !== tsValue) {
        errors.push(
          `TOOL_NAMES.${tsKey}: TS="${tsValue}" vs Rust="${rustValue}"`
        );
      }
    }
    expect(errors).toEqual([]);
  });
});
