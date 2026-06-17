import type { TFunction } from "i18next";
import {
  BriefcaseBusiness,
  ChevronRight,
  FolderGit2,
  KeyRound,
  MessageSquarePlus,
  Search,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import TabPill from "@src/components/TabPill";

type StartPageTabKey = "work" | "explore";

interface ChatPanelStartPageAction {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface ChatPanelStartPageProps {
  className?: string;
  onAddApiKey: () => void;
  onExploreRepos: () => void;
  onNewSession: () => void;
  onNewWorkItem: () => void;
  onSetupRepo: () => void;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

function StartPageActionCard({
  action,
}: {
  action: ChatPanelStartPageAction;
}): React.ReactNode {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-full border border-border-1 bg-chat-container/70 p-2 text-left shadow-sm transition-colors hover:border-border-2 hover:bg-surface-hover"
      onClick={action.onClick}
      data-testid={`chat-panel-start-page-${action.id}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-2 text-text-1 transition-colors group-hover:bg-fill-3">
        {action.icon}
      </span>
      <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
        {action.title}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-primary-6 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

export function ChatPanelStartPage({
  className,
  onAddApiKey,
  onExploreRepos,
  onNewSession,
  onNewWorkItem,
  onSetupRepo,
  t,
}: ChatPanelStartPageProps): React.ReactNode {
  const [activeTab, setActiveTab] = useState<StartPageTabKey>("work");
  const tabs = useMemo(
    () => [
      { key: "work", label: t("chat.startPage.tabs.work") },
      { key: "explore", label: t("chat.startPage.tabs.explore") },
    ],
    [t]
  );
  const workActions: ChatPanelStartPageAction[] = [
    {
      id: "new-session",
      title: t("chat.startPage.newSession.title"),
      icon: <MessageSquarePlus size={13} strokeWidth={1.8} />,
      onClick: onNewSession,
    },
    {
      id: "new-work-item",
      title: t("chat.startPage.newWorkItem.title"),
      icon: <BriefcaseBusiness size={13} strokeWidth={1.8} />,
      onClick: onNewWorkItem,
    },
    {
      id: "add-api-key",
      title: t("chat.startPage.addApiKey.title"),
      icon: <KeyRound size={13} strokeWidth={1.8} />,
      onClick: onAddApiKey,
    },
  ];
  const exploreActions: ChatPanelStartPageAction[] = [
    {
      id: "setup-repo",
      title: t("chat.startPage.setupRepo.title"),
      icon: <FolderGit2 size={13} strokeWidth={1.8} />,
      onClick: onSetupRepo,
    },
    {
      id: "explore-repos",
      title: t("chat.startPage.exploreRepos.title"),
      icon: <Search size={13} strokeWidth={1.8} />,
      onClick: onExploreRepos,
    },
  ];
  const actions = activeTab === "work" ? workActions : exploreActions;

  return (
    <div
      className={`flex w-full flex-col justify-center overflow-hidden px-3 py-5 ${className ?? ""}`}
      data-testid="chat-panel-start-page"
    >
      <div className="mx-auto flex w-full max-w-[400px] -translate-y-5 flex-col gap-3">
        <div className="flex justify-start px-1">
          <TabPill
            variant="simple"
            size="large"
            fillWidth={false}
            tabs={tabs}
            activeTab={activeTab}
            onChange={(key) => setActiveTab(key as StartPageTabKey)}
          />
        </div>
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <StartPageActionCard key={action.id} action={action} />
          ))}
        </div>
      </div>
    </div>
  );
}
