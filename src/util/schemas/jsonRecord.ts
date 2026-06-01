import { z } from "zod/v4";

export const JsonRecordFromAnySchema = z
  .json()
  .transform((value): Record<string, unknown> => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === "string") {
      return { content: value, observation: value };
    }
    if (value === null) return {};
    return { value };
  });
