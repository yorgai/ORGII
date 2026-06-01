import { z } from "zod/v4";

export const SSEStartDataSchema = z.unknown();

export const SSEOutputDataSchema = z.object({
  stream: z.string(),
  line: z.string(),
});

export const SSEEndDataSchema = z
  .object({
    success: z.boolean(),
    error_type: z.string().optional(),
  })
  .catchall(z.unknown());

export const SSEErrorDataSchema = z
  .object({
    error: z.string(),
    error_type: z.string().optional(),
  })
  .catchall(z.unknown());

export type SSEStartData = z.output<typeof SSEStartDataSchema>;
export type SSEOutputData = z.output<typeof SSEOutputDataSchema>;
export type SSEEndData = z.output<typeof SSEEndDataSchema>;
export type SSEErrorData = z.output<typeof SSEErrorDataSchema>;

export function parseSSEStartData(raw: string): SSEStartData {
  return SSEStartDataSchema.parse(JSON.parse(raw));
}

export function parseSSEOutputData(raw: string): SSEOutputData {
  return SSEOutputDataSchema.parse(JSON.parse(raw));
}

export function parseSSEEndData(raw: string): SSEEndData {
  return SSEEndDataSchema.parse(JSON.parse(raw));
}

export function parseSSEErrorData(raw: string): SSEErrorData {
  return SSEErrorDataSchema.parse(JSON.parse(raw));
}
