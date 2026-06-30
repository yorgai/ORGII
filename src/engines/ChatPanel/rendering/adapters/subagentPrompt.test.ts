import { describe, expect, it } from "vitest";

import {
  extractSubagentPromptFromChildEvents,
  firstSubagentAssignmentPrompt,
} from "./subagentPrompt";

const ASSIGNMENT_PROMPT =
  "在当前工作目录下分析 Rust 源文件数量：统计所有 **/*.rs 文件，排除 target/ 目录；生成一份报告，包含总文件数、按目录分布、最大文件 Top 5，并在过程中持续汇报进展。";

describe("subagent prompt helpers", () => {
  it("returns the first non-empty prompt without content guessing", () => {
    expect(firstSubagentAssignmentPrompt("", "  ", "Task")).toBe("Task");
    expect(
      firstSubagentAssignmentPrompt(
        undefined,
        "pasted.txt [paste:paste://1782778711175-d8dsv8]"
      )
    ).toBe("pasted.txt [paste:paste://1782778711175-d8dsv8]");
  });

  it("extracts the first user prompt from child events", () => {
    const prompt = extractSubagentPromptFromChildEvents([
      {
        source: "assistant",
        result: { content: "Now I have all the data." },
        displayText: "Now I have all the data.",
      },
      {
        source: "user",
        result: { content: ASSIGNMENT_PROMPT },
        displayText: "Task",
      },
    ]);

    expect(prompt).toContain("分析 Rust 源文件数量");
    expect(prompt).toContain("生成一份报告");
  });
});
