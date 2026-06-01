/**
 * Recent Model Selections Atom
 *
 * Persists the last N model+source selections to localStorage.
 * Each entry captures the full context (model, account, agent type, source type)
 * so the "Recent" tab can offer one-click re-selection without a second step.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import {
  type CliAgentType,
  CliAgentTypeSchema,
  type ModelType,
  ModelTypeSchema,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE, type KeySource } from "@src/api/tauri/session/index";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

const STORAGE_KEY = "orgii:recentModelEntries";
const MAX_RECENT = 5;

export interface RecentModelEntry {
  modelId: string;
  sourceType: KeySource;
  accountId?: string;
  accountName?: string;
  modelType: ModelType;
  cliAgentType?: CliAgentType;
  cliAgentLabel?: string;
  cliModelDisplay?: string;
}

const RecentModelEntrySchema = z.object({
  modelId: z.string(),
  sourceType: z.enum([KEY_SOURCE.OWN, KEY_SOURCE.HOSTED]),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  modelType: ModelTypeSchema,
  cliAgentType: CliAgentTypeSchema.optional(),
  cliAgentLabel: z.string().optional(),
  cliModelDisplay: z.string().optional(),
}) as z.ZodType<RecentModelEntry, RecentModelEntry>;

const RecentModelEntriesSchema = z
  .array(RecentModelEntrySchema)
  .transform((entries) => entries.slice(0, MAX_RECENT));

export const recentModelEntriesAtom = atomWithStorage<RecentModelEntry[]>(
  STORAGE_KEY,
  [],
  createZodJsonStorage(RecentModelEntriesSchema)
);

/**
 * Record a model+source selection. Dedupes by modelId+accountId, keeps max N.
 */
export function recordRecentEntry(
  current: RecentModelEntry[],
  entry: RecentModelEntry
): RecentModelEntry[] {
  const filtered = current.filter(
    (existing) =>
      !(
        existing.modelId === entry.modelId &&
        existing.accountId === entry.accountId &&
        existing.sourceType === entry.sourceType
      )
  );
  return [entry, ...filtered].slice(0, MAX_RECENT);
}
