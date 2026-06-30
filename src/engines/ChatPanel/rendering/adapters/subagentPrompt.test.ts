import { describe, expect, it } from "vitest";

import {
  extractSubagentPromptFromChildEvents,
  firstSubagentAssignmentPrompt,
} from "./subagentPrompt";

const USER_PROMPT =
  "启动一个（subagent），让它帮我分析当前项目里有多少个 .rs 文件，并生成一份报告。必须要用subagent，然后要让我看到过程";
const ASSIGNMENT_PROMPT =
  "在当前工作目录下分析 Rust 源文件数量：统计所有 **/*.rs 文件，排除 target/ 目录；生成一份报告，包含总文件数、按目录分布、最大文件 Top 5，并在过程中持续汇报进展。";
const FINAL_REPORT =
  "Now I have all the data. Here is the comprehensive report.";

describe("subagent prompt helpers", () => {
  it("rejects generic labels, paste placeholders, parent prompt, and final reports as assignment fallback", () => {
    expect(firstSubagentAssignmentPrompt("Task", FINAL_REPORT)).toBeUndefined();
    expect(
      firstSubagentAssignmentPrompt(
        "pasted.txt [paste:paste://1782778711175-d8dsv8]"
      )
    ).toBeUndefined();
    expect(firstSubagentAssignmentPrompt(USER_PROMPT)).toBeUndefined();
  });

  it("extracts the child assignment prompt instead of the subagent final report", () => {
    const prompt = extractSubagentPromptFromChildEvents([
      {
        source: "assistant",
        result: { content: FINAL_REPORT },
        displayText: FINAL_REPORT,
      },
      {
        source: "user",
        result: { content: ASSIGNMENT_PROMPT },
        displayText: "Task",
      },
    ]);

    expect(prompt).toContain("分析 Rust 源文件数量");
    expect(prompt).toContain("生成一份报告");
    expect(prompt).not.toBe(FINAL_REPORT);
    expect(prompt).not.toBe("Task");
  });
});
