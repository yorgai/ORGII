import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("formats sub-second durations as < 1s", () => {
    expect(formatDuration(0)).toBe("< 1s");
    expect(formatDuration(999)).toBe("< 1s");
  });

  it("formats seconds below one minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(59000)).toBe("59s");
  });

  it("formats minutes and optional seconds", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(90000)).toBe("1m 30s");
  });

  it("formats hours and optional minutes", () => {
    expect(formatDuration(3600000)).toBe("1h");
    expect(formatDuration(5400000)).toBe("1h 30m");
  });
});
