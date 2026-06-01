/**
 * OS Agent Config Utilities
 *
 * Helpers to safely read/write nested keys in the raw JSON config.
 */

export function getNestedString(
  obj: Record<string, unknown>,
  path: string,
  fallback: string
): string {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : fallback;
}

export function getNestedNumber(
  obj: Record<string, unknown>,
  path: string,
  fallback: number
): number {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" ? current : fallback;
}

export function getNestedBool(
  obj: Record<string, unknown>,
  path: string,
  fallback: boolean
): boolean {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return fallback;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "boolean" ? current : fallback;
}

export function getNestedStringArray(
  obj: Record<string, unknown>,
  path: string
): string[] {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[part];
  }
  if (!Array.isArray(current)) return [];
  return current.filter((item): item is string => typeof item === "string");
}

export function getNestedRecord(
  obj: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return {};
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null || typeof current !== "object" || Array.isArray(current))
    return {};
  return current as Record<string, unknown>;
}

export function setNested(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const result = structuredClone(obj);
  const parts = path.split(".");
  let current = result as Record<string, unknown>;
  for (let idx = 0; idx < parts.length - 1; idx++) {
    const part = parts[idx];
    if (current[part] == null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return result;
}

export function deleteNested(
  obj: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const result = structuredClone(obj);
  const parts = path.split(".");
  let current = result as Record<string, unknown>;
  for (let idx = 0; idx < parts.length - 1; idx++) {
    const part = parts[idx];
    if (current[part] == null || typeof current[part] !== "object") {
      return result; // path does not exist, nothing to delete
    }
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
  return result;
}
