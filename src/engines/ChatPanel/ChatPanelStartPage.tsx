import type { TFunction } from "i18next";
import {
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  FolderGit2,
  KeyRound,
  MessageSquarePlus,
} from "lucide-react";
import React from "react";

interface ChatPanelStartPageAction {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface ChatPanelStartPageProps {
  onAddApiKey: () => void;
  onAgents: () => void;
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
      className="group flex w-full items-center gap-2.5 rounded-xl border border-border-1 bg-chat-container/70 px-2.5 py-2 text-left shadow-sm transition-colors hover:border-border-2 hover:bg-surface-hover"
      onClick={action.onClick}
      data-testid={`chat-panel-start-page-${action.id}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-2 text-text-1 transition-colors group-hover:bg-fill-3">
        {action.icon}
      </span>
      <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
        {action.title}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-text-4 transition-colors group-hover:text-text-2"
      />
    </button>
  );
}

export function ChatPanelStartPage({
  onAddApiKey,
  onAgents,
  onNewSession,
  onNewWorkItem,
  onSetupRepo,
  t,
}: ChatPanelStartPageProps): React.ReactNode {
  const actions: ChatPanelStartPageAction[] = [
    {
      id: "new-session",
      title: t("chat.startPage.newSession.title"),
      icon: <MessageSquarePlus size={16} strokeWidth={1.8} />,
      onClick: onNewSession,
    },
    {
      id: "new-work-item",
      title: t("chat.startPage.newWorkItem.title"),
      icon: <BriefcaseBusiness size={16} strokeWidth={1.8} />,
      onClick: onNewWorkItem,
    },
    {
      id: "setup-repo",
      title: t("chat.startPage.setupRepo.title"),
      icon: <FolderGit2 size={16} strokeWidth={1.8} />,
      onClick: onSetupRepo,
    },
    {
      id: "add-api-key",
      title: t("chat.startPage.addApiKey.title"),
      icon: <KeyRound size={16} strokeWidth={1.8} />,
      onClick: onAddApiKey,
    },
    {
      id: "agents",
      title: t("chat.startPage.agents.title"),
      icon: <Bot size={16} strokeWidth={1.8} />,
      onClick: onAgents,
    },
  ];

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col justify-center overflow-hidden px-3 py-5"
      data-testid="chat-panel-start-page"
    >
      <div className="mx-auto flex w-full max-w-[400px] flex-col gap-3">
        <div className="px-1">
          <h2 className="m-0 text-base font-semibold text-text-1">
            {t("chat.startPage.title")}
          </h2>
        </div>
        <div className="flex flex-col gap-1.5">
          {actions.map((action) => (
            <StartPageActionCard key={action.id} action={action} />
          ))}
        </div>
      </div>
    </div>
  );
}
