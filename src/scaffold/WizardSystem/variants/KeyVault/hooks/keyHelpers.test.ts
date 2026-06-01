import { describe, expect, it } from "vitest";

import type { DetectedKey } from "@src/api/types/keys";

import type { WizardData } from "../types";
import { applyKey } from "./keyHelpers";

describe("keyHelpers", () => {
  it("applies Cursor token-only detections as OAuth accounts without requiring an API key", () => {
    const updates: Partial<WizardData>[] = [];
    let tokenDetected = false;
    let cursorSessionToken = "";
    let tokenError: string | null = "previous error";
    let showKeySelection = true;

    const detectedKey: DetectedKey = {
      id: "cursor-token-only",
      name: "Cursor Token Only",
      auth_method: "oauth",
      session_token: "cursor-native-token",
      available_models: ["composer-2", "claude-sonnet-4-6"],
      validated: true,
    };

    applyKey(detectedKey, {
      onChange: (update) => updates.push(update),
      setTokenDetected: (value) => {
        tokenDetected = value;
      },
      setCursorSessionToken: (value) => {
        cursorSessionToken = value;
      },
      setTokenError: (value) => {
        tokenError = value;
      },
      setShowKeySelection: (value) => {
        showKeySelection = value;
      },
      isCursor: true,
      isOAuthAgent: false,
      noValidTokenMsg: "No valid token",
      validationFailedMsg: "Validation failed",
    });

    expect(tokenDetected).toBe(true);
    expect(cursorSessionToken).toBe("cursor-native-token");
    expect(tokenError).toBeNull();
    expect(showKeySelection).toBe(false);
    expect(updates).toEqual([
      {
        auth_method: "oauth",
        cursor_session_token: "cursor-native-token",
        raw_key_input: "",
        quota_info: undefined,
        available_models: ["composer-2", "claude-sonnet-4-6"],
        enabled_models: ["claude-sonnet-4-6", "composer-2"],
        validated: true,
      },
    ]);
  });
});
