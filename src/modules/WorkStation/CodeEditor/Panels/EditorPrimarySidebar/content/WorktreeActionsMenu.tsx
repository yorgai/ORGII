import { MenuItem, Menu as TauriMenu } from "@tauri-apps/api/menu";
import { Ellipsis, Trash2 } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import {
  FOLDER_HEADER,
  PRIMARY_SIDEBAR_HOVER,
} from "@src/modules/WorkStation/shared/tokens";

interface WorktreeActionsMenuProps {
  onRemove: () => void;
}

export const WorktreeActionsMenu: React.FC<WorktreeActionsMenuProps> = memo(
  ({ onRemove }) => {
    const { t } = useTranslation();
    const {
      isOpen,
      isPositioned,
      toggle,
      close,
      triggerRef,
      panelRef,
      panelPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      gap: DROPDOWN_PANEL.triggerGapTight,
      placement: "bottom",
      align: "right",
    });

    const handleRemove = useCallback(() => {
      close();
      onRemove();
    }, [close, onRemove]);

    const triggerRightEdge = panelPosition.left + panelPosition.width;
    const viewportWidth =
      typeof document !== "undefined"
        ? document.documentElement.clientWidth
        : 0;

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          className={FOLDER_HEADER.action}
          title={t("sourceControl.worktreeActions")}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          <Ellipsis size={14} className="text-text-3" />
        </button>

        {isOpen &&
          isPositioned &&
          createPortal(
            <div
              ref={panelRef}
              className={`${DROPDOWN_CLASSES.panel} ${DROPDOWN_WIDTHS.sidebarMenuClass} ${DROPDOWN_PANEL.paddingClass}`}
              style={{
                position: "fixed",
                top: panelPosition.top,
                right: viewportWidth - triggerRightEdge,
                zIndex: DROPDOWN_PANEL.zIndex,
              }}
            >
              <div className={DROPDOWN_CLASSES.itemsColumn}>
                <button
                  type="button"
                  className={`${DROPDOWN_CLASSES.item} ${PRIMARY_SIDEBAR_HOVER.row} w-full text-danger-6`}
                  onClick={handleRemove}
                >
                  <Trash2 size={DROPDOWN_ITEM.iconSize} className="shrink-0" />
                  <span className="truncate">
                    {t("sourceControl.removeWorktree")}
                  </span>
                </button>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
);

WorktreeActionsMenu.displayName = "WorktreeActionsMenu";

export interface WorktreeContextMenuProps {
  onRemove: () => void;
  onClose: () => void;
}

export function WorktreeContextMenu({
  onRemove,
  onClose,
}: WorktreeContextMenuProps) {
  const { t } = useTranslation();
  const hasShownMenu = useRef(false);

  useEffect(() => {
    if (hasShownMenu.current) return;
    hasShownMenu.current = true;

    async function showMenu() {
      try {
        const removeItem = await MenuItem.new({
          text: t("sourceControl.removeWorktree"),
          action: () => {
            onRemove();
          },
        });
        const menu = await TauriMenu.new({ items: [removeItem] });
        await menu.popup();
      } finally {
        onClose();
      }
    }

    showMenu();
  }, [onClose, onRemove, t]);

  return null;
}

export default WorktreeActionsMenu;
