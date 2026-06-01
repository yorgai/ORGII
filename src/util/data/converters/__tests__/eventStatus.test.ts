import {
  getEventStatus,
  hasEventStatus,
  isNotEventStatus,
} from "../eventStatus";

describe("getEventStatus", () => {
  it("returns empty string for null and non-objects", () => {
    expect(getEventStatus(null)).toBe("");
    expect(getEventStatus(undefined)).toBe("");
    expect(getEventStatus("not-an-object")).toBe("");
    expect(getEventStatus(42)).toBe("");
  });

  it("returns string status when status is a string", () => {
    expect(getEventStatus({ status: "running" })).toBe("running");
  });

  it("returns the value of the last key when status is an object", () => {
    const event = {
      status: { pending: "old", done: "complete" },
    };
    expect(getEventStatus(event)).toBe("complete");
  });

  it("returns empty string when status object has no keys", () => {
    expect(getEventStatus({ status: {} })).toBe("");
  });
});

describe("hasEventStatus", () => {
  it("returns true when current status is in the list", () => {
    expect(hasEventStatus({ status: "ok" }, ["ok", "fail"])).toBe(true);
  });

  it("returns false when current status is not in the list", () => {
    expect(hasEventStatus({ status: "pending" }, ["ok", "fail"])).toBe(false);
  });
});

describe("isNotEventStatus", () => {
  it("returns false when status matches", () => {
    expect(isNotEventStatus({ status: "done" }, "done")).toBe(false);
  });

  it("returns true when status does not match", () => {
    expect(isNotEventStatus({ status: "done" }, "pending")).toBe(true);
  });
});
