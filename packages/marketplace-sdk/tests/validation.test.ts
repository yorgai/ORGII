import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SkillValidationError,
  validateInput,
  validateOutput,
} from "../src/validation.js";

const TestSchema = z.object({
  name: z.string(),
  count: z.number().int().positive(),
  tags: z.array(z.string()).optional(),
});

describe("validateInput", () => {
  it("returns parsed data for valid input", () => {
    const result = validateInput(TestSchema, { name: "test", count: 5 });
    expect(result).toEqual({ name: "test", count: 5 });
  });

  it("returns parsed data with optional fields", () => {
    const result = validateInput(TestSchema, {
      name: "test",
      count: 3,
      tags: ["a", "b"],
    });
    expect(result).toEqual({ name: "test", count: 3, tags: ["a", "b"] });
  });

  it("throws SkillValidationError for missing required fields", () => {
    expect(() => validateInput(TestSchema, { name: "test" })).toThrow(
      SkillValidationError
    );
  });

  it("throws SkillValidationError for wrong types", () => {
    expect(() =>
      validateInput(TestSchema, { name: 123, count: "not-a-number" })
    ).toThrow(SkillValidationError);
  });

  it("error contains field paths", () => {
    try {
      validateInput(TestSchema, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillValidationError);
      const validationErr = err as SkillValidationError;
      expect(validationErr.message).toContain("input validation failed");
      expect(validationErr.issues.length).toBeGreaterThan(0);
    }
  });

  it("strips unknown fields", () => {
    const result = validateInput(TestSchema, {
      name: "test",
      count: 1,
      extra: "should-be-stripped",
    });
    expect(result).toEqual({ name: "test", count: 1 });
    expect((result as Record<string, unknown>)["extra"]).toBeUndefined();
  });
});

describe("validateOutput", () => {
  it("returns parsed data for valid output", () => {
    const result = validateOutput(TestSchema, { name: "out", count: 10 });
    expect(result).toEqual({ name: "out", count: 10 });
  });

  it("throws SkillValidationError for invalid output", () => {
    expect(() => validateOutput(TestSchema, { name: "out" })).toThrow(
      SkillValidationError
    );
  });

  it("error message says 'Output validation failed'", () => {
    try {
      validateOutput(TestSchema, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SkillValidationError);
      expect((err as SkillValidationError).message).toContain(
        "output validation failed"
      );
    }
  });
});
