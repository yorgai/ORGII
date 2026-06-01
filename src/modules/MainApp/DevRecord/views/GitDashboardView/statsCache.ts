/**
 * Commit Stats Disk + Memory Cache
 *
 * Two-layer cache for per-commit stats (files changed, insertions, deletions,
 * per-file status for rename filtering).
 *
 * Commit SHAs are immutable → perfect cache key, entries never stale.
 *
 * Memory layer: Map<sha, CommitStatsEntry> (up to MAX_MEMORY_ENTRIES)
 * Disk layer:   ~/.orgii/cache/git-dashboard-stats.json (compact format, up to MAX_DISK_ENTRIES)
 *
 * Disk stores aggregate stats + compact per-file data (status, insertions, deletions).
 * Full file paths are only available from live API — disk entries use path="" as sentinel.
 *
 * Debounced disk writes (SAVE_DEBOUNCE_MS) to avoid excessive I/O.
 */
import { homeDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { CommitStatsEntry } from "./types";

const DISK_FORMAT_VERSION = 3;
const MAX_MEMORY_ENTRIES = 2000;
const MAX_DISK_ENTRIES = 1000;
const SAVE_DEBOUNCE_MS = 3000;

interface CompactFileChange {
  s: string;
  i: number;
  d: number;
}

interface DiskEntry {
  f: number;
  i: number;
  d: number;
  fc?: CompactFileChange[];
}

interface DiskFormat {
  v: number;
  entries: Record<string, DiskEntry>;
}

const cache = new Map<string, CommitStatsEntry>();
let diskPath: string | null = null;
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function resolvePath(): Promise<string> {
  if (diskPath) return diskPath;
  const home = await homeDir();
  diskPath = await join(home, ".orgii", "cache", "git-dashboard-stats.json");
  return diskPath;
}

async function loadFromDisk(): Promise<void> {
  try {
    const path = await resolvePath();
    const content = await readTextFile(path);
    const data = JSON.parse(content) as DiskFormat;
    if (data.v === DISK_FORMAT_VERSION && data.entries) {
      for (const [sha, entry] of Object.entries(data.entries)) {
        cache.set(sha, {
          filesChanged: entry.f,
          insertions: entry.i,
          deletions: entry.d,
          fileChanges: entry.fc
            ? entry.fc.map((fc) => ({
                path: "",
                insertions: fc.i,
                deletions: fc.d,
                status: fc.s,
              }))
            : [],
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug(
      "[StatsCache] Disk cache not found or corrupt, starting fresh:",
      err
    );
  }
}

export async function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadFromDisk();
  }
  return loadPromise;
}

export function get(sha: string): CommitStatsEntry | undefined {
  return cache.get(sha);
}

export function has(sha: string): boolean {
  return cache.has(sha);
}

/**
 * Returns true if the cached entry has full file-level detail including paths.
 * Disk-loaded entries have fileChanges with status/insertions/deletions but empty
 * paths — enough for rename filtering but not for timeline file display.
 */
export function hasFullDetail(sha: string): boolean {
  const entry = cache.get(sha);
  if (!entry || entry.fileChanges.length === 0) return false;
  return entry.fileChanges[0].path !== "";
}

export function set(sha: string, entry: CommitStatsEntry): void {
  if (cache.size >= MAX_MEMORY_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(sha, entry);
  dirty = true;
}

export function scheduleSave(): void {
  if (!dirty) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToDisk();
  }, SAVE_DEBOUNCE_MS);
}

async function saveToDisk(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  try {
    const path = await resolvePath();
    const dir = path.substring(0, path.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });

    const entries: Record<string, DiskEntry> = {};
    let count = 0;
    for (const [sha, entry] of cache) {
      if (count >= MAX_DISK_ENTRIES) break;
      const diskEntry: DiskEntry = {
        f: entry.filesChanged,
        i: entry.insertions,
        d: entry.deletions,
      };
      if (entry.fileChanges.length > 0) {
        diskEntry.fc = entry.fileChanges.map((fc) => ({
          s: fc.status,
          i: fc.insertions,
          d: fc.deletions,
        }));
      }
      entries[sha] = diskEntry;
      count++;
    }

    const data: DiskFormat = { v: DISK_FORMAT_VERSION, entries };
    await writeTextFile(path, JSON.stringify(data));
  } catch (err) {
    dirty = true;
    // eslint-disable-next-line no-console
    console.debug("[StatsCache] Failed to save to disk:", err);
  }
}
