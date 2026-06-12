/**
 * Visibility Parity Test (TS side)
 *
 * Loads the shared fixture `src-tauri/src/agent_sessions/event_pipeline/
 * fixtures/visibility_parity.json` — the same file asserted by the Rust
 * `test_visibility_parity_fixture` in `tests/derived_tests.rs` — and verifies
 * that the TS `isVisibleInChat` twin returns the same verdict for every case.
 *
 * Field-name note: the fixture stores events in the exact serde wire format
 * of the Rust `SessionEvent` (`#[serde(rename_all = "camelCase")]`, with
 * `chunk_id` explicitly renamed to stay snake_case). That format is identical
 * to the TS `SessionEvent` interface (camelCase fields + `chunk_id`), so no
 * mapping layer is required — the JSON parses directly into `SessionEvent`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../core/types";
import { isVisibleInChat } from "../visibilityFilters";

interface ParityCase {
  name: string;
  event: SessionEvent;
  expectedChat: boolean;
}

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../src-tauri/src/agent_sessions/event_pipeline/fixtures/visibility_parity.json"
);

describe("visibility parity (Rust derived.rs ⇄ TS visibilityFilters.ts)", () => {
  const cases: ParityCase[] = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

  it("fixture is non-empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "isVisibleInChat parity: %s",
    (_name, parityCase) => {
      expect(isVisibleInChat(parityCase.event)).toBe(parityCase.expectedChat);
    }
  );
});
