import { describe, expect, it } from "vitest";

import { extractAnsweredData, parseAnswersFromContent } from "../index";

// Minimal RawEventInput stub — extractAnsweredData only reads
// `event.{result,args}` so we don't need the full SessionEvent shape.
function makeProps(
  args: Record<string, unknown> | undefined,
  result: Record<string, unknown> | undefined
) {
  return {
    event: {
      id: "evt-1",
      args,
      result,
      displayStatus: "completed",
    },
  } as unknown as Parameters<typeof extractAnsweredData>[0];
}

describe("parseAnswersFromContent", () => {
  it("parses a 2-question prose blob using question anchors", () => {
    const content =
      'User has answered your questions: "Q1" = "A1", "Q2" = "A2". You can now continue with the user\'s answers in mind.';
    expect(parseAnswersFromContent(content, ["Q1", "Q2"])).toEqual([
      ["A1"],
      ["A2"],
    ]);
  });

  it("returns empty array for a question whose answer is the literal 'Unanswered' placeholder", () => {
    const content =
      'User has answered your questions: "Q1" = "Unanswered", "Q2" = "B". You can now continue with the user\'s answers in mind.';
    expect(parseAnswersFromContent(content, ["Q1", "Q2"])).toEqual([[], ["B"]]);
  });

  it("returns empty arrays aligned to questionTexts.length when prefix is missing", () => {
    expect(parseAnswersFromContent("garbage", ["Q1", "Q2"])).toEqual([[], []]);
  });

  it("returns empty array for a question whose text cannot be located", () => {
    const content =
      'User has answered your questions: "Q1" = "A1". You can now continue with the user\'s answers in mind.';
    expect(parseAnswersFromContent(content, ["Q1", "Missing"])).toEqual([
      ["A1"],
      [],
    ]);
  });

  it("handles a single-question blob", () => {
    const content =
      'User has answered your questions: "Q1" = "A1". You can now continue with the user\'s answers in mind.';
    expect(parseAnswersFromContent(content, ["Q1"])).toEqual([["A1"]]);
  });

  it("handles answers containing commas (multi-select join)", () => {
    // Rust joins multi-select labels with `, ` (no surrounding quotes per item).
    const content =
      'User has answered your questions: "Q1" = "Option A (a), Option B (b)", "Q2" = "C". You can now continue with the user\'s answers in mind.';
    const out = parseAnswersFromContent(content, ["Q1", "Q2"]);
    expect(out[0]).toEqual(["Option A (a), Option B (b)"]);
    expect(out[1]).toEqual(["C"]);
  });
});

describe("extractAnsweredData", () => {
  it("uses structured result.answers when present", () => {
    const props = makeProps(
      { questions: [{ question: "Q1" }, { question: "Q2" }] },
      { status: "answered", answers: [["A1"], ["A2"]] }
    );
    const out = extractAnsweredData(props);
    expect(out.isAnswered).toBe(true);
    expect(out.isRejected).toBe(false);
    expect(out.pairs).toEqual([
      { question: "Q1", answers: ["A1"] },
      { question: "Q2", answers: ["A2"] },
    ]);
  });

  it("falls back to content parsing when result.answers was clobbered", () => {
    const props = makeProps(
      { questions: [{ question: "Q1" }, { question: "Q2" }] },
      {
        // status + answers both gone — only content survives, per the
        // `(Object, String) ⇒ incoming` merge fallback in Rust.
        content:
          'User has answered your questions: "Q1" = "A1", "Q2" = "A2". You can now continue with the user\'s answers in mind.',
      }
    );
    const out = extractAnsweredData(props);
    expect(out.isAnswered).toBe(true);
    expect(out.pairs).toEqual([
      { question: "Q1", answers: ["A1"] },
      { question: "Q2", answers: ["A2"] },
    ]);
  });

  it("returns empty answers (no false 'Skipped by user' label) when only Q1 was answered and Q2 is Unanswered", () => {
    const props = makeProps(
      { questions: [{ question: "Q1" }, { question: "Q2" }] },
      {
        content:
          'User has answered your questions: "Q1" = "A1", "Q2" = "Unanswered". You can now continue with the user\'s answers in mind.',
      }
    );
    const out = extractAnsweredData(props);
    expect(out.pairs[0].answers).toEqual(["A1"]);
    expect(out.pairs[1].answers).toEqual([]);
  });

  it("marks isRejected when result.status = 'rejected' (skipped by user)", () => {
    const props = makeProps(
      { questions: [{ question: "Q1" }] },
      { status: "rejected", answers: [["[Skipped by user]"]] }
    );
    const out = extractAnsweredData(props);
    expect(out.isRejected).toBe(true);
    expect(out.isAnswered).toBe(false);
  });

  it("legacy single-question shape: extracts question and answer from result", () => {
    const props = makeProps(undefined, {
      status: "answered",
      question: "Legacy?",
      answer: "Sure",
    });
    const out = extractAnsweredData(props);
    expect(out.pairs).toEqual([{ question: "Legacy?", answers: ["Sure"] }]);
    expect(out.isAnswered).toBe(true);
  });

  it("aligns parsed answers to args.questions.length even when one question fails to parse", () => {
    const props = makeProps(
      {
        questions: [{ question: "Q1" }, { question: "Q2" }, { question: "Q3" }],
      },
      {
        // Q2 text is absent from the blob — the parser should still align Q1/Q3.
        content:
          'User has answered your questions: "Q1" = "A1", "Q3" = "A3". You can now continue with the user\'s answers in mind.',
      }
    );
    const out = extractAnsweredData(props);
    expect(out.pairs[0].answers).toEqual(["A1"]);
    expect(out.pairs[1].answers).toEqual([]);
    expect(out.pairs[2].answers).toEqual(["A3"]);
  });
});
