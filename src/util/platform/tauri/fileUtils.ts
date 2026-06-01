/**
 * File Utilities - Tauri Native Bindings
 *
 * High-performance file utilities powered by Rust:
 * - Binary file detection (byte-level analysis)
 * - Gitignore/path filtering (pattern matching)
 *
 * These provide significant performance improvements over the pure TypeScript
 * implementations, especially for large codebases.
 */
import { invokeTauri, isTauriReady } from "./init";

// ============================================
// Types
// ============================================

export interface BinaryDetectionResult {
  /** Whether the file is binary */
  is_binary: boolean;
  /** Detection method used: 'extension', 'null_byte', 'non_printable_ratio', 'pattern', 'known_text_file', 'combined' */
  method: string;
  /** Additional details about the detection */
  details?: string;
}

export interface IgnoreResult {
  /** Whether the path should be ignored */
  should_ignore: boolean;
  /** Reason for the decision */
  reason: string;
  /** Category: 'hard_blocked', 'blacklist_dir', 'blacklist_ext', 'dotfile', 'gitignore' */
  category?: string;
}

// ============================================
// Tauri Availability Check
// ============================================

/**
 * Check if Tauri file utility APIs are available.
 * Delegates to the centralized isTauriReady() check.
 */
export function isTauriFileUtilsAvailable(): boolean {
  return isTauriReady();
}

// ============================================
// Binary Detection
// ============================================

/**
 * Check if a file is binary based on its extension (fast)
 *
 * @param filePath - File path or filename to check
 * @returns Detection result with method and details
 *
 * @example
 * ```typescript
 * const result = await isBinaryByExtension("image.png");
 * if (result.is_binary) { handleBinary(result.details); }
 * ```
 */
export async function isBinaryByExtensionNative(
  filePath: string
): Promise<BinaryDetectionResult> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<BinaryDetectionResult>("is_binary_by_extension", {
    filePath,
  });
}

/**
 * Check if content is binary by analyzing bytes (accurate)
 *
 * @param content - File content as Uint8Array
 * @param sampleSize - Number of bytes to sample (default: 8000)
 * @returns Detection result with method and details
 */
export async function isBinaryContentNative(
  content: Uint8Array,
  sampleSize?: number
): Promise<BinaryDetectionResult> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<BinaryDetectionResult>("is_binary_content", {
    content: Array.from(content),
    sampleSize,
  });
}

/**
 * Check if a file is binary (combines extension + content check)
 *
 * This is the most comprehensive check - it first checks the extension,
 * then optionally reads the file to check content.
 *
 * @param filePath - Full path to the file
 * @param checkContent - Whether to read and check file content (default: true)
 * @returns Detection result with method and details
 */
export async function isBinaryFileNative(
  filePath: string,
  checkContent: boolean = true
): Promise<BinaryDetectionResult> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<BinaryDetectionResult>("is_binary_file", {
    filePath,
    checkContent,
  });
}

// ============================================
// Ignore Filter
// ============================================

/**
 * Check if a path should be ignored for file sync
 *
 * @param relativePath - Relative path from repo root
 * @param gitignorePatterns - Optional gitignore patterns to check
 * @returns Ignore result with reason and category
 *
 * @example
 * ```typescript
 * const result = await shouldIgnorePathNative("node_modules/package/index.js");
 * if (result.should_ignore) { handleIgnored(result.reason); }
 * ```
 */
export async function shouldIgnorePathNative(
  relativePath: string,
  gitignorePatterns?: string[]
): Promise<IgnoreResult> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<IgnoreResult>("should_ignore_path", {
    relativePath,
    gitignorePatterns,
  });
}

/**
 * Batch check multiple paths for ignore status (more efficient)
 *
 * @param relativePaths - Array of relative paths to check
 * @param gitignorePatterns - Optional gitignore patterns to check
 * @returns Array of ignore results
 */
export async function shouldIgnorePathsBatchNative(
  relativePaths: string[],
  gitignorePatterns?: string[]
): Promise<IgnoreResult[]> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<IgnoreResult[]>("should_ignore_paths_batch", {
    relativePaths,
    gitignorePatterns,
  });
}

/**
 * Filter a list of paths, returning only those that should NOT be ignored
 *
 * @param relativePaths - Array of relative paths to filter
 * @param gitignorePatterns - Optional gitignore patterns to apply
 * @returns Array of paths that should NOT be ignored
 *
 * @example
 * ```typescript
 * const paths = ["src/index.ts", "node_modules/pkg/index.js", ".git/config"];
 * const filtered = await filterIgnoredPathsNative(paths);
 * // Returns: ["src/index.ts"]
 * ```
 */
export async function filterIgnoredPathsNative(
  relativePaths: string[],
  gitignorePatterns?: string[]
): Promise<string[]> {
  if (!isTauriFileUtilsAvailable()) {
    throw new Error("Tauri file utils not available");
  }

  return invokeTauri<string[]>("filter_ignored_paths", {
    relativePaths,
    gitignorePatterns,
  });
}

// ============================================
// Hybrid Functions (with TypeScript fallback)
// ============================================

/**
 * Check if a file is binary - uses native when available, falls back to TS
 *
 * This is the recommended function to use as it works in both Tauri and web contexts.
 */
export async function isBinaryFile(
  filePath: string,
  checkContent: boolean = false
): Promise<boolean> {
  if (isTauriFileUtilsAvailable()) {
    try {
      const result = await isBinaryFileNative(filePath, checkContent);
      return result.is_binary;
    } catch (error) {
      console.warn(
        "[FileUtils] Native binary detection failed, using fallback:",
        error
      );
    }
  }

  // Fallback to extension-based check (import dynamically to avoid circular deps)
  const { isBinaryByExtension } =
    await import("@src/util/file/binaryDetection");
  return isBinaryByExtension(filePath);
}

/**
 * Check if a path should be ignored - uses native when available, falls back to TS
 *
 * This is the recommended function to use as it works in both Tauri and web contexts.
 */
export async function shouldIgnorePath(
  relativePath: string,
  gitignorePatterns?: string[]
): Promise<boolean> {
  if (isTauriFileUtilsAvailable()) {
    try {
      const result = await shouldIgnorePathNative(
        relativePath,
        gitignorePatterns
      );
      return result.should_ignore;
    } catch (error) {
      console.warn(
        "[FileUtils] Native ignore check failed, using fallback:",
        error
      );
    }
  }

  // Fallback to TypeScript implementation
  const { shouldIgnore } = await import("./ignoreFilter");
  return shouldIgnore(relativePath, gitignorePatterns);
}

/**
 * Filter paths - uses native when available, falls back to TS
 *
 * This is the recommended function to use as it works in both Tauri and web contexts.
 */
export async function filterIgnoredPaths(
  relativePaths: string[],
  gitignorePatterns?: string[]
): Promise<string[]> {
  if (isTauriFileUtilsAvailable()) {
    try {
      return await filterIgnoredPathsNative(relativePaths, gitignorePatterns);
    } catch (error) {
      console.warn("[FileUtils] Native filter failed, using fallback:", error);
    }
  }

  // Fallback to TypeScript implementation
  const { shouldIgnore } = await import("./ignoreFilter");
  return relativePaths.filter((path) => !shouldIgnore(path, gitignorePatterns));
}
