/**
 * Tauri Folder Archive Module
 *
 * Creates ZIP archives from local folders for hosted_key session upload.
 * Uses native Rust backend for efficient archiving with progress updates.
 *
 * Features:
 * - Fast ZIP creation using native Rust
 * - Smart exclusion of node_modules, .git, etc.
 * - Progress events during archiving
 * - Base64 encoding for transport
 */
import {
  base64ToFile,
  ensureTauriReady,
  invokeTauri,
  isTauriReady,
  listenTauri,
} from "./init";

// ============================================
// Types
// ============================================

export interface ArchiveResult {
  /** Base64-encoded ZIP data */
  data: string;
  /** Size of the archive in bytes */
  size: number;
  /** Number of files archived */
  files_count: number;
  /** Original folder name */
  folder_name: string;
}

export interface FolderInfo {
  /** Folder name */
  folder_name: string;
  /** Number of files in folder */
  files_count: number;
  /** Total size in bytes */
  total_size: number;
  /** Estimated archive size after compression */
  estimated_archive_size: number;
}

export interface ArchiveProgress {
  /** Current file being processed */
  current: number;
  /** Total files to process */
  total: number;
  /** Current file name */
  current_file: string;
}

export interface ArchiveOptions {
  /** Absolute path to the folder to archive */
  folderPath: string;
  /** Callback for progress updates */
  onProgress?: (progress: ArchiveProgress) => void;
}

// ============================================
// Archive Functions
// ============================================

/** Guard against concurrent archive operations that would mix progress events */
let archiveInFlight = false;

/**
 * Create a ZIP archive from a local folder using native Tauri command
 *
 * @param options Archive configuration options
 * @returns Archive result with base64-encoded ZIP data
 * @throws Error if not in Tauri environment or archive fails
 *
 * @example
 * ```typescript
 * const result = await createFolderArchive({
 *   folderPath: '/Users/me/project',
 * });
 * // result.data contains base64-encoded ZIP
 * ```
 */
export async function createFolderArchive(
  options: ArchiveOptions
): Promise<ArchiveResult> {
  ensureTauriReady();

  if (archiveInFlight) {
    throw new Error(
      "A folder archive operation is already in progress. Wait for it to complete."
    );
  }

  archiveInFlight = true;
  let unlisten: (() => void) | undefined;

  try {
    // Set up progress listener if callback provided
    if (options.onProgress) {
      unlisten = await listenTauri<ArchiveProgress>(
        "archive-progress",
        (event) => {
          options.onProgress?.(event.payload);
        }
      );
    }
    const result = await invokeTauri<ArchiveResult>("create_folder_archive", {
      folder_path: options.folderPath,
    });

    return result;
  } catch (error) {
    console.error("[FolderArchive] Archive creation failed:", error);
    throw error;
  } finally {
    unlisten?.();
    archiveInFlight = false;
  }
}

/**
 * Get information about a folder without creating archive
 *
 * Useful for showing preview before archiving.
 *
 * @param folderPath Absolute path to the folder
 * @returns Folder information including file count and size
 */
export async function getFolderInfo(folderPath: string): Promise<FolderInfo> {
  ensureTauriReady();

  try {
    const info = await invokeTauri<FolderInfo>("get_folder_info", {
      folder_path: folderPath,
    });
    return info;
  } catch (error) {
    console.error("[FolderArchive] Failed to get folder info:", error);
    throw error;
  }
}

/**
 * Convert base64-encoded archive data to a File object
 *
 * Used to prepare the archive for upload via FormData.
 *
 * @param result Archive result from createFolderArchive
 * @returns File object ready for upload
 *
 * @example
 * ```typescript
 * const archive = await createFolderArchive({ folderPath: '/path/to/folder' });
 * const file = archiveToFile(archive);
 * formData.append('file', file);
 * ```
 */
export function archiveToFile(result: ArchiveResult): File {
  return base64ToFile(
    result.data,
    `${result.folder_name}.zip`,
    "application/zip"
  );
}

/**
 * Create archive and convert to File in one step
 *
 * Convenience function that combines createFolderArchive and archiveToFile.
 *
 * @param options Archive configuration options
 * @returns File object ready for upload
 */
export async function createFolderArchiveAsFile(
  options: ArchiveOptions
): Promise<File> {
  const result = await createFolderArchive(options);
  return archiveToFile(result);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if native folder archive is available
 */
export function isArchiveAvailable(): boolean {
  return isTauriReady();
}

/**
 * Create archive with error handling - returns null on failure
 *
 * Safe version that doesn't throw on error.
 */
export async function createFolderArchiveSafe(
  options: ArchiveOptions
): Promise<File | null> {
  try {
    return await createFolderArchiveAsFile(options);
  } catch (error) {
    console.warn("[FolderArchive] Archive creation failed:", error);
    return null;
  }
}
