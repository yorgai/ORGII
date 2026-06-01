/**
 * Unicode Escape Sequence Utilities
 *
 * Handles decoding of Unicode escape sequences (\uXXXX) that may appear
 * in data from backend APIs where JSON has been double-encoded.
 *
 * Example: "\u00e9" -> "é"
 */

/**
 * Decode Unicode escape sequences in a string.
 * Converts \uXXXX patterns to actual Unicode characters.
 *
 * This is needed when backend sends JSON with double-encoded Unicode,
 * where non-ASCII characters appear as literal escape sequences.
 *
 * @param str - String that may contain \uXXXX escape sequences
 * @returns String with escape sequences replaced by actual characters
 */
export function decodeUnicodeEscapes(str: string): string {
  if (!str || typeof str !== "string") return str;
  // Match \uXXXX patterns (4 hex digits)
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * Recursively decode Unicode escape sequences in an object/array.
 * Traverses nested structures and decodes all string values.
 *
 * @param value - Any value (string, object, array, etc.)
 * @returns Value with all string escape sequences decoded
 */
export function decodeUnicodeEscapesDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return decodeUnicodeEscapes(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => decodeUnicodeEscapesDeep(item)) as T;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = decodeUnicodeEscapesDeep(
        (value as Record<string, unknown>)[key]
      );
    }
    return result as T;
  }

  // For other types (number, boolean, etc.), return as-is
  return value;
}
