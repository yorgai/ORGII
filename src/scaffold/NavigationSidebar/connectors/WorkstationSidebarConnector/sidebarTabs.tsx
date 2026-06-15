import type { TFunction } from "i18next";
import { Folders, House, MessageCircle, Network } from "lucide-react";
import React, { useMemo } from "react";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

import type { WorkstationSidebarKey } from "./types";

export function isWorkstationSidebarKey(
  key: string
): key is WorkstationSidebarKey {
  return key === "folders" || key === "workstation" || key === "projects";
}

export function useWorkstationSidebarTabs(t: TFunction<"navigation">) {
  return useMemo(
    () => [
      {
        key: "folders",
        label: t("labels.folders"),
        icon: Folders,
        iconName: "folders",
      },
      {
        key: "workstation",
        label: t("labels.session"),
        icon: MessageCircle,
        iconName: "message-circle",
      },
      {
        key: "projects",
        label: t("labels.org"),
        icon: Network,
        iconName: "network",
      },
    ],
    [t]
  );
}

export function SidebarSearchShortcutTooltip({
  searchLabel,
}: {
  searchLabel: string;
}): React.ReactElement {
  return (
    <KeyboardShortcutTooltipContent
      rows={[
        { label: "Spotlight", shortcut: getShortcutKeys("spotlight_open") },
        {
          label: `${searchLabel} session`,
          shortcut: getShortcutKeys("agent_session_search"),
        },
      ]}
    />
  );
}

export function HomeHeaderAction({
  label,
  tooltipLabel,
  onClick,
}: {
  label: string;
  tooltipLabel: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip
      content={<KeyboardShortcutTooltipContent label={tooltipLabel} />}
      position="bottom"
      mouseEnterDelay={200}
      framedPanel
    >
      <div className="inline-flex">
        <button
          type="button"
          className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
          onClick={onClick}
          aria-label={label}
        >
          <House size={16} strokeWidth={2} className="text-text-2" />
        </button>
      </div>
    </Tooltip>
  );
}
