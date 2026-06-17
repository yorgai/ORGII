import type { TFunction } from "i18next";
import { useCallback, useMemo } from "react";

import type { SelectOption } from "@src/components/Select";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import { SESSION_TARGET_KIND } from "@src/store/session";
import type { SessionCreatorState } from "@src/store/session/creatorStateAtom";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanelAtom";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";

const ADE_MANAGER_DEF_ID = "builtin:agent-architect";

interface UseChatPanelCreateTargetOptions {
  allAgentDefs: AgentDefinition[];
  handleNewSession: () => void;
  sessionCreatorAvailable: boolean;
  setCreateTarget: (target: ChatPanelCreateTarget) => void;
  setCreatorState: (
    updater: (previous: SessionCreatorState) => SessionCreatorState
  ) => void;
  setStartPageOpen: (open: boolean) => void;
  setShowProjectAgentCreator: (enabled: boolean) => void;
  setShowWorkItemAgentCreator: (enabled: boolean) => void;
  setWorkItemCreateDraft: (draft: WorkItemDraft | null) => void;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

export function useChatPanelCreateTarget({
  allAgentDefs,
  handleNewSession,
  sessionCreatorAvailable,
  setCreateTarget,
  setCreatorState,
  setStartPageOpen,
  setShowProjectAgentCreator,
  setShowWorkItemAgentCreator,
  setWorkItemCreateDraft,
  t,
}: UseChatPanelCreateTargetOptions) {
  const createTargetOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: CHAT_PANEL_CREATE_TARGET.AGENT_SESSION,
        label: t("creator.createTarget.agentSession"),
        dataTestId: "chat-panel-create-target-agent-session-option",
      },
      {
        value: CHAT_PANEL_CREATE_TARGET.CREATE_AGENT,
        label: t("creator.createTarget.createAgent"),
        dataTestId: "chat-panel-create-target-create-agent-option",
      },
      {
        value: CHAT_PANEL_CREATE_TARGET.PROJECT,
        label: t("creator.createTarget.project"),
        dataTestId: "chat-panel-create-target-project-option",
      },
      {
        value: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
        label: t("creator.createTarget.workItem"),
        dataTestId: "chat-panel-create-target-work-item-option",
      },
      {
        value: CHAT_PANEL_CREATE_TARGET.BENCHMARK,
        label: t("creator.createTarget.benchmark"),
        dataTestId: "chat-panel-create-target-benchmark-option",
      },
    ],
    [t]
  );

  const handleCreateTargetChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      const nextTarget = value as ChatPanelCreateTarget;
      setStartPageOpen(false);

      if (nextTarget === CHAT_PANEL_CREATE_TARGET.CREATE_AGENT) {
        const adeManagerDef = allAgentDefs.find(
          (definition) => definition.id === ADE_MANAGER_DEF_ID
        );
        setCreatorState((previous) => ({
          ...previous,
          dispatchCategory: "rust_agent",
          targetKind: SESSION_TARGET_KIND.AGENT,
          selectedAgentDefinitionId: ADE_MANAGER_DEF_ID,
          selectedAgentOrgId: null,
          agentName: adeManagerDef?.name ?? previous.agentName,
          agentIconId: adeManagerDef?.iconId ?? null,
          cliAgentType: null,
        }));
        handleNewSession();
        setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setWorkItemCreateDraft(null);
        setShowWorkItemAgentCreator(sessionCreatorAvailable);
        setShowProjectAgentCreator(sessionCreatorAvailable);
        return;
      }

      if (nextTarget !== CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
        setWorkItemCreateDraft(null);
        setShowWorkItemAgentCreator(sessionCreatorAvailable);
      }
      if (nextTarget !== CHAT_PANEL_CREATE_TARGET.PROJECT) {
        setShowProjectAgentCreator(sessionCreatorAvailable);
      }
      setCreateTarget(nextTarget);
      if (nextTarget === CHAT_PANEL_CREATE_TARGET.AGENT_SESSION) {
        handleNewSession();
      }
    },
    [
      allAgentDefs,
      handleNewSession,
      sessionCreatorAvailable,
      setCreateTarget,
      setCreatorState,
      setStartPageOpen,
      setShowProjectAgentCreator,
      setShowWorkItemAgentCreator,
      setWorkItemCreateDraft,
    ]
  );

  return { createTargetOptions, handleCreateTargetChange };
}
