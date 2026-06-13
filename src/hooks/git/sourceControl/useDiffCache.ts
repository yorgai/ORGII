/**
 * Hook for managing diff content caching and batch loading
 */
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { GitFileDiffResult, gitApi } from "@src/api/http/git";
import { createLogger } from "@src/hooks/logger";
import type { GitFile } from "@src/types/git/types";
import { decodeOctalPath } from "@src/util/file/pathUtils";
import { buildContentFromHunks } from "@src/util/git/buildContentFromHunks";
import { isUntrackedGitFile } from "@src/util/git/diffBaseRef";

const log = createLogger("useDiffCache");

export interface UseDiffCacheOptions {
  selectedRepoId: string | null;
  repoPath?: string;
  files: GitFile[];
  setFiles: Dispatch<SetStateAction<GitFile[]>>;
  selectedFileId: string;
}

export interface UseDiffCacheResult {
  loadingFileId: string | null;
  diffCacheRef: MutableRefObject<Map<string, GitFile>>;
  batchLoadFileDiffs: (filesToLoad: GitFile[]) => Promise<void>;
}

function getRelativePath(filePath: string, repoPath: string): string {
  return filePath.startsWith(repoPath)
    ? filePath.slice(repoPath.length + 1)
    : filePath;
}

function getDiffLookupKeys(filePath: string, repoPath: string): string[] {
  const relativePath = getRelativePath(filePath, repoPath);
  const absolutePath = filePath.startsWith("/")
    ? filePath
    : `${repoPath}/${filePath}`;
  return [filePath, relativePath, absolutePath, decodeOctalPath(filePath)];
}

export function useDiffCache(options: UseDiffCacheOptions): UseDiffCacheResult {
  const { selectedRepoId, repoPath, files, setFiles, selectedFileId } = options;

  // Cache for loaded diffs to avoid re-fetching (capped to prevent memory growth)
  const MAX_DIFF_CACHE_SIZE = 100;
  const diffCacheRef = useRef<Map<string, GitFile>>(new Map());

  // Track which file is currently loading
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);

  // Track batch loading state
  const batchLoadingRef = useRef(false);

  // Keep a ref to files to avoid the effect depending on the array reference
  const filesRef = useRef(files);
  filesRef.current = files;

  // Batch load diff content for multiple files
  const batchLoadFileDiffs = useCallback(
    async (filesToLoad: GitFile[]) => {
      if (!selectedRepoId || filesToLoad.length === 0) return;

      // Need repo path for API call
      if (!repoPath) {
        log.warn("[useDiffCache] No repo path available for batch diff load");
        return;
      }

      // Filter out already loaded/cached files
      const unloadedFiles = filesToLoad.filter(
        (file) =>
          file.oldContent === undefined && !diffCacheRef.current.get(file.id)
      );

      if (unloadedFiles.length === 0) return;

      // Split by from_ref: untracked files have no HEAD baseline, so they
      // must be sent with from_ref="EMPTY" (which flips backend's
      // include_untracked(true) path). Mixing them into the HEAD batch
      // would yield empty content for the untracked rows even though
      // numstat reports +N additions. See `diffBaseRefForFile`.
      const untrackedGroup = unloadedFiles.filter(isUntrackedGitFile);
      const trackedGroup = unloadedFiles.filter(
        (file) => !isUntrackedGitFile(file)
      );

      const fetchGroup = (group: typeof unloadedFiles, fromRef: string) => {
        if (group.length === 0) return Promise.resolve(undefined);
        const filesInput = group.map((file) => ({
          path: getRelativePath(file.path, repoPath),
          original_path: file.original_path ?? undefined,
        }));
        return gitApi.getGitBatchFileDiffs({
          repo_id: selectedRepoId,
          repo_path: repoPath,
          files: filesInput,
          from_ref: fromRef,
          include_content: true,
          context_lines: 3,
        });
      };

      try {
        const [trackedResponse, untrackedResponse] = await Promise.all([
          fetchGroup(trackedGroup, "HEAD"),
          fetchGroup(untrackedGroup, "EMPTY"),
        ]);

        // Merge both responses into a single shape the rest of this
        // callback already understands.
        const combinedFiles = [
          ...(trackedResponse?.files ?? []),
          ...(untrackedResponse?.files ?? []),
        ];
        const response = combinedFiles.length
          ? { files: combinedFiles }
          : undefined;

        // Note: Rust backend returns "files" field
        if (response?.files) {
          const diffMap = new Map<string, GitFileDiffResult>(
            response.files.flatMap((diff) => {
              const decodedPath = decodeOctalPath(diff.file_path);
              return [
                [diff.file_path, diff] as const,
                [decodedPath, diff] as const,
                [getRelativePath(decodedPath, repoPath), diff] as const,
              ];
            })
          );

          setFiles((prev) => {
            const updates = new Map<string, GitFile>();

            prev.forEach((file) => {
              // Skip if already loaded
              if (file.oldContent !== undefined) return;

              // Check cache first
              const cached = diffCacheRef.current.get(file.id);
              if (cached) {
                updates.set(file.id, cached);
                return;
              }

              // Only apply a diff result that actually matches this file
              // by path. The historical "if both lengths are 1, just use
              // the only response" fallback was a bug: when iterating over
              // `prev` (the entire git-status file list, not just
              // `unloadedFiles`), it caused every still-unloaded file to
              // adopt the single response's stats and content — visible as
              // every row in the Source Control sidebar/All Changes view
              // showing the same `-N` deletion count after a single file
              // was opened. Drop the fallback and rely on path matching.
              const diff = getDiffLookupKeys(file.path, repoPath)
                .map((key) => diffMap.get(key))
                .find((value) => value !== undefined);
              if (!diff) return;

              let updatedFile: GitFile;

              if (diff.binary) {
                updatedFile = {
                  ...file,
                  oldContent: "Binary file - content not displayed",
                  newContent: "Binary file - content not displayed",
                  additions: 0,
                  deletions: 0,
                };
              } else if (diff.hunks?.length > 0) {
                // Determine if API returned meaningful content based on file status
                let oldContent: string;
                let newContent: string;

                const oldHasContent =
                  diff.old_content && diff.old_content.length > 0;
                const newHasContent =
                  diff.new_content && diff.new_content.length > 0;

                // Check if we have the expected content based on status
                const isAdded = diff.status === "added";
                const isDeleted = diff.status === "deleted";

                const apiProvidedValidContent =
                  (isAdded && newHasContent) ||
                  (isDeleted && oldHasContent) ||
                  (!isAdded && !isDeleted && (oldHasContent || newHasContent));

                if (apiProvidedValidContent) {
                  // API provided valid content
                  oldContent = diff.old_content || "";
                  newContent = diff.new_content || "";
                } else {
                  // Fallback: build from hunks
                  log.warn(
                    "[useDiffCache] Building from hunks for:",
                    file.path,
                    {
                      status: diff.status,
                      oldHasContent,
                      newHasContent,
                    }
                  );
                  const builtContent = buildContentFromHunks(diff.hunks);
                  oldContent = builtContent.oldContent;
                  newContent = builtContent.newContent;
                }

                updatedFile = {
                  ...file,
                  oldContent,
                  newContent,
                  additions: diff.insertions || 0,
                  deletions: diff.deletions || 0,
                };
              } else {
                updatedFile = {
                  ...file,
                  oldContent: diff.old_content ?? "",
                  newContent: diff.new_content ?? "",
                  additions: diff.insertions || 0,
                  deletions: diff.deletions || 0,
                };
              }

              // Cache and track update (evict oldest if over limit)
              if (diffCacheRef.current.size >= MAX_DIFF_CACHE_SIZE) {
                const firstKey = diffCacheRef.current.keys().next().value;
                if (firstKey) diffCacheRef.current.delete(firstKey);
              }
              diffCacheRef.current.set(file.id, updatedFile);
              updates.set(file.id, updatedFile);
            });

            // Only update state if there were actual changes
            if (updates.size === 0) {
              return prev;
            }

            // Apply updates
            return prev.map((file) => updates.get(file.id) || file);
          });
        }
      } catch (error) {
        log.error("[useDiffCache] Batch load error:", error);
      }
    },
    [selectedRepoId, repoPath, setFiles]
  );

  // Load diff when file is selected - prioritize selected file, then prefetch nearby.
  // Uses filesRef to read current files without depending on the array reference,
  // preventing redundant effect runs when gitStatusAtom produces a new array.
  useEffect(() => {
    const currentFiles = filesRef.current;
    if (!selectedFileId || !selectedRepoId || currentFiles.length === 0) return;

    const selectedIndex = currentFiles.findIndex(
      (file) => file.id === selectedFileId
    );
    if (selectedIndex === -1) return;

    const selectedFile = currentFiles[selectedIndex];

    // Check if already loaded
    if (selectedFile.oldContent !== undefined) {
      return;
    }

    // Check cache and restore
    const cached = diffCacheRef.current.get(selectedFileId);
    if (cached) {
      setFiles((prev) => {
        const currentFile = prev.find((file) => file.id === selectedFileId);
        if (currentFile?.oldContent !== undefined) {
          return prev;
        }
        return prev.map((file) => (file.id === selectedFileId ? cached : file));
      });
      return;
    }

    // Prevent concurrent batch loads
    if (batchLoadingRef.current) return;

    // Strategy: Load selected file immediately, then prefetch nearby files
    const loadSelectedAndPrefetch = async () => {
      batchLoadingRef.current = true;
      setLoadingFileId(selectedFileId);

      try {
        await batchLoadFileDiffs([selectedFile]);

        const filesToPrefetch: GitFile[] = [];
        for (let offset = 1; offset <= 4; offset++) {
          const file = currentFiles[selectedIndex + offset];
          if (
            file &&
            file.oldContent === undefined &&
            !diffCacheRef.current.get(file.id)
          ) {
            filesToPrefetch.push(file);
          }
        }

        if (filesToPrefetch.length > 0) {
          batchLoadFileDiffs(filesToPrefetch).catch((error) => {
            log.warn("[useDiffCache] Prefetch failed:", error);
          });
        }
      } finally {
        batchLoadingRef.current = false;
        setLoadingFileId(null);
      }
    };

    loadSelectedAndPrefetch();
  }, [selectedFileId, selectedRepoId, batchLoadFileDiffs, setFiles]);

  // Clear cache when repo changes
  useEffect(() => {
    diffCacheRef.current.clear();
  }, [selectedRepoId]);

  return {
    loadingFileId,
    diffCacheRef,
    batchLoadFileDiffs,
  };
}
