/**
 * AllChangesView
 *
 * Aggregated diff list of every working-tree (or staged) file. Lifted out of
 * the old `GitAllChangesContent` component so it can be reused both inside
 * the unified Source Control tab (under the All Changes pill) and by
 * MessageViewer's chat-side preview.
 */
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { sourceControlFocusTargetAtom } from "@src/store/workstation/codeEditor";
import type { GitFile } from "@src/types/git/types";

import AllChangesFileSection from "./allChanges/AllChangesFileSection";
import { useAllChangesFiles } from "./allChanges/useAllChangesFiles";

export interface AllChangesViewProps {
  /** All git files to display */
  files: GitFile[];
  /** Loading state */
  loading: boolean;
  /** Whether showing staged changes */
  staged: boolean;
  /** Repository id for Git API requests */
  repoId?: string;
  /** Repository path - used to display relative paths */
  repoPath?: string;
  /** Open a file in its own diff tab */
  onFileSelect?: (path: string) => void;
  /** Monotonic signal from the global header collapse-all action. */
  collapseAllSignal?: number;
}

const AUTO_COLLAPSE_THRESHOLD = 0;

const AllChangesView: React.FC<AllChangesViewProps> = ({
  files,
  loading,
  staged,
  repoId,
  repoPath,
  onFileSelect,
  collapseAllSignal,
}) => {
  const { t } = useTranslation();
  const focusTarget = useAtomValue(sourceControlFocusTargetAtom);

  const { sortedFiles, loadContentForFile, getSectionRef } = useAllChangesFiles(
    { files, repoId, repoPath }
  );

  const previousCollapseAllSignalRef = useRef(collapseAllSignal);
  const lastScrolledFocusNonceRef = useRef<number | null>(null);
  const filesKey = files
    .map((file) => file.path)
    .sort()
    .join("|");

  const [collapseTrigger, setCollapseTrigger] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setCollapseTrigger(0));
  }, [filesKey]);

  useEffect(() => {
    if (previousCollapseAllSignalRef.current === collapseAllSignal) return;
    previousCollapseAllSignalRef.current = collapseAllSignal;
    queueMicrotask(() => setCollapseTrigger((prev) => prev + 1));
  }, [collapseAllSignal]);

  const shouldAutoCollapse = files.length > AUTO_COLLAPSE_THRESHOLD;

  const focusedFile = sortedFiles.find((file) => {
    if (!focusTarget) return false;
    const absolutePath = file.path.startsWith("/")
      ? file.path
      : repoPath
        ? `${repoPath}/${file.path}`
        : file.path;
    return absolutePath === focusTarget.path || file.path === focusTarget.path;
  });

  useEffect(() => {
    if (!focusTarget || !focusedFile) return;
    loadContentForFile(focusedFile);

    if (lastScrolledFocusNonceRef.current === focusTarget.nonce) return;
    lastScrolledFocusNonceRef.current = focusTarget.nonce;

    window.requestAnimationFrame(() => {
      const targetRef = getSectionRef(focusedFile.path);
      targetRef?.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    });
  }, [focusedFile, focusTarget, getSectionRef, loadContentForFile]);

  const handleRequestContent = useCallback(
    (file: GitFile) => {
      void loadContentForFile(file);
    },
    [loadContentForFile]
  );

  if (loading && files.length === 0) {
    return (
      <Placeholder
        variant="loading"
        placement="detail-panel"
        fillParentHeight
      />
    );
  }

  if (files.length === 0) {
    return (
      <Placeholder
        variant="empty"
        placement="detail-panel"
        title={
          staged
            ? t("placeholders.noStagedChanges")
            : t("placeholders.noChanges")
        }
        fillParentHeight
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        {sortedFiles.map((file) => {
          const isFocusedFile = focusedFile?.path === file.path;
          return (
            <AllChangesFileSection
              key={`${file.id}-${collapseTrigger}-${isFocusedFile ? (focusTarget?.nonce ?? 0) : 0}`}
              file={file}
              defaultExpanded={
                isFocusedFile ||
                (collapseTrigger > 0 ? false : !shouldAutoCollapse)
              }
              repoPath={repoPath}
              sectionRef={getSectionRef(file.path)}
              onFileSelect={onFileSelect}
              onRequestContent={handleRequestContent}
            />
          );
        })}
      </div>
    </div>
  );
};

export default memo(AllChangesView);
