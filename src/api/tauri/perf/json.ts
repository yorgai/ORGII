/**
 * Fast JSON API — SIMD-accelerated JSON parsing via Rust.
 * Best for large payloads (>10KB).
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  JsonParseResult,
  JsonStringifyResult,
  JsonValidationResult,
} from "./types";

export async function parseJsonFast(jsonStr: string): Promise<JsonParseResult> {
  return invoke<JsonParseResult>("parse_json_fast", { jsonStr });
}

export async function stringifyJsonFast(
  value: unknown,
  pretty?: boolean
): Promise<JsonStringifyResult> {
  return invoke<JsonStringifyResult>("stringify_json_fast", { value, pretty });
}

export async function validateJsonFast(
  jsonStr: string
): Promise<JsonValidationResult> {
  return invoke<JsonValidationResult>("validate_json_fast", { jsonStr });
}

export async function parseJsonFile(path: string): Promise<JsonParseResult> {
  return invoke<JsonParseResult>("parse_json_file", { path });
}

export async function parseJsonBatch(
  jsonStrings: string[]
): Promise<Array<unknown | string>> {
  return invoke<Array<unknown | string>>("parse_json_batch", { jsonStrings });
}
