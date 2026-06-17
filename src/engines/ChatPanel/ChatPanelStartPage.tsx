import type { TFunction } from "i18next";
import {
  BriefcaseBusiness,
  ChevronRight,
  FolderGit2,
  MessageSquarePlus,
} from "lucide-react";
import React from "react";

interface ChatPanelStartPageAction {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface ChatPanelStartPageProps {
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
      className="group flex w-full items-center gap-3 rounded-2xl border border-border-1 bg-chat-container/70 p-3 text-left shadow-sm transition-colors hover:border-border-2 hover:bg-surface-hover"
      onClick={action.onClick}
      data-testid={`chat-panel-start-page-${action.id}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-2 text-text-1 transition-colors group-hover:bg-fill-3">
        {action.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-text-1">
          {action.title}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-text-3">
          {action.description}
        </span>
      </span>
      <ChevronRight
        size={16}
        strokeWidth={1.8}
        className="shrink-0 text-text-4 transition-colors group-hover:text-text-2"
      />
    </button>
  );
}

export function ChatPanelStartPage({
  onNewSession,
  onNewWorkItem,
  onSetupRepo,
  t,
}: ChatPanelStartPageProps): React.ReactNode {
  const actions: ChatPanelStartPageAction[] = [
    {
      id: "new-session",
      title: t("chat.startPage.newSession.title"),
      description: t("chat.startPage.newSession.description"),
      icon: <MessageSquarePlus size={18} strokeWidth={1.8} />,
      onClick: onNewSession,
    },
    {
      id: "new-work-item",
      title: t("chat.startPage.newWorkItem.title"),
      description: t("chat.startPage.newWorkItem.description"),
      icon: <BriefcaseBusiness size={18} strokeWidth={1.8} />,
      onClick: onNewWorkItem,
    },
    {
      id: "setup-repo",
      title: t("chat.startPage.setupRepo.title"),
      description: t("chat.startPage.setupRepo.description"),
      icon: <FolderGit2 size={18} strokeWidth={1.8} />,
      onClick: onSetupRepo,
    },
  ];

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col justify-center overflow-hidden px-3 py-6"
      data-testid="chat-panel-start-page"
    >
      <div className="mx-auto flex w-full max-w-[460px] flex-col gap-4">
        <div className="px-1">
          <h2 className="m-0 text-base font-semibold text-text-1">
            {t("chat.startPage.title")}
          </h2>
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
