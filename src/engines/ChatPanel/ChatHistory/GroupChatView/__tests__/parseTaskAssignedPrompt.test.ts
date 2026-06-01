import { describe, expect, it } from "vitest";

import { parseTaskAssignedPrompt } from "../parseTaskAssignedPrompt";

describe("parseTaskAssignedPrompt", () => {
  it("parses the Rust inbox-drain task assignment shape", () => {
    const parsed = parseTaskAssignedPrompt(
      [
        "Task assigned by Coordinator: Analyze recent git commits",
        "Task ID: d2895c11-dacd-4ff3-8827-7b7e63a9f8da",
        "Inspect recent git history and summarize themes.",
      ].join("\n")
    );

    expect(parsed).toEqual({
      assignedBy: "Coordinator",
      subject: "Analyze recent git commits",
      taskId: "d2895c11-dacd-4ff3-8827-7b7e63a9f8da",
      description: "Inspect recent git history and summarize themes.",
    });
  });

  it("returns null for unrelated user text", () => {
    expect(parseTaskAssignedPrompt("Please review the repo.")).toBeNull();
  });
});
