/**
 * SimulatorWorkstationTabHeader
 *
 * Shared 40px global tab-header strip rendered immediately below the
 * {@link ReplayTabBar} in simulator replay views (Agent Station's Code
 * Editor, Browser, Database Manager, Project Manager, Communication).
 * Mirrors My Station's `WorkstationTabHeader` so the chrome shape stays
 * identical across products.
 *
 * Layout:
 *   [ sidebar toggle ] [ leading ] [ content ] [ trailing ]
 *
 * Why a single shared component (vs. per-app inline headers): every
 * simulator app needs the same sidebar toggle in the same position and
 * the same alignment with the app-switcher chip directly above it.
 * Lifting the toggle here also keeps the {@link ReplayTabBar}
 * `leadingSlot` lean — just the app-switcher chip — matching the My
 * Station shell.
 *
 * Right-side content is published by the active simulator pane via
 * `usePublishWorkstationTabHeader({ host: "simulator", ... })` (typically
 * indirectly through `<FileHeader publishToHost="simulator" />`). Routing
 * through an atom — instead of a prop — lets nested components like
 * `CodePanel` teleport their existing breadcrumb into this strip without
 * the simulator entry having to know which sub-mode is active.
 */
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { sessionIdAtom } from "@src/engines/SessionCore";
import { useFileReviewBatchActions } from "@src/hooks/fileReview";
import { workstationTabHeaderAtomByHost } from "@src/store/workstation";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import { NoDragRegion } from "../NoDragRegion";
import { SimulatorSidebarToggleButton } from "../SidebarToggleButton";
import { WorkstationHeaderSectionSeparator } from "../WorkstationHeaderSectionSeparator";
import { WorkstationTabHeaderSlotsView } from "../WorkstationTabHeaderSlotsView";

export interface SimulatorWorkstationTabHeaderProps {
  showSidebarToggle?: boolean;
  sidebarToggleDisabled?: boolean;
}

const SimulatorWorkstationTabHeaderComponent: React.FC<
  SimulatorWorkstationTabHeaderProps
> = ({ showSidebarToggle = true, sidebarToggleDisabled = false }) => {
  const { t } = useTranslation("common");
  const headerSlots = useAtomValue(workstationTabHeaderAtomByHost.simulator);
  const globalSessionId = useAtomValue(sessionIdAtom);
  const { pendingCount, onUndoAll } =
    useFileReviewBatchActions(globalSessionId);
  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleUndoAll = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: t("actions.undoAll"),
      message: t("confirmation.undoAllChanges", { count: pendingCount }),
      okLabel: t("actions.undoAll"),
      cancelLabel: t("actions.cancel"),
    });
    if (!confirmed) return;
    setIsUndoingAll(true);
    try {
      await onUndoAll();
    } finally {
      if (mountedRef.current) setIsUndoingAll(false);
    }
  }, [t, pendingCount, onUndoAll]);

  const showUndoAll = pendingCount > 0 && !isUndoingAll;

  // Border lives on this row (not on `ReplayTabBar` above) so the chrome
  // shape mirrors My Station: tab bar transparent, header strip carries
  // the single separator line under the whole tabbar+header block.
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border-2 pl-1.5 pr-2"
      data-tauri-drag-region
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <NoDragRegion className="flex w-7 shrink-0 items-center justify-center">
        {showSidebarToggle ? (
          <SimulatorSidebarToggleButton
            iconSize={14}
            disabled={sidebarToggleDisabled}
          />
        ) : null}
      </NoDragRegion>
      <WorkstationHeaderSectionSeparator />
      <WorkstationTabHeaderSlotsView slots={headerSlots} />
      {showUndoAll && (
        <NoDragRegion className="ml-auto flex shrink-0 items-center">
          <Button
            htmlType="button"
            variant="tertiary"
            size="small"
            iconOnly
            onClick={handleUndoAll}
            title={t("actions.undoAll")}
            icon={<X size={14} strokeWidth={1.75} />}
          />
        </NoDragRegion>
      )}
    </div>
  );
};

export const SimulatorWorkstationTabHeader = memo(
  SimulatorWorkstationTabHeaderComponent
);
SimulatorWorkstationTabHeader.displayName = "SimulatorWorkstationTabHeader";

export default SimulatorWorkstationTabHeader;
