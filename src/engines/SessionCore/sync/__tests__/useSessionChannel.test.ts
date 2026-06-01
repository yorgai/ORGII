import { describe, expect, it } from "vitest";

import { validateSessionChannelMessage } from "../useSessionChannel";

describe("validateSessionChannelMessage", () => {
  it("returns the original raw payload when it matches the session event envelope", () => {
    const payload = JSON.stringify({
      type: "event",
      session_id: "session-1",
      payload: { id: "event-1" },
    });

    expect(validateSessionChannelMessage(payload)).toBe(payload);
  });

  it("throws when the payload is malformed JSON", () => {
    expect(() => validateSessionChannelMessage("not-json")).toThrow();
  });

  it("throws when the payload does not match the event envelope", () => {
    expect(() =>
      validateSessionChannelMessage(JSON.stringify({ payload: {} }))
    ).toThrow();
  });
});
