import { FolderGit2, Grip, Network } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ROUTINE_CATCH_UP_POLICY,
  ROUTINE_CONCURRENCY_POLICY,
  ROUTINE_OUTPUT_MODE,
  type RoutineDefinition,
  type RoutineRunTarget,
  type RoutineWorkspaceTarget,
} from "@src/api/http/project";
import { rpc } from "@src/api/tauri/rpc";
import type { DispatchCategory } from "@src/api/tauri/session";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import ModelIcon from "@src/components/ModelIcon";
import Select from "@src/components/Select";
import Textarea from "@src/components/Textarea";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { AvailableAgent } from "@src/config/cliAgents";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes";
import {
  DispatchCategoryPalette,
  RepoPalette,
  UnifiedModelPalette,
} from "@src/scaffold/GlobalSpotlight/palettes";
import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import {
  WizardShell,
  WizardStepLayout,
} from "@src/scaffold/WizardSystem/primitives";

import SpotlightSelectTrigger from "./SpotlightSelectTrigger";

const ROUTINE_TRIGGER_KIND = {
  ONE_TIME: "one_time",
  CRON: "cron",
} as const;

const ROUTINE_TARGET_KIND = {
  AGENT_DEFINITION: "agent_definition",
  AGENT_ORG: "agent_org",
} as const;

const ROUTINE_WORKSPACE_KIND = {
  NONE: "none",
  LOCAL_WORKSPACE: "local_workspace",
  WORKTREE: "worktree",
} as const;

interface RoutineWizardProps {
  routine?: RoutineDefinition;
  agents?: AgentDefinition[];
  cliAgents?: AvailableAgent[];
  onSave: (routine: RoutineDefinition) => void;
  onCancel: () => void;
}

interface AgentOrgOption {
  id: string;
  name: string;
  agentId: string;
}

/**
 * Stored representation of the consolidated "Agent responsible" selection.
 * Mirrors the two shapes of `RoutineRunTarget` so save-time mapping is a
 * trivial passthrough.
 */
type RoutineAgentTarget =
  | {
      kind: typeof ROUTINE_TARGET_KIND.AGENT_DEFINITION;
      agentDefinitionId: string;
    }
  | { kind: typeof ROUTINE_TARGET_KIND.AGENT_ORG; agentOrgId: string };

interface RoutineDraft {
  name: string;
  description: string;
  enabled: boolean;
  triggerKind: keyof typeof ROUTINE_TRIGGER_KIND;
  at: string;
  cron: string;
  /** Consolidated "Agent responsible for this routine" — agent def or org. */
  target: RoutineAgentTarget | null;
  /** Display label for the agent trigger row (built-in name or custom). */
  targetLabel: string;
  /** Icon id for the agent trigger row (matches `AgentDefinition.iconId`). */
  targetIconId?: string;
  /** Whether the selection is an org (drives the trigger icon). */
  targetIsOrg: boolean;
  prompt: string;
  workspaceKind: keyof typeof ROUTINE_WORKSPACE_KIND;
  workspacePath: string;
  /** Display name for the workspace trigger row. */
  workspaceLabel: string;
  branch: string;
  mode: string;
  model: string;
  accountId: string;
  /** Display label for the model trigger row. */
  modelLabel: string;
  /** Provider/model type for the model trigger icon. */
  modelType?: string;
}

/** file:// URIs land in `RepoItem.fs_uri`; the wire format wants a plain path. */
function normalizeFsUri(uri: string | undefined): string {
  if (!uri) return "";
  const stripped = uri.startsWith("file://")
    ? uri.slice("file://".length)
    : uri;
  return stripped.replace(/\/+$/, "");
}

function isoForInput(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function inputToIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function draftFromRoutine(routine?: RoutineDefinition): RoutineDraft {
  const isCron = routine?.trigger.kind === ROUTINE_TRIGGER_KIND.CRON;
  const target = routine?.runTemplate.target;
  const workspace = routine?.runTemplate.workspace;
  const workspacePath =
    workspace?.kind === ROUTINE_WORKSPACE_KIND.LOCAL_WORKSPACE ||
    workspace?.kind === ROUTINE_WORKSPACE_KIND.WORKTREE
      ? workspace.workspacePath
      : "";

  let storedTarget: RoutineAgentTarget | null = null;
  if (target?.kind === ROUTINE_TARGET_KIND.AGENT_ORG) {
    storedTarget = {
      kind: ROUTINE_TARGET_KIND.AGENT_ORG,
      agentOrgId: target.agentOrgId,
    };
  } else if (
    target?.kind === ROUTINE_TARGET_KIND.AGENT_DEFINITION &&
    target.agentDefinitionId
  ) {
    storedTarget = {
      kind: ROUTINE_TARGET_KIND.AGENT_DEFINITION,
      agentDefinitionId: target.agentDefinitionId,
    };
  }

  return {
    name: routine?.name ?? "",
    description: routine?.description ?? "",
    enabled: routine?.enabled ?? true,
    triggerKind: isCron ? "CRON" : "ONE_TIME",
    at:
      routine?.trigger.kind === ROUTINE_TRIGGER_KIND.ONE_TIME
        ? isoForInput(routine.trigger.at)
        : "",
    cron:
      routine?.trigger.kind === ROUTINE_TRIGGER_KIND.CRON
        ? routine.trigger.cron
        : "",
    target: storedTarget,
    targetLabel: "",
    targetIconId: undefined,
    targetIsOrg: storedTarget?.kind === ROUTINE_TARGET_KIND.AGENT_ORG,
    prompt: routine?.runTemplate.prompt ?? "",
    workspaceKind:
      workspace?.kind === ROUTINE_WORKSPACE_KIND.WORKTREE
        ? "WORKTREE"
        : workspace?.kind === ROUTINE_WORKSPACE_KIND.LOCAL_WORKSPACE
          ? "LOCAL_WORKSPACE"
          : "NONE",
    workspacePath,
    workspaceLabel: workspacePath,
    branch:
      workspace?.kind === ROUTINE_WORKSPACE_KIND.WORKTREE
        ? (workspace.branch ?? "")
        : "",
    mode: routine?.runTemplate.mode ?? "build",
    model: routine?.runTemplate.resources.model ?? "",
    accountId: routine?.runTemplate.resources.accountId ?? "",
    modelLabel: routine?.runTemplate.resources.model ?? "",
    modelType: undefined,
  };
}

const RoutineWizard: React.FC<RoutineWizardProps> = ({
  routine,
  agents = [],
  cliAgents: _cliAgents = [],
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation("integrations");
  const [draft, setDraft] = useState<RoutineDraft>(() =>
    draftFromRoutine(routine)
  );
  const [agentOrgs, setAgentOrgs] = useState<AgentOrgOption[]>([]);
  const [isAgentPaletteOpen, setIsAgentPaletteOpen] = useState(false);
  const [isWorkspacePaletteOpen, setIsWorkspacePaletteOpen] = useState(false);
  const [isModelPaletteOpen, setIsModelPaletteOpen] = useState(false);

  useEffect(() => {
    setDraft(draftFromRoutine(routine));
  }, [routine]);

  useEffect(() => {
    let cancelled = false;
    rpc.agentOrgs.orgs.list().then((orgs) => {
      if (cancelled) return;
      setAgentOrgs(
        orgs.map((org) => ({
          id: org.id,
          name: org.name,
          agentId: org.agentId,
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Backfill the display label after a routine is loaded for edit. The
  // draft stores only the target id; the human label lives on the
  // `agents` / `agentOrgs` lists which arrive asynchronously.
  useEffect(() => {
    setDraft((current) => {
      const target = current.target;
      if (!target || current.targetLabel) return current;
      if (target.kind === ROUTINE_TARGET_KIND.AGENT_DEFINITION) {
        const agent = agents.find((a) => a.id === target.agentDefinitionId);
        if (!agent) return current;
        return {
          ...current,
          targetLabel: agent.name,
          targetIconId: undefined,
          targetIsOrg: false,
        };
      }
      const org = agentOrgs.find((o) => o.id === target.agentOrgId);
      if (!org) return current;
      return {
        ...current,
        targetLabel: org.name,
        targetIsOrg: true,
      };
    });
  }, [agents, agentOrgs]);

  const targetSelected = draft.target !== null;

  const canSave =
    draft.name.trim() !== "" &&
    draft.prompt.trim() !== "" &&
    targetSelected &&
    (draft.triggerKind === "CRON"
      ? draft.cron.trim() !== ""
      : draft.at.trim() !== "") &&
    (draft.workspaceKind === "NONE" || draft.workspacePath.trim() !== "");

  const updateDraft = useCallback(function updateRoutineDraft<
    Key extends keyof RoutineDraft,
  >(key: Key, value: RoutineDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleAgentSelect = useCallback((selection: AgentSelection) => {
    // Routines only persist agent_definition or agent_org targets — the
    // wire format has no slot for CLI agents or external Cursor IDE.
    // We accept them in the picker (the palette is shared with the
    // SessionCreator) but ignore the click. Mapping each row back to
    // the right kind below keeps the rest of the wizard typesafe.
    if (selection.targetKind === "agent_org" && selection.agentOrgId) {
      setDraft((current) => ({
        ...current,
        target: {
          kind: ROUTINE_TARGET_KIND.AGENT_ORG,
          agentOrgId: selection.agentOrgId!,
        },
        targetLabel: selection.agentName,
        targetIconId: selection.agentIconId,
        targetIsOrg: true,
      }));
      return;
    }
    if (selection.targetKind === "agent" && selection.agentDefinitionId) {
      setDraft((current) => ({
        ...current,
        target: {
          kind: ROUTINE_TARGET_KIND.AGENT_DEFINITION,
          agentDefinitionId: selection.agentDefinitionId!,
        },
        targetLabel: selection.agentName,
        targetIconId: selection.agentIconId,
        targetIsOrg: false,
      }));
    }
  }, []);

  const handleWorkspaceSelect = useCallback(
    (_repoId: string, repo: RepoItem) => {
      const path = normalizeFsUri(repo.fs_uri);
      setDraft((current) => ({
        ...current,
        workspacePath: path,
        workspaceLabel: repo.name || path,
        // Picking a repo only makes sense when we actually want a
        // workspace; promote NONE -> LOCAL_WORKSPACE so save can wire
        // the path through.
        workspaceKind:
          current.workspaceKind === "NONE"
            ? "LOCAL_WORKSPACE"
            : current.workspaceKind,
      }));
    },
    []
  );

  const modelAdvancedConfig = useMemo<AdvancedConfig>(
    () => ({
      model: draft.model || undefined,
      selectedAccountId: draft.accountId || undefined,
    }),
    [draft.model, draft.accountId]
  );

  const handleModelConfigChange = useCallback((config: AdvancedConfig) => {
    setDraft((current) => ({
      ...current,
      model: config.model ?? config.listingModel ?? "",
      accountId: config.selectedAccountId ?? "",
      modelLabel:
        config.listingModelDisplay ??
        config.listingName ??
        config.model ??
        config.listingModel ??
        "",
      modelType:
        config.selectedSourceModelType ?? config.listingModelType ?? undefined,
    }));
  }, []);

  const currentAgentDefinitionId =
    draft.target?.kind === ROUTINE_TARGET_KIND.AGENT_DEFINITION
      ? draft.target.agentDefinitionId
      : undefined;
  const currentAgentOrgId =
    draft.target?.kind === ROUTINE_TARGET_KIND.AGENT_ORG
      ? draft.target.agentOrgId
      : undefined;

  // Filter the model palette to Rust-agent-compatible accounts. Routine
  // resources only describe the (model, accountId) used by the
  // RoutineRunTemplate — CLI-only accounts can't be used here.
  const modelPaletteCategory: DispatchCategory = "rust_agent";

  const triggerOptions = useMemo(
    () => [
      { value: "ONE_TIME", label: t("routineFields.oneTime") },
      { value: "CRON", label: t("routineFields.cron") },
    ],
    [t]
  );

  const workspaceKindOptions = useMemo(
    () => [
      { value: "NONE", label: t("routineFields.noWorkspace") },
      { value: "LOCAL_WORKSPACE", label: t("routineFields.localWorkspace") },
      { value: "WORKTREE", label: t("routineFields.worktree") },
    ],
    [t]
  );

  const handleSave = useCallback(() => {
    if (!canSave || !draft.target) return;
    const now = new Date().toISOString();
    const trigger =
      draft.triggerKind === "CRON"
        ? { kind: ROUTINE_TRIGGER_KIND.CRON, cron: draft.cron.trim() }
        : { kind: ROUTINE_TRIGGER_KIND.ONE_TIME, at: inputToIso(draft.at) };

    const target: RoutineRunTarget =
      draft.target.kind === ROUTINE_TARGET_KIND.AGENT_ORG
        ? {
            kind: ROUTINE_TARGET_KIND.AGENT_ORG,
            agentOrgId: draft.target.agentOrgId,
          }
        : {
            kind: ROUTINE_TARGET_KIND.AGENT_DEFINITION,
            agentDefinitionId: draft.target.agentDefinitionId,
          };

    const workspace: RoutineWorkspaceTarget =
      draft.workspaceKind === "WORKTREE"
        ? {
            kind: ROUTINE_WORKSPACE_KIND.WORKTREE,
            workspacePath: draft.workspacePath.trim(),
            branch: draft.branch.trim() || undefined,
            createIsolated: true,
            additionalDirectories: [],
          }
        : draft.workspaceKind === "LOCAL_WORKSPACE"
          ? {
              kind: ROUTINE_WORKSPACE_KIND.LOCAL_WORKSPACE,
              workspacePath: draft.workspacePath.trim(),
              additionalDirectories: [],
            }
          : { kind: ROUTINE_WORKSPACE_KIND.NONE };

    onSave({
      id: routine?.id ?? "",
      name: draft.name.trim(),
      description: draft.description.trim(),
      enabled: draft.enabled,
      trigger,
      runTemplate: {
        prompt: draft.prompt.trim(),
        target,
        resources: {
          model: draft.model.trim() || undefined,
          accountId: draft.accountId.trim() || undefined,
        },
        workspace,
        mode: draft.mode.trim() || undefined,
        name: draft.name.trim(),
      },
      outputPolicy: routine?.outputPolicy ?? {
        mode: ROUTINE_OUTPUT_MODE.DIRECT_SESSION,
        concurrencyPolicy: ROUTINE_CONCURRENCY_POLICY.COALESCE_IF_ACTIVE,
        catchUpPolicy: ROUTINE_CATCH_UP_POLICY.RUN_ONCE,
        maxCatchUpRuns: 1,
        idempotencyScope: "routine_fire",
        createWorkItemStatus: "planned",
      },
      createdAt: routine?.createdAt ?? now,
      updatedAt: now,
    });
  }, [canSave, draft, onSave, routine]);

  const actions = (
    <>
      <Button
        variant="secondary"
        size="small"
        onClick={onCancel}
        data-testid="routine-wizard-cancel-button"
      >
        {t("common:actions.cancel")}
      </Button>
      <Button
        variant="primary"
        size="small"
        disabled={!canSave}
        onClick={handleSave}
        data-testid="routine-wizard-save-button"
      >
        {t("common:actions.save")}
      </Button>
    </>
  );

  return (
    <WizardShell
      title={
        routine ? t("routineFields.editRoutine") : t("routineFields.addRoutine")
      }
      onCancel={onCancel}
      testId="routine-wizard-root"
    >
      <WizardStepLayout currentStep={1} totalSteps={1} actions={actions}>
        <div className={SECTION_GAP_CLASSES}>
          <SectionContainer>
            <SectionRow label={t("routineFields.name")} required>
              <Input
                value={draft.name}
                onChange={(value) => updateDraft("name", value)}
                placeholder={t("routineFields.namePlaceholder")}
                size="default"
                style={SECTION_CONTROL_STYLE}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-testid="routine-wizard-name-input"
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow label={t("routineFields.trigger")} required>
              <Select
                value={draft.triggerKind}
                onChange={(value) =>
                  updateDraft(
                    "triggerKind",
                    String(value) as RoutineDraft["triggerKind"]
                  )
                }
                options={triggerOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dataTestId="routine-wizard-trigger-select"
              />
            </SectionRow>

            {draft.triggerKind === "ONE_TIME" ? (
              <SectionRow label={t("routineFields.runAt")} required>
                <Input
                  value={draft.at}
                  onChange={(value) => updateDraft("at", value)}
                  placeholder="2026-05-07T09:00"
                  size="default"
                  style={SECTION_CONTROL_STYLE}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="routine-wizard-run-at-input"
                />
              </SectionRow>
            ) : (
              <SectionRow label={t("routineFields.cronExpression")} required>
                <Input
                  value={draft.cron}
                  onChange={(value) => updateDraft("cron", value)}
                  placeholder="0 9 * * 1"
                  size="default"
                  style={SECTION_CONTROL_STYLE}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="routine-wizard-cron-input"
                />
              </SectionRow>
            )}
          </SectionContainer>

          <SectionContainer>
            <SectionRow label={t("routineFields.agentResponsible")} required>
              <SpotlightSelectTrigger
                value={draft.targetLabel || undefined}
                placeholder={t("routineFields.agentResponsiblePlaceholder")}
                onClick={() => setIsAgentPaletteOpen(true)}
                active={isAgentPaletteOpen}
                size="default"
                style={SECTION_CONTROL_STYLE}
                prefix={(() => {
                  if (!draft.target) return null;
                  if (draft.targetIsOrg) {
                    return <Network size={16} className="text-text-2" />;
                  }
                  const Icon = resolveAgentIcon(draft.targetIconId);
                  return <Icon size={16} className="text-text-2" />;
                })()}
                dataTestId="routine-wizard-agent-trigger"
                ariaLabel={t("routineFields.agentResponsible")}
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label={t("routineFields.prompt")}
              required
              layout="vertical"
            >
              <Textarea
                value={draft.prompt}
                onChange={(value) => updateDraft("prompt", value)}
                autoSize={{ minRows: 4, maxRows: 8 }}
                placeholder={t("routineFields.promptPlaceholder")}
                data-testid="routine-wizard-prompt-input"
              />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow label={t("routineFields.workspace")}>
              <Select
                value={draft.workspaceKind}
                onChange={(value) =>
                  updateDraft(
                    "workspaceKind",
                    String(value) as RoutineDraft["workspaceKind"]
                  )
                }
                options={workspaceKindOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dataTestId="routine-wizard-workspace-kind-select"
              />
            </SectionRow>

            {draft.workspaceKind !== "NONE" && (
              <SectionRow
                label={t("routineFields.workspacePath")}
                required
                indent
              >
                <SpotlightSelectTrigger
                  value={
                    draft.workspaceLabel || draft.workspacePath || undefined
                  }
                  placeholder={t("routineFields.workspacePathPlaceholder")}
                  onClick={() => setIsWorkspacePaletteOpen(true)}
                  active={isWorkspacePaletteOpen}
                  size="default"
                  style={SECTION_CONTROL_STYLE}
                  prefix={<FolderGit2 size={16} className="text-text-2" />}
                  dataTestId="routine-wizard-workspace-trigger"
                  ariaLabel={t("routineFields.workspacePath")}
                />
              </SectionRow>
            )}

            {draft.workspaceKind === "WORKTREE" && (
              <SectionRow label={t("routineFields.branch")} indent>
                <Input
                  value={draft.branch}
                  onChange={(value) => updateDraft("branch", value)}
                  placeholder="routine/my-automation"
                  size="default"
                  style={SECTION_CONTROL_STYLE}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="routine-wizard-branch-input"
                />
              </SectionRow>
            )}
          </SectionContainer>

          <SectionContainer>
            <SectionRow label={t("routineFields.model")}>
              <SpotlightSelectTrigger
                value={draft.modelLabel || draft.model || undefined}
                placeholder={t("routineFields.modelPlaceholder")}
                onClick={() => setIsModelPaletteOpen(true)}
                active={isModelPaletteOpen}
                size="default"
                style={SECTION_CONTROL_STYLE}
                prefix={
                  draft.modelType ? (
                    <ModelIcon agentType={draft.modelType} size={16} />
                  ) : (
                    <Grip size={16} className="text-text-2" />
                  )
                }
                dataTestId="routine-wizard-model-trigger"
                ariaLabel={t("routineFields.model")}
              />
            </SectionRow>
          </SectionContainer>
        </div>
      </WizardStepLayout>

      <DispatchCategoryPalette
        isOpen={isAgentPaletteOpen}
        onClose={() => setIsAgentPaletteOpen(false)}
        onSelect={handleAgentSelect}
        currentCategory={draft.target ? "rust_agent" : undefined}
        currentAgentDefinitionId={currentAgentDefinitionId}
        currentAgentOrgId={currentAgentOrgId}
      />

      <RepoPalette
        isOpen={isWorkspacePaletteOpen}
        onClose={() => setIsWorkspacePaletteOpen(false)}
        onSelect={handleWorkspaceSelect}
      />

      <UnifiedModelPalette
        isOpen={isModelPaletteOpen}
        onClose={() => setIsModelPaletteOpen(false)}
        advancedConfig={modelAdvancedConfig}
        onConfigChange={handleModelConfigChange}
        dispatchCategoryOverride={modelPaletteCategory}
      />
    </WizardShell>
  );
};

export default RoutineWizard;
