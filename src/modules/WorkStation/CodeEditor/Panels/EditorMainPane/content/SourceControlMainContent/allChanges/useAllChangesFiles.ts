import { readTextFile } from "@tauri-apps/plugin-fs";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { gitApi } from "@src/api/http/git";
import type { GitFile } from "@src/types/git/types";
import { decodeOctalPath } from "@src/util/file/pathUtils";

import {
  countContentLines,
  getDiffLookupKeys,
  getEffectiveDiffStats,
  getEffectiveRepoPath,
  getRelativePath,
} from "./utils";

interface UseAllChangesFilesOptions {
  files: GitFile[];
  repoId?: string;
  repoPath?: string;
}

interface UseAllChangesFilesResult {
  filesWithDiffs: GitFile[];
  sortedFiles: GitFile[];
  loadContentForFile: (file: GitFile) => Promise<void>;
  getSectionRef: (path: string) => React.RefObject<HTMLDivElement | null>;
}

export function useAllChangesFiles({
  files,
  repoId,
  repoPath,
}: UseAllChangesFilesOptions): UseAllChangesFilesResult {
  const [filesWithDiffs, setFilesWithDiffs] = useState<GitFile[]>([]);

  const statsLoadedPathsRef = useRef<Set<string>>(new Set());
  const contentLoadedPathsRef = useRef<Set<string>>(new Set());
  const inFlightContentRef = useRef<Set<string>>(new Set());
  const previousFilesKeyRef = useRef("");
  const isLoadingStatsRef = useRef(false);
  const sectionRefs = useRef(
    new Map<string, React.RefObject<HTMLDivElement | null>>()
  );

  const filesKey = useMemo(
    () =>
      files
        .map((file) => file.path)
        .sort()
        .join("|"),
    [files]
  );

  // ------------------------------------------------------------
  // Stats-only batch load (cheap — no file content over the wire)
  // ------------------------------------------------------------
  const loadStatsForFiles = useCallback(
    async (filesToLoad: GitFile[]) => {
      if (!repoPath || filesToLoad.length === 0) return;
      if (isLoadingStatsRef.current) return;

      // Note: `useGitFiles` seeds every file with `additions: 0, deletions: 0`
      // (numeric, not undefined), so we cannot use those fields to detect
      // "stats not yet fetched". Gate purely on `statsLoadedPathsRef`.
      const unloadedFiles = filesToLoad.filter(
        (file) => !statsLoadedPathsRef.current.has(file.path)
      );
      if (unloadedFiles.length === 0) return;

      isLoadingStatsRef.current = true;

      try {
        // Group files by their effective repo root so worktree files are
        // fetched from the correct directory, not the host repo.
        const groups = new Map<string, GitFile[]>();
        for (const file of unloadedFiles) {
          const effectivePath = getEffectiveRepoPath(file, repoPath);
          const group = groups.get(effectivePath) ?? [];
          group.push(file);
          groups.set(effectivePath, group);
        }

        // NOTE: we request `include_content: true` even though only the
        // header stats are needed for collapsed rows. The Rust batch
        // endpoint computes `insertions / deletions` lazily from the diff
        // body itself — when called with `include_content: false` it
        // returns `0 / 0` for every file, so the headers would all read
        // "no changes". Holding the diff strings in memory is cheap; the
        // RAM-heavy work is rendering CodeMirror, which still happens
        // lazily when a section expands.
        const allResponses = await Promise.all(
          Array.from(groups.entries()).map(([groupRepoPath, groupFiles]) => {
            const resolvedRepoId = repoId ?? groupRepoPath;
            const filesInput = groupFiles.map((file) => ({
              path: getRelativePath(file.path, groupRepoPath),
              original_path: file.original_path ?? undefined,
            }));
            return gitApi
              .getGitBatchFileDiffs({
                repo_id: resolvedRepoId,
                repo_path: groupRepoPath,
                files: filesInput,
                from_ref: "HEAD",
                include_content: true,
                context_lines: 3,
              })
              .then((response) => ({ groupRepoPath, response }));
          })
        );

        type DiffEntry = NonNullable<
          Awaited<ReturnType<typeof gitApi.getGitBatchFileDiffs>>
        >["files"][0];
        const diffMap = new Map<string, DiffEntry>();
        for (const { groupRepoPath, response } of allResponses) {
          for (const diff of response?.files ?? []) {
            const decodedPath = decodeOctalPath(diff.file_path);
            diffMap.set(diff.file_path, diff);
            diffMap.set(decodedPath, diff);
            diffMap.set(getRelativePath(decodedPath, groupRepoPath), diff);
          }
        }

        const unmatchedUntracked: GitFile[] = [];

        setFilesWithDiffs((prev) =>
          prev.map((file) => {
            const effectivePath = getEffectiveRepoPath(file, repoPath);
            const diff = getDiffLookupKeys(file.path, effectivePath)
              .map((key) => diffMap.get(key))
              .find((value) => value !== undefined);
            if (!diff) {
              if (
                file.status === "added" &&
                !statsLoadedPathsRef.current.has(file.path)
              ) {
                unmatchedUntracked.push(file);
              }
              return file;
            }
            statsLoadedPathsRef.current.add(file.path);
            contentLoadedPathsRef.current.add(file.path);
            const oldContent = diff.old_content || "";
            const newContent = diff.new_content || "";
            const { additions, deletions } = getEffectiveDiffStats(
              file,
              diff,
              oldContent,
              newContent
            );
            return { ...file, additions, deletions, oldContent, newContent };
          })
        );

        if (unmatchedUntracked.length > 0) {
          await Promise.all(
            unmatchedUntracked.map(async (untrackedFile) => {
              try {
                const effectivePath = getEffectiveRepoPath(
                  untrackedFile,
                  repoPath
                );
                const absolutePath = untrackedFile.path.startsWith("/")
                  ? untrackedFile.path
                  : `${effectivePath}/${untrackedFile.path}`;
                const content = await readTextFile(absolutePath);
                statsLoadedPathsRef.current.add(untrackedFile.path);
                contentLoadedPathsRef.current.add(untrackedFile.path);
                const additions = countContentLines(content);
                setFilesWithDiffs((prev) =>
                  prev.map((entry) =>
                    entry.path === untrackedFile.path
                      ? {
                          ...entry,
                          oldContent: "",
                          newContent: content,
                          additions,
                          deletions: 0,
                        }
                      : entry
                  )
                );
              } catch (error) {
                console.error(
                  "[AllChangesView] Untracked disk read failed:",
                  untrackedFile.path,
                  error
                );
              }
            })
          );
        }
      } catch (error) {
        console.error("[AllChangesView] Failed to load stats:", error);
      } finally {
        isLoadingStatsRef.current = false;
      }
    },
    [repoId, repoPath]
  );

  // ------------------------------------------------------------
  // Single-file content load (triggered on section expand)
  // ------------------------------------------------------------
  const loadContentForFile = useCallback(
    async (file: GitFile) => {
      if (!repoPath) return;
      if (file.oldContent !== undefined || file.newContent !== undefined)
        return;
      if (contentLoadedPathsRef.current.has(file.path)) return;
      if (inFlightContentRef.current.has(file.path)) return;

      const effectivePath = getEffectiveRepoPath(file, repoPath);
      const resolvedRepoId = repoId ?? effectivePath;

      inFlightContentRef.current.add(file.path);

      try {
        const filesInput = [
          {
            path: getRelativePath(file.path, effectivePath),
            original_path: file.original_path ?? undefined,
          },
        ];
        const response = await gitApi.getGitBatchFileDiffs({
          repo_id: resolvedRepoId,
          repo_path: effectivePath,
          files: filesInput,
          from_ref: "HEAD",
          include_content: true,
          context_lines: 3,
        });

        if (response?.files) {
          const diffMap = new Map(
            response.files.flatMap((diff) => {
              const decodedPath = decodeOctalPath(diff.file_path);
              return [
                [diff.file_path, diff] as const,
                [decodedPath, diff] as const,
                [getRelativePath(decodedPath, effectivePath), diff] as const,
              ];
            })
          );

          const diff = getDiffLookupKeys(file.path, effectivePath)
            .map((key) => diffMap.get(key))
            .find((value) => value !== undefined);

          if (diff) {
            contentLoadedPathsRef.current.add(file.path);
            statsLoadedPathsRef.current.add(file.path);
            const newContent = diff.new_content || "";
            const oldContent = diff.old_content || "";
            const { additions, deletions } = getEffectiveDiffStats(
              file,
              diff,
              oldContent,
              newContent
            );
            setFilesWithDiffs((prev) =>
              prev.map((entry) =>
                entry.path === file.path
                  ? { ...entry, oldContent, newContent, additions, deletions }
                  : entry
              )
            );
          } else if (file.status === "added") {
            const absolutePath = file.path.startsWith("/")
              ? file.path
              : `${effectivePath}/${file.path}`;
            try {
              const content = await readTextFile(absolutePath);
              contentLoadedPathsRef.current.add(file.path);
              statsLoadedPathsRef.current.add(file.path);
              const additions = countContentLines(content);
              setFilesWithDiffs((prev) =>
                prev.map((entry) =>
                  entry.path === file.path
                    ? {
                        ...entry,
                        oldContent: "",
                        newContent: content,
                        additions,
                        deletions: 0,
                      }
                    : entry
                )
              );
            } catch (error) {
              console.error(
                "[AllChangesView] Untracked-file disk read failed:",
                file.path,
                absolutePath,
                error
              );
            }
          }
        }
      } catch (error) {
        console.error("[AllChangesView] Failed to load content:", error);
      } finally {
        inFlightContentRef.current.delete(file.path);
      }
    },
    [repoId, repoPath]
  );

  // Sync files state — preserve loaded diffs on polling updates
  useEffect(() => {
    if (previousFilesKeyRef.current !== filesKey) {
      previousFilesKeyRef.current = filesKey;
      statsLoadedPathsRef.current.clear();
      contentLoadedPathsRef.current.clear();
      inFlightContentRef.current.clear();
      setFilesWithDiffs(files);
    } else {
      setFilesWithDiffs((prev) => {
        const prevMap = new Map(prev.map((file) => [file.path, file]));
        return files.map((file) => {
          const previousFile = prevMap.get(file.path);
          if (!previousFile) return file;
          // Prefer the previously-loaded data over the freshly-polled
          // one. `useGitFiles` re-emits every file with `additions: 0,
          // deletions: 0, oldContent: undefined` on each git-status
          // poll; if we naively merged with `file.additions ?? previousFile.additions`
          // the numeric `0` would always win and wipe our loaded stats
          // back to zero.
          const previousLoadedStats = statsLoadedPathsRef.current.has(
            file.path
          );
          return {
            ...file,
            oldContent:
              previousFile.oldContent !== undefined
                ? previousFile.oldContent
                : file.oldContent,
            newContent:
              previousFile.newContent !== undefined
                ? previousFile.newContent
                : file.newContent,
            additions: previousLoadedStats
              ? previousFile.additions
              : file.additions,
            deletions: previousLoadedStats
              ? previousFile.deletions
              : file.deletions,
          };
        });
      });
    }

    loadStatsForFiles(files);
  }, [files, filesKey, loadStatsForFiles]);

  const sortedFiles = useMemo(() => {
    return [...filesWithDiffs].sort((fileA, fileB) =>
      fileA.path.localeCompare(fileB.path)
    );
  }, [filesWithDiffs]);

  const getSectionRef = useCallback((path: string) => {
    const existingRef = sectionRefs.current.get(path);
    if (existingRef) return existingRef;

    const nextRef = React.createRef<HTMLDivElement>();
    sectionRefs.current.set(path, nextRef);
    return nextRef;
  }, []);

  return { filesWithDiffs, sortedFiles, loadContentForFile, getSectionRef };
}
