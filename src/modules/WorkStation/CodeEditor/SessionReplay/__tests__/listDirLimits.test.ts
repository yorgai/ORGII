/**
 * Contract tests for list_dir simulator caps (memory / UI bounds).
 */
import { describe, expect, it } from "vitest";

import {
  SIMULATOR_LIST_DIR_DISPLAY_CAP,
  SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP,
} from "../listDirLimits";

describe("listDirLimits", () => {
  it("keeps display cap within a reasonable UI bound", () => {
    expect(SIMULATOR_LIST_DIR_DISPLAY_CAP).toBe(250);
    expect(SIMULATOR_LIST_DIR_DISPLAY_CAP).toBeGreaterThan(0);
    expect(SIMULATOR_LIST_DIR_DISPLAY_CAP).toBeLessThanOrEqual(5000);
  });

  it("keeps parse safety cap well above display cap", () => {
    expect(SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP).toBe(10_000);
    expect(SIMULATOR_LIST_DIR_PARSE_SAFETY_CAP).toBeGreaterThan(
      SIMULATOR_LIST_DIR_DISPLAY_CAP
    );
  });
});
