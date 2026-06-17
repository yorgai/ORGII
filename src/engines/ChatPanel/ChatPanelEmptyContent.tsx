import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React from "react";

import { SESSION_CREATOR_LAUNCH_MODE } from "@src/features/SessionCreator/types";
import CreateCollabOrgView from "@src/features/TeamCollaboration/components/CreateCollabOrgView";
import type { CreatedOrgResult } from "@src/features/TeamCollaboration/components/CreateCollabOrgView";
import CreateProjectView from "@src/modules/ProjectManager/Projects/components/CreateProjectView";
import CreateWorkItemView, {
  type CreatedWorkItemResult,
} from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanelAtom";
import { primaryWorkspaceRootAtom } from "@src/store/workspace";
import {
  PROJECT_CREATOR_DRAFT_ID,
  type WorkItemDraft,
} from "@src/store/workstation/projectManager";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs";

import { ChatPanelStartPage } from "./ChatPanelStartPage";
import { BenchmarkRunBuilder } from "./panels/BenchmarkRunBuilder";
import type { ChatPanelProps, ChatPanelRegionNotice } from "./types";

type SessionCreatorSlot = NonNullable<ChatPanelProps["sessionCreatorSlot"]>;

interface DefaultAiWorkItemAssignee {
  id: string;
  name: string;
  type: "agent" | "org";
  agentDefinitionId?: string;
}

interface WorkspaceScopedCreateContext {
  workspaceName: string | undefined;
  workspacePath: string | null;
}

function WorkspaceScopedContent({
  children,
}: {
  children: (context: WorkspaceScopedCreateContext) => React.ReactNode;
}): React.ReactNode {
  const workspaceRoot = useAtomValue(primaryWorkspaceRootAtom);
  const workspacePath = workspaceRoot?.path ?? null;
  const workspaceName = workspaceRoot?.name ?? undefined;

  return <>{children({ workspaceName, workspacePath })}</>;
}

interface ChatPanelEmptyContentProps {
  benchmarkFooter: React.ReactNode;
  benchmarkPanel: React.ReactNode;
  createProjectContext: ChatPanelCreateProjectContext | null;
  createTarget: ChatPanelCreateTarget;
  creatorClassName: string;
  showStartPage: boolean;
  creatorVariant: "default" | "fullScreen";
  defaultAiWorkItemAssignee: DefaultAiWorkItemAssignee | null;
  handleAiWorkItemSessionStart: NonNullable<
    React.ComponentProps<SessionCreatorSlot>["onSessionStart"]
  >;
  handleCancelWorkItemCreate: () => void;
  handleCancelCollabOrgCreate: () => void;
  handleChatPanelProjectCreated: (options?: { keepOpen?: boolean }) => void;
  handleChatPanelCollabOrgCreated: (result: CreatedOrgResult) => void;
  handleChatPanelWorkItemCreated: (result?: CreatedWorkItemResult) => void;
  handleRegionNoticeChange: (notice: ChatPanelRegionNotice | null) => void;
  handleStartPageAddApiKey: () => void;
  handleStartPageAgents: () => void;
  handleStartPageNewSession: () => void;
  handleStartPageNewWorkItem: () => void;
  handleStartPageSetupRepo: () => void;
  handleWorkItemAgentCreatorToggle: (enabled: boolean) => void;
  resolveAiWorkItemContext: NonNullable<
    React.ComponentProps<SessionCreatorSlot>["resolveWorkItemContext"]
  >;
  SessionCreatorSlot?: ChatPanelProps["sessionCreatorSlot"];
  setWorkItemCreateDraft: (draft: WorkItemDraft | null) => void;
  showProjectAgentCreator: boolean;
  showWorkItemAgentCreator: boolean;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

export function ChatPanelEmptyContent({
  benchmarkFooter,
  benchmarkPanel,
  createProjectContext,
  createTarget,
  creatorClassName,
  showStartPage,
  creatorVariant,
  defaultAiWorkItemAssignee,
  handleAiWorkItemSessionStart,
  handleCancelWorkItemCreate,
  handleCancelCollabOrgCreate,
  handleChatPanelProjectCreated,
  handleChatPanelCollabOrgCreated,
  handleChatPanelWorkItemCreated,
  handleRegionNoticeChange,
  handleStartPageAddApiKey,
  handleStartPageAgents,
  handleStartPageNewSession,
  handleStartPageNewWorkItem,
  handleStartPageSetupRepo,
  handleWorkItemAgentCreatorToggle,
  resolveAiWorkItemContext,
  SessionCreatorSlot,
  setWorkItemCreateDraft,
  showProjectAgentCreator,
  showWorkItemAgentCreator,
  t,
}: ChatPanelEmptyContentProps): React.ReactNode {
  if (showStartPage) {
    return (
      <ChatPanelStartPage
        onAddApiKey={handleStartPageAddApiKey}
        onAgents={handleStartPageAgents}
        onNewSession={handleStartPageNewSession}
        onNewWorkItem={handleStartPageNewWorkItem}
        onSetupRepo={handleStartPageSetupRepo}
        t={t}
      />
    );
  }

  if (createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT) {
    const sessionCreatorContent =
      showProjectAgentCreator && SessionCreatorSlot ? (
        <SessionCreatorSlot
          className="min-h-0 flex-1"
          variant={creatorVariant}
          centerFullScreenContent
          hidePresenceButton
          launchMode={SESSION_CREATOR_LAUNCH_MODE.START_BACKGROUND}
          onRegionNoticeChange={handleRegionNoticeChange}
        />
      ) : null;

    return (
      <WorkspaceScopedContent>
        {({ workspaceName, workspacePath }) => (
          <div className={`flex flex-col overflow-hidden ${creatorClassName}`}>
            <div className="shrink-0 overflow-hidden">
              <CreateProjectView
                tabId={PROJECT_CREATOR_DRAFT_ID}
                repoPath={workspacePath ?? undefined}
                repoName={workspaceName}
                scopeBreadcrumbLabel={
                  createProjectContext?.scopeBreadcrumbLabel ??
                  t("projects:orgs.personalOrg")
                }
                orgId={
                  createProjectContext?.orgId ?? STORY_PERSONAL_ORG_FILTER_ID
                }
                onSetUnsaved={() => undefined}
                onProjectCreated={handleChatPanelProjectCreated}
                aiGenerateMode={showProjectAgentCreator}
              />
            </div>
            {sessionCreatorContent ? (
              <div className="min-h-0 flex-1 overflow-hidden pt-6">
                {sessionCreatorContent}
              </div>
            ) : null}
          </div>
        )}
      </WorkspaceScopedContent>
    );
  }

  if (createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
    const sessionCreatorContent =
      showWorkItemAgentCreator && SessionCreatorSlot ? (
        <SessionCreatorSlot
          className="min-h-0 flex-1"
          variant={creatorVariant}
          centerFullScreenContent
          hidePresenceButton
          launchMode={SESSION_CREATOR_LAUNCH_MODE.START_BACKGROUND}
          onRegionNoticeChange={handleRegionNoticeChange}
          onSessionStart={handleAiWorkItemSessionStart}
          resolveWorkItemContext={resolveAiWorkItemContext}
        />
      ) : null;

    return (
      <WorkspaceScopedContent>
        {({ workspacePath }) => {
          const workItemCreator = (
            <CreateWorkItemView
              repoPath={workspacePath}
              onCancel={handleCancelWorkItemCreate}
              onSetUnsaved={() => undefined}
              onWorkItemCreated={handleChatPanelWorkItemCreated}
              onDraftChange={setWorkItemCreateDraft}
              showCloseAction={false}
              propertiesOpen={false}
              showPropertiesAction={false}
              aiGenerateMode={showWorkItemAgentCreator}
              onAiGenerateModeChange={handleWorkItemAgentCreatorToggle}
              showAiModePanel={false}
              showFooter
              chatPanelFooter
              defaultAiAssignee={defaultAiWorkItemAssignee}
            />
          );

          if (sessionCreatorContent) {
            return (
              <div
                className={`flex flex-col overflow-hidden ${creatorClassName}`}
              >
                <div className="shrink-0 overflow-hidden">
                  {workItemCreator}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden pt-6">
                  {sessionCreatorContent}
                </div>
              </div>
            );
          }

          return (
            <div className={`flex overflow-hidden ${creatorClassName}`}>
              {workItemCreator}
            </div>
          );
        }}
      </WorkspaceScopedContent>
    );
  }

  if (createTarget === CHAT_PANEL_CREATE_TARGET.COLLAB_ORG) {
    return (
      <div className={`flex overflow-hidden ${creatorClassName}`}>
        <CreateCollabOrgView
          onCancel={handleCancelCollabOrgCreate}
          onCreated={handleChatPanelCollabOrgCreated}
        />
      </div>
    );
  }

  if (createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK) {
    return (
      <BenchmarkRunBuilder
        className={creatorClassName}
        bodySlot={benchmarkPanel}
        footerSlot={benchmarkFooter}
      />
    );
  }

  if (SessionCreatorSlot) {
    return (
      <SessionCreatorSlot
        className={creatorClassName}
        variant={creatorVariant}
        centerFullScreenContent
        hidePresenceButton
        onRegionNoticeChange={handleRegionNoticeChange}
      />
    );
  }

  return null;
}
