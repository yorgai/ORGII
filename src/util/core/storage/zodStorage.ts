import type { z } from "zod/v4";

export interface ZodSyncStorage<T> {
  getItem: (key: string, initialValue: T) => T;
  setItem: (key: string, value: T) => void;
  removeItem: (key: string) => void;
}

export interface ZodStorageOptions<T> {
  onInvalid?: (key: string, rawValue: string, error: unknown) => void;
  writeDefaultOnInvalid?: boolean;
  serialize?: (value: T) => string;
  deserialize?: (rawValue: string) => unknown;
}

const defaultDeserialize = (rawValue: string): unknown => JSON.parse(rawValue);
const defaultSerialize = <T>(value: T): string => JSON.stringify(value);

export function createZodJsonStorage<T>(
  schema: z.ZodType<T>,
  options: ZodStorageOptions<T> = {}
): ZodSyncStorage<T> {
  const deserialize = options.deserialize ?? defaultDeserialize;
  const serialize = options.serialize ?? defaultSerialize;

  return {
    getItem: (key, initialValue) => {
      const rawValue = localStorage.getItem(key);
      if (rawValue === null) return initialValue;

      try {
        return schema.parse(deserialize(rawValue));
      } catch (error) {
        options.onInvalid?.(key, rawValue, error);
        if (options.writeDefaultOnInvalid) {
          localStorage.setItem(key, serialize(initialValue));
        }
        return initialValue;
      }
    },
    setItem: (key, value) => {
      localStorage.setItem(key, serialize(value));
    },
    removeItem: (key) => {
      localStorage.removeItem(key);
    },
  };
}
