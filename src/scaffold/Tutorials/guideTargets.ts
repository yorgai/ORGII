export const GUIDE_TARGETS = {
  APP_ROOT: "app.root",
  SIDEBAR: "app.sidebar",
  WORKSTATION: "workstation.surface",
  WORKSTATION_TAB_BAR: "workstation.tabBar",
  WORKSTATION_TAB_HEADER: "workstation.tabHeader",
  WORKSTATION_DOCK: "workstation.dock",
  CHAT_PANEL: "chatPanel.surface",
  GUI_CONTROL_COMPOSER: "guiControl.composer",
  TUTORIALS_MODAL: "tutorials.modal",
} as const;

export type GuideTargetId = (typeof GUIDE_TARGETS)[keyof typeof GUIDE_TARGETS];
