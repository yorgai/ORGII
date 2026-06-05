import type { TFunction } from "i18next";
import React from "react";

import { SESSION_CREATOR_LAUNCH_MODE } from "@src/features/SessionCreator/types";
import CreateProjectView from "@src/modules/ProjectManager/Projects/components/CreateProjectView";
import CreateWorkItemView, {
  type CreatedWorkItemResult,
} from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanelAtom";
import {
  PROJECT_CREATOR_DRAFT_ID,
  type WorkItemDraft,
} from "@src/store/workstation/projectManager";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs";

import { BenchmarkRunBuilder } from "./BenchmarkRunBuilder";
import type { ChatPanelProps, ChatPanelRegionNotice } from "./types";

type SessionCreatorSlot = NonNullable<ChatPanelProps["sessionCreatorSlot"]>;

interface DefaultAiWorkItemAssignee {
  id: string;
  name: string;
  type: "agent" | "org";
  agentDefinitionId?: string;
}

interface ChatPanelEmptyContentProps {
  benchmarkPanel: React.ReactNode;
  createProjectContext: ChatPanelCreateProjectContext | null;
  createTarget: ChatPanelCreateTarget;
  creatorClassName: string;
  creatorVariant: "default" | "fullScreen";
  currentRepoName: string | undefined;
  currentRepoPath: string | null;
  defaultAiWorkItemAssignee: DefaultAiWorkItemAssignee | null;
  handleAiWorkItemSessionStart: NonNullable<
    React.ComponentProps<SessionCreatorSlot>["onSessionStart"]
  >;
  handleCancelWorkItemCreate: () => void;
  handleChatPanelProjectCreated: (options?: { keepOpen?: boolean }) => void;
  handleChatPanelWorkItemCreated: (result?: CreatedWorkItemResult) => void;
  handleRegionNoticeChange: (notice: ChatPanelRegionNotice | null) => void;
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
  benchmarkPanel,
  createProjectContext,
  createTarget,
  creatorClassName,
  creatorVariant,
  currentRepoName,
  currentRepoPath,
  defaultAiWorkItemAssignee,
  handleAiWorkItemSessionStart,
  handleCancelWorkItemCreate,
  handleChatPanelProjectCreated,
  handleChatPanelWorkItemCreated,
  handleRegionNoticeChange,
  handleWorkItemAgentCreatorToggle,
  resolveAiWorkItemContext,
  SessionCreatorSlot,
  setWorkItemCreateDraft,
  showProjectAgentCreator,
  showWorkItemAgentCreator,
  t,
}: ChatPanelEmptyContentProps): React.ReactNode {
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
      <div className={`flex flex-col overflow-hidden ${creatorClassName}`}>
        <div className="shrink-0 overflow-hidden">
          <CreateProjectView
            tabId={PROJECT_CREATOR_DRAFT_ID}
            repoPath={currentRepoPath ?? undefined}
            repoName={currentRepoName}
            scopeBreadcrumbLabel={
              createProjectContext?.scopeBreadcrumbLabel ??
              t("projects:orgs.personalOrg")
            }
            orgId={createProjectContext?.orgId ?? STORY_PERSONAL_ORG_FILTER_ID}
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

    const workItemCreator = (
      <CreateWorkItemView
        repoPath={currentRepoPath}
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
        <div className={`flex flex-col overflow-hidden ${creatorClassName}`}>
          <div className="shrink-0 overflow-hidden">{workItemCreator}</div>
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
  }

  if (createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK) {
    return (
      <BenchmarkRunBuilder
        className={creatorClassName}
        footerSlot={benchmarkPanel}
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
        batchStartMode={createTarget === CHAT_PANEL_CREATE_TARGET.BATCH_START}
      />
    );
  }

  return null;
}
