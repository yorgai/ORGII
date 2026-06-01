/**
 * Snake-case → camelCase transform utilities for Rust → TypeScript boundary.
 *
 * Rust returns `snake_case` keys; TypeScript expects `camelCase`.
 * These transformers are used in RPC procedure definitions to bridge the gap.
 */

type CamelCase<S extends string> = S extends `${infer P}_${infer Rest}`
  ? `${P}${Capitalize<CamelCase<Rest>>}`
  : S;

export type CamelCaseKeys<T> =
  T extends Array<infer U>
    ? CamelCaseKeys<U>[]
    : T extends Record<string, unknown>
      ? {
          [K in keyof T as K extends string ? CamelCase<K> : K]: CamelCaseKeys<
            T[K]
          >;
        }
      : T;

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Recursively convert all keys of an object from snake_case to camelCase.
 * Arrays are traversed; primitives are returned as-is.
 */
export function snakeToCamel<T>(data: T): CamelCaseKeys<T> {
  if (data === null || data === undefined) return data as CamelCaseKeys<T>;
  if (Array.isArray(data)) {
    return data.map(snakeToCamel) as CamelCaseKeys<T>;
  }
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>
    )) {
      result[toCamelCase(key)] = snakeToCamel(value);
    }
    return result as CamelCaseKeys<T>;
  }
  return data as CamelCaseKeys<T>;
}
