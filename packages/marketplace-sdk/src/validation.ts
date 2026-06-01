/**
 * Zod schema validation helpers for skill I/O.
 */
import { ZodError, type ZodType } from "zod";

export class SkillValidationError extends Error {
  readonly phase: "input" | "output";
  readonly issues: Array<{ path: string; message: string }>;

  constructor(
    phase: "input" | "output",
    issues: Array<{ path: string; message: string }>
  ) {
    const summary = issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    super(`Skill ${phase} validation failed: ${summary}`);
    this.name = "SkillValidationError";
    this.phase = phase;
    this.issues = issues;
  }
}

function formatZodIssues(
  error: ZodError
): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/**
 * Validates input data against a Zod schema.
 * Returns the parsed (and potentially transformed) data.
 * Throws SkillValidationError on failure.
 */
export function validateInput<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SkillValidationError("input", formatZodIssues(result.error));
  }
  return result.data;
}

/**
 * Validates output data against a Zod schema.
 * Returns the parsed data.
 * Throws SkillValidationError on failure.
 */
export function validateOutput<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SkillValidationError("output", formatZodIssues(result.error));
  }
  return result.data;
}
