/**
 * Hash API — SHA-256 and Blake3 hashing via Rust.
 */
import { invoke } from "@tauri-apps/api/core";

import type { HashResult } from "./types";

export async function computeSha256(data: string): Promise<HashResult> {
  return invoke<HashResult>("compute_sha256", { data });
}

export async function computeSha256Bytes(
  data: Uint8Array
): Promise<HashResult> {
  return invoke<HashResult>("compute_sha256_bytes", { data: Array.from(data) });
}

export async function computeBlake3(data: string): Promise<HashResult> {
  return invoke<HashResult>("compute_blake3", { data });
}

export async function computeBlake3Bytes(
  data: Uint8Array
): Promise<HashResult> {
  return invoke<HashResult>("compute_blake3_bytes", { data: Array.from(data) });
}

export async function computeFileHash(
  path: string,
  algorithm?: "sha256" | "blake3"
): Promise<HashResult> {
  return invoke<HashResult>("compute_file_hash", { path, algorithm });
}

export async function computeBlake3Batch(data: string[]): Promise<string[]> {
  return invoke<string[]>("compute_blake3_batch", { data });
}
