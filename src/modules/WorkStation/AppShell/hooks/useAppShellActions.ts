import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Message from "@src/components/Message";
import { ROUTES } from "@src/config/routes";
import { workstationLayoutAtom } from "@src/store/workstation/tabs/atoms";
import { createSettingsTab } from "@src/store/workstation/tabs/factories";
import { openTab as openTabMutation } from "@src/store/workstation/tabs/tabMutations";
import type { WorkStationLayoutState } from "@src/store/workstation/tabs/types";

interface AppShellActions {
  handleSelectRepo: () => void;
  handleOpenSettings: () => void;
}

export function useAppShellActions(): AppShellActions {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setLayout = useSetAtom(workstationLayoutAtom);

  const handleSelectRepo = useCallback(() => {
    navigate(ROUTES.app.home.start.path);
    Message.info(t("workstation.selectRepoFromHome"));
  }, [navigate, t]);

  const handleOpenSettings = useCallback(() => {
    const settingsTab = createSettingsTab();
    setLayout((layout: WorkStationLayoutState) => {
      if (!layout?.mainPane) return layout;
      return {
        ...layout,
        mainPane: openTabMutation(layout.mainPane, settingsTab),
      };
    });
  }, [setLayout]);

  return { handleSelectRepo, handleOpenSettings };
}
