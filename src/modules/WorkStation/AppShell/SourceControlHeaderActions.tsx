import { useAtomValue, useSetAtom } from "jotai";
import { History } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useRepoGitInitialization } from "@src/hooks/git";
import { WorkstationHeaderSectionSeparator } from "@src/modules/WorkStation/shared";
import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import { currentRepoAtom } from "@src/store/repo";
import { workStationPrimarySidebarCollapsedPersistAtom } from "@src/store/ui/workStationAtom";
import { activeStatusBarAppAtom } from "@src/store/ui/workStationLayout/statusBarAtoms";
import {
  sourceControlFilterModeAtom,
  sourceControlFilterModeHandlerAtom,
} from "@src/store/workstation/codeEditor/sourceControlFilterModeAtom";
import { activeWorkStationTabAtom } from "@src/store/workstation/tabs";

const SourceControlHeaderActionsComponent: React.FC = () => {
  const { t } = useTranslation("common");
  const activeApp = useAtomValue(activeStatusBarAppAtom);
  const activeTab = useAtomValue(activeWorkStationTabAtom);
  const currentRepo = useAtomValue(currentRepoAtom);
  const repoPath = currentRepo?.path ?? currentRepo?.fs_uri;
  const { isGitInitialized } = useRepoGitInitialization(repoPath);
  const filterMode = useAtomValue(sourceControlFilterModeAtom);
  const filterModeHandler = useAtomValue(sourceControlFilterModeHandlerAtom);
  const setSidebarCollapsed = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );

  const handleToggleHistory = useCallback(() => {
    const nextMode = filterMode === "history" ? "uncommitted" : "history";
    filterModeHandler?.(nextMode);
    setSidebarCollapsed(false);
  }, [filterMode, filterModeHandler, setSidebarCollapsed]);

  if (
    activeApp !== "code" ||
    activeTab?.type !== "source-control" ||
    isGitInitialized !== true
  ) {
    return null;
  }

  const active = filterMode === "history";
  const label = t("labels.gitHistory");

  return (
    <>
      <div
        className="flex shrink-0 items-center gap-px"
        data-tour-target={CODE_EDITOR_TOUR_TARGETS.gitHistory}
      >
        <Button
          htmlType="button"
          variant="tertiary"
          size="small"
          iconOnly
          className={active ? "!bg-fill-2 !text-primary-6" : ""}
          onClick={handleToggleHistory}
          title={label}
          aria-label={label}
          icon={<History size={HEADER_ICON_SIZE.sm} strokeWidth={2} />}
        />
      </div>
      <WorkstationHeaderSectionSeparator className="mx-1" />
    </>
  );
};

export const SourceControlHeaderActions = memo(
  SourceControlHeaderActionsComponent
);
SourceControlHeaderActions.displayName = "SourceControlHeaderActions";
