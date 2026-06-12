import { afterEach, describe, expect, it } from "vitest";

import { consumePendingFileOpens, queueFileOpens } from "../pendingFileOpens";

afterEach(() => {
  // Always drain the queue so test isolation is preserved.
  consumePendingFileOpens();
});

describe("queueFileOpens / consumePendingFileOpens", () => {
  it("returns an empty array when nothing was queued", () => {
    expect(consumePendingFileOpens()).toEqual([]);
  });

  it("returns queued files and empties the queue", () => {
    queueFileOpens([
      { path: "/foo/bar.ts" },
      { path: "/foo/baz.ts", line: 10 },
    ]);
    const result = consumePendingFileOpens();
    expect(result).toEqual([
      { path: "/foo/bar.ts" },
      { path: "/foo/baz.ts", line: 10 },
    ]);
  });

  it("clears the queue after consume so a second consume returns empty", () => {
    queueFileOpens([{ path: "/a.ts" }]);
    consumePendingFileOpens();
    expect(consumePendingFileOpens()).toEqual([]);
  });

  it("replaces the queue on successive calls to queueFileOpens", () => {
    queueFileOpens([{ path: "/first.ts" }]);
    queueFileOpens([{ path: "/second.ts" }]);
    const result = consumePendingFileOpens();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/second.ts");
  });

  it("handles a single file with no line number", () => {
    queueFileOpens([{ path: "/only.ts" }]);
    const [file] = consumePendingFileOpens();
    expect(file.path).toBe("/only.ts");
    expect(file.line).toBeUndefined();
  });

  it("handles a large queue without data loss", () => {
    const files = Array.from({ length: 100 }, (_, idx) => ({
      path: `/file-${idx}.ts`,
      line: idx + 1,
    }));
    queueFileOpens(files);
    const result = consumePendingFileOpens();
    expect(result).toHaveLength(100);
    expect(result[99].path).toBe("/file-99.ts");
    expect(result[99].line).toBe(100);
  });

  it("handles queueing an empty array", () => {
    queueFileOpens([]);
    expect(consumePendingFileOpens()).toEqual([]);
  });
});
