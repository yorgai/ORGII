#!/usr/bin/env node
/**
 * Git custom merge driver for JSON files.
 *
 * Performs a recursive deep merge of JSON objects so that
 * independent key additions from different branches never conflict.
 *
 * Usage (called by git):
 *   node scripts/git/json-merge-driver.mjs %A %O %B
 *
 * %A = current (ours), %O = ancestor (base), %B = other (theirs)
 * Result is written back to %A. Exit 0 = success, 1 = conflict.
 */
import { readFileSync, writeFileSync } from "fs";

const [ourFile, baseFile, theirFile] = process.argv.slice(2);

function deepMerge(base, ours, theirs) {
  if (
    typeof ours !== "object" || ours === null ||
    typeof theirs !== "object" || theirs === null ||
    Array.isArray(ours) || Array.isArray(theirs)
  ) {
    // For non-objects / arrays: if theirs changed from base, take theirs; otherwise keep ours
    if (JSON.stringify(base) === JSON.stringify(theirs)) return ours;
    if (JSON.stringify(base) === JSON.stringify(ours)) return theirs;
    // Both changed — can't auto-resolve, prefer theirs (latest)
    return theirs;
  }

  const result = {};
  const allKeys = new Set([
    ...Object.keys(ours),
    ...Object.keys(theirs),
  ]);

  for (const key of allKeys) {
    const baseVal = base?.[key];
    const ourVal = ours[key];
    const theirVal = theirs[key];

    if (key in ours && !(key in theirs)) {
      // Only in ours (we added or they deleted)
      if (key in (base || {})) {
        // Was in base, they deleted — skip (accept deletion)
      } else {
        // We added — keep
        result[key] = ourVal;
      }
    } else if (!(key in ours) && key in theirs) {
      // Only in theirs (they added or we deleted)
      if (key in (base || {})) {
        // Was in base, we deleted — skip (accept deletion)
      } else {
        // They added — keep
        result[key] = theirVal;
      }
    } else {
      // In both — recurse
      result[key] = deepMerge(baseVal, ourVal, theirVal);
    }
  }

  return result;
}

try {
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  const ours = JSON.parse(readFileSync(ourFile, "utf8"));
  const theirs = JSON.parse(readFileSync(theirFile, "utf8"));

  const merged = deepMerge(base, ours, theirs);
  writeFileSync(ourFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
  process.exit(0);
} catch (err) {
  console.error("[json-merge-driver] Failed:", err.message);
  process.exit(1);
}
