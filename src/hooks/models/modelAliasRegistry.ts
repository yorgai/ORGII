/**
 * Runtime registry mapping model ids to user-chosen model alias metadata.
 *
 * Populated from key records on app startup and refreshed after key-vault
 * mutations. Consumed by model icons and model label renderers as the
 * highest-priority lookup before model-id inference/formatting.
 */
import { useSyncExternalStore } from "react";

import type { IconProvider } from "@src/components/ModelIcon/config";

interface KeyRecordWithModelAliases {
  model_aliases?: Array<{
    alias?: string | null;
    display_name?: string | null;
    displayName?: string | null;
    icon?: string | null;
  }>;
}

const modelAliasIconMap = new Map<string, IconProvider>();
const modelAliasDisplayNameMap = new Map<string, string>();
const subscribers = new Set<() => void>();
let version = 0;

function notifySubscribers(): void {
  version += 1;
  subscribers.forEach((subscriber) => subscriber());
}

function subscribeModelAliases(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getModelAliasSnapshot(): number {
  return version;
}

export function useModelAliasRegistryVersion(): number {
  return useSyncExternalStore(
    subscribeModelAliases,
    getModelAliasSnapshot,
    getModelAliasSnapshot
  );
}

export function getModelAliasIcon(modelName: string): IconProvider | undefined {
  return modelAliasIconMap.get(modelName);
}

export function getModelAliasDisplayName(
  modelName: string
): string | undefined {
  return modelAliasDisplayNameMap.get(modelName);
}

export function replaceModelAliasesFromKeys(
  keys: KeyRecordWithModelAliases[]
): void {
  modelAliasIconMap.clear();
  modelAliasDisplayNameMap.clear();
  for (const key of keys) {
    for (const alias of key.model_aliases ?? []) {
      if (!alias.alias) continue;
      if (alias.icon) {
        modelAliasIconMap.set(alias.alias, alias.icon as IconProvider);
      }
      const displayName = alias.display_name ?? alias.displayName;
      if (displayName?.trim()) {
        modelAliasDisplayNameMap.set(alias.alias, displayName);
      }
    }
  }
  notifySubscribers();
}
