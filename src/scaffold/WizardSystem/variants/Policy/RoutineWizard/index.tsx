import { FolderGit2, Grip, Network } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ROUTINE_CATCH_UP_POLICY,
  ROUTINE_CONCURRENCY_POLICY,
  ROUTINE_OUTPUT_MODE,
  type RoutineCatchUpPolicy,
  type RoutineConcurrencyPolicy,
  type RoutineDefinition,
  type RoutineOutputMode,
  type RoutineRunTarget,
  type RoutineWorkspaceTarget,
  projectApi,
} from "@src/api/http/project";
import { rpc } from "@src/api/tauri/rpc";
import type { DispatchCategory } from "@src/api/tauri/session";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import ModelIcon from "@src/components/ModelIcon";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import Textarea from "@src/components/Textarea";
import TimePicker from "@src/components/TimePicker";
import { resolveAgentIcon } from "@src/config/agentIcons";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import {
  type CronParts,
  type ScheduleFrequency,
  buildCron,
  parseCron,
} from "@src/modules/ProjectManager/WorkItems/components/ScheduleEditor/cronUtils";
import {
  SECTION_CONTROL_STYLE,
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes";
import {
  DispatchCategoryPalette,
  UnifiedModelPalette,
  WorkspacePalette,
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
  /** Whether the user is typing a raw cron instead of using the builder. */
  customCron: boolean;
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
  outputMode: RoutineOutputMode;
  concurrencyPolicy: RoutineConcurrencyPolicy;
  catchUpPolicy: RoutineCatchUpPolicy;
  createWorkItemProjectSlug: string;
  autoStart: boolean;
  updateWorkItemProjectSlug: string;
  updateWorkItemShortId: string;
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

  const existingCron =
    routine?.trigger.kind === ROUTINE_TRIGGER_KIND.CRON
      ? routine.trigger.cron
      : "";

  return {
    name: routine?.name ?? "",
    description: routine?.description ?? "",
    enabled: routine?.enabled ?? true,
    triggerKind: isCron ? "CRON" : "ONE_TIME",
    at:
      routine?.trigger.kind === ROUTINE_TRIGGER_KIND.ONE_TIME
        ? isoForInput(routine.trigger.at)
        : "",
    cron: existingCron,
    customCron: existingCron !== "" && parseCron(existingCron) === null,
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
    outputMode:
      routine?.outputPolicy.mode ?? ROUTINE_OUTPUT_MODE.DIRECT_SESSION,
    concurrencyPolicy:
      routine?.outputPolicy.concurrencyPolicy ??
      ROUTINE_CONCURRENCY_POLICY.COALESCE_IF_ACTIVE,
    catchUpPolicy:
      routine?.outputPolicy.catchUpPolicy ?? ROUTINE_CATCH_UP_POLICY.RUN_ONCE,
    createWorkItemProjectSlug:
      routine?.outputPolicy.createWorkItemProjectSlug ?? "",
    autoStart: routine?.outputPolicy.autoStart ?? true,
    updateWorkItemProjectSlug:
      routine?.outputPolicy.updateWorkItemProjectSlug ?? "",
    updateWorkItemShortId: routine?.outputPolicy.updateWorkItemShortId ?? "",
  };
}

const RoutineWizard: React.FC<RoutineWizardProps> = ({
  routine,
  agents = [],
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation("integrations");
  const [draft, setDraft] = useState<RoutineDraft>(() =>
    draftFromRoutine(routine)
  );
  const [agentOrgs, setAgentOrgs] = useState<AgentOrgOption[]>([]);
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>(
    []
  );
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
    projectApi.readProjects().then((projectList) => {
      if (cancelled) return;
      setProjects(
        projectList.map((project) => ({
          slug: project.slug,
          name: project.meta.name,
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

  const outputConfigValid =
    draft.outputMode === ROUTINE_OUTPUT_MODE.UPDATE_EXISTING_WORK_ITEM
      ? draft.updateWorkItemProjectSlug.trim() !== "" &&
        draft.updateWorkItemShortId.trim() !== ""
      : true;

  const canSave =
    draft.name.trim() !== "" &&
    draft.prompt.trim() !== "" &&
    targetSelected &&
    (draft.triggerKind === "CRON"
      ? draft.cron.trim() !== ""
      : draft.at.trim() !== "") &&
    (draft.workspaceKind === "NONE" || draft.workspacePath.trim() !== "") &&
    outputConfigValid;

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
      {
        value: "ONE_TIME",
        label: t("routineFields.oneTime"),
        dataTestId: "routine-wizard-trigger-option-one_time",
      },
      {
        value: "CRON",
        label: t("routineFields.cron"),
        dataTestId: "routine-wizard-trigger-option-cron",
      },
    ],
    [t]
  );

  // Cron builder state: derive the structured parts from the raw cron, the
  // same round-trip ScheduleEditor uses. Unparseable expressions fall back
  // to the raw text input (customCron).
  const cronParts = useMemo<CronParts>(() => {
    const parsed = draft.cron ? parseCron(draft.cron) : null;
    return parsed ?? { frequency: "daily", hour: 9, minute: 0 };
  }, [draft.cron]);

  const updateCronParts = useCallback((next: CronParts) => {
    setDraft((current) => ({ ...current, cron: buildCron(next) }));
  }, []);

  const frequencyOptions = useMemo(
    () => [
      {
        value: "daily",
        label: t("common:schedule.freq.daily"),
        dataTestId: "routine-wizard-cron-frequency-option-daily",
      },
      {
        value: "weekday",
        label: t("common:schedule.freq.weekday"),
        dataTestId: "routine-wizard-cron-frequency-option-weekday",
      },
      {
        value: "weekly",
        label: t("common:schedule.freq.weekly"),
        dataTestId: "routine-wizard-cron-frequency-option-weekly",
      },
      {
        value: "monthly",
        label: t("common:schedule.freq.monthly"),
        dataTestId: "routine-wizard-cron-frequency-option-monthly",
      },
    ],
    [t]
  );

  const weekdayOptions = useMemo(
    () =>
      (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map(
        (key, day) => ({
          value: day,
          label: t(`common:schedule.days.${key}`),
        })
      ),
    [t]
  );

  const monthDayOptions = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        value: index + 1,
        label: String(index + 1),
      })),
    []
  );

  const outputModeOptions = useMemo(
    () => [
      {
        value: ROUTINE_OUTPUT_MODE.DIRECT_SESSION,
        label: t("routineFields.outputDirectSession"),
        dataTestId: "routine-wizard-output-mode-option-direct_session",
      },
      {
        value: ROUTINE_OUTPUT_MODE.CREATE_WORK_ITEM,
        label: t("routineFields.outputCreateWorkItem"),
        dataTestId: "routine-wizard-output-mode-option-create_work_item",
      },
      {
        value: ROUTINE_OUTPUT_MODE.UPDATE_EXISTING_WORK_ITEM,
        label: t("routineFields.outputUpdateWorkItem"),
        dataTestId:
          "routine-wizard-output-mode-option-update_existing_work_item",
      },
    ],
    [t]
  );

  const concurrencyOptions = useMemo(
    () => [
      {
        value: ROUTINE_CONCURRENCY_POLICY.COALESCE_IF_ACTIVE,
        label: t("routineFields.concurrencyCoalesce"),
        dataTestId: "routine-wizard-concurrency-option-coalesce_if_active",
      },
      {
        value: ROUTINE_CONCURRENCY_POLICY.SKIP_IF_ACTIVE,
        label: t("routineFields.concurrencySkip"),
        dataTestId: "routine-wizard-concurrency-option-skip_if_active",
      },
      {
        value: ROUTINE_CONCURRENCY_POLICY.QUEUE_IF_ACTIVE,
        label: t("routineFields.concurrencyQueue"),
        dataTestId: "routine-wizard-concurrency-option-queue_if_active",
      },
      {
        value: ROUTINE_CONCURRENCY_POLICY.ALWAYS_CREATE,
        label: t("routineFields.concurrencyAlways"),
        dataTestId: "routine-wizard-concurrency-option-always_create",
      },
    ],
    [t]
  );

  const catchUpOptions = useMemo(
    () => [
      {
        value: ROUTINE_CATCH_UP_POLICY.SKIP_MISSED,
        label: t("routineFields.catchUpSkipMissed"),
        dataTestId: "routine-wizard-catch-up-option-skip_missed",
      },
      {
        value: ROUTINE_CATCH_UP_POLICY.RUN_ONCE,
        label: t("routineFields.catchUpRunOnce"),
        dataTestId: "routine-wizard-catch-up-option-run_once",
      },
      {
        value: ROUTINE_CATCH_UP_POLICY.RUN_ALL_LIMITED,
        label: t("routineFields.catchUpRunAll"),
        dataTestId: "routine-wizard-catch-up-option-run_all_limited",
      },
    ],
    [t]
  );

  const projectOptions = useMemo(
    () => [
      {
        value: "",
        label: t("routineFields.standaloneItem"),
        dataTestId: "routine-wizard-output-project-option-standalone",
      },
      ...projects.map((project) => ({
        value: project.slug,
        label: project.name,
        dataTestId: `routine-wizard-output-project-option-${project.slug}`,
      })),
    ],
    [projects, t]
  );

  const updateProjectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.slug,
        label: project.name,
        dataTestId: `routine-wizard-update-project-option-${project.slug}`,
      })),
    [projects]
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
      outputPolicy: {
        mode: draft.outputMode,
        concurrencyPolicy: draft.concurrencyPolicy,
        catchUpPolicy: draft.catchUpPolicy,
        maxCatchUpRuns: routine?.outputPolicy.maxCatchUpRuns ?? 1,
        idempotencyScope:
          routine?.outputPolicy.idempotencyScope ?? "routine_fire",
        createWorkItemStatus:
          routine?.outputPolicy.createWorkItemStatus ?? "planned",
        createWorkItemProjectSlug:
          draft.outputMode === ROUTINE_OUTPUT_MODE.CREATE_WORK_ITEM
            ? draft.createWorkItemProjectSlug.trim() || undefined
            : routine?.outputPolicy.createWorkItemProjectSlug,
        createWorkItemTitle: routine?.outputPolicy.createWorkItemTitle,
        createWorkItemBody: routine?.outputPolicy.createWorkItemBody,
        autoStart: draft.autoStart,
        updateWorkItemShortId:
          draft.outputMode === ROUTINE_OUTPUT_MODE.UPDATE_EXISTING_WORK_ITEM
            ? draft.updateWorkItemShortId.trim() || undefined
            : undefined,
        updateWorkItemProjectSlug:
          draft.outputMode === ROUTINE_OUTPUT_MODE.UPDATE_EXISTING_WORK_ITEM
            ? draft.updateWorkItemProjectSlug.trim() || undefined
            : undefined,
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
      <WizardStepLayout
        currentStep={1}
        totalSteps={1}
        actions={actions}
        hideStepIndicator
        contentWidthFooter
      >
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
                onChange={(value) => {
                  const kind = String(value) as RoutineDraft["triggerKind"];
                  setDraft((current) => ({
                    ...current,
                    triggerKind: kind,
                    // Builder mode needs a concrete expression immediately,
                    // otherwise canSave blocks on the empty string.
                    cron:
                      kind === "CRON" && !current.cron
                        ? buildCron({ frequency: "daily", hour: 9, minute: 0 })
                        : current.cron,
                  }));
                }}
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
              <>
                {!draft.customCron && (
                  <>
                    <SectionRow
                      label={t("common:schedule.frequency")}
                      required
                      indent
                    >
                      <Select
                        value={cronParts.frequency}
                        onChange={(value) =>
                          updateCronParts({
                            ...cronParts,
                            frequency: String(value) as ScheduleFrequency,
                          })
                        }
                        options={frequencyOptions}
                        size="default"
                        style={SECTION_CONTROL_STYLE}
                        dataTestId="routine-wizard-cron-frequency-select"
                      />
                    </SectionRow>
                    {cronParts.frequency === "weekly" && (
                      <SectionRow label={t("common:schedule.dayOfWeek")} indent>
                        <Select
                          value={cronParts.dayOfWeek ?? 1}
                          onChange={(value) =>
                            updateCronParts({
                              ...cronParts,
                              dayOfWeek: Number(value),
                            })
                          }
                          options={weekdayOptions}
                          size="default"
                          style={SECTION_CONTROL_STYLE}
                          dataTestId="routine-wizard-cron-weekday-select"
                        />
                      </SectionRow>
                    )}
                    {cronParts.frequency === "monthly" && (
                      <SectionRow
                        label={t("common:schedule.dayOfMonth")}
                        indent
                      >
                        <Select
                          value={cronParts.dayOfMonth ?? 1}
                          onChange={(value) =>
                            updateCronParts({
                              ...cronParts,
                              dayOfMonth: Number(value),
                            })
                          }
                          options={monthDayOptions}
                          size="default"
                          style={SECTION_CONTROL_STYLE}
                          dataTestId="routine-wizard-cron-monthday-select"
                        />
                      </SectionRow>
                    )}
                    <SectionRow label={t("common:schedule.time")} indent>
                      <TimePicker
                        hour={cronParts.hour}
                        minute={cronParts.minute}
                        onChange={(hour, minute) =>
                          updateCronParts({ ...cronParts, hour, minute })
                        }
                        variant="ghost"
                      />
                    </SectionRow>
                  </>
                )}
                {draft.customCron && (
                  <SectionRow
                    label={t("routineFields.cronExpression")}
                    required
                    indent
                  >
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
                <SectionRow label="" indent>
                  <button
                    type="button"
                    className="text-[11px] text-primary-6 hover:underline"
                    onClick={() => {
                      // Entering builder mode discards an unparseable
                      // custom cron (the builder always emits valid ones).
                      setDraft((current) => ({
                        ...current,
                        customCron: !current.customCron,
                        cron: current.customCron
                          ? buildCron(cronParts)
                          : current.cron,
                      }));
                    }}
                    data-testid="routine-wizard-cron-toggle"
                  >
                    {draft.customCron
                      ? t("common:schedule.hideCustomCron")
                      : t("common:schedule.customCron")}
                  </button>
                </SectionRow>
              </>
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

          <SectionContainer>
            <SectionRow label={t("routineFields.output")} required>
              <Select
                value={draft.outputMode}
                onChange={(value) =>
                  updateDraft("outputMode", String(value) as RoutineOutputMode)
                }
                options={outputModeOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dataTestId="routine-wizard-output-mode-select"
              />
            </SectionRow>

            {draft.outputMode === ROUTINE_OUTPUT_MODE.CREATE_WORK_ITEM && (
              <>
                <SectionRow label={t("routineFields.project")} indent>
                  <Select
                    value={draft.createWorkItemProjectSlug}
                    onChange={(value) =>
                      updateDraft("createWorkItemProjectSlug", String(value))
                    }
                    options={projectOptions}
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="routine-wizard-output-project-select"
                  />
                </SectionRow>
                <SectionRow label={t("routineFields.autoStart")} indent>
                  <Switch
                    size="small"
                    checked={draft.autoStart}
                    onChange={(checked) => updateDraft("autoStart", checked)}
                    dataTestId="routine-wizard-auto-start-switch"
                  />
                </SectionRow>
              </>
            )}

            {draft.outputMode ===
              ROUTINE_OUTPUT_MODE.UPDATE_EXISTING_WORK_ITEM && (
              <>
                <SectionRow label={t("routineFields.project")} required indent>
                  <Select
                    value={draft.updateWorkItemProjectSlug}
                    onChange={(value) =>
                      updateDraft("updateWorkItemProjectSlug", String(value))
                    }
                    options={updateProjectOptions}
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    dataTestId="routine-wizard-update-project-select"
                  />
                </SectionRow>
                <SectionRow
                  label={t("routineFields.targetWorkItem")}
                  required
                  indent
                >
                  <Input
                    value={draft.updateWorkItemShortId}
                    onChange={(value) =>
                      updateDraft("updateWorkItemShortId", value)
                    }
                    placeholder="ABC-0042"
                    size="default"
                    style={SECTION_CONTROL_STYLE}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-testid="routine-wizard-update-short-id-input"
                  />
                </SectionRow>
              </>
            )}

            <SectionRow label={t("routineFields.concurrencyPolicy")}>
              <Select
                value={draft.concurrencyPolicy}
                onChange={(value) =>
                  updateDraft(
                    "concurrencyPolicy",
                    String(value) as RoutineConcurrencyPolicy
                  )
                }
                options={concurrencyOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dataTestId="routine-wizard-concurrency-select"
              />
            </SectionRow>

            <SectionRow label={t("routineFields.catchUpPolicy")}>
              <Select
                value={draft.catchUpPolicy}
                onChange={(value) =>
                  updateDraft(
                    "catchUpPolicy",
                    String(value) as RoutineCatchUpPolicy
                  )
                }
                options={catchUpOptions}
                size="default"
                style={SECTION_CONTROL_STYLE}
                dataTestId="routine-wizard-catch-up-select"
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

      <WorkspacePalette
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
