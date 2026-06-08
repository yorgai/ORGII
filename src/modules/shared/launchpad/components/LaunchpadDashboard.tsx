import { useSetAtom } from "jotai";
import { Expand, Play, Plus } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { RUST_AGENT_TYPE } from "@src/api/tauri/agent/types";
import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { useKeyVault } from "@src/hooks/keyVault";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";
import type { Repo } from "@src/store/repo/types";
import {
  SESSION_TARGET_KIND,
  sessionCreatorStateAtom,
} from "@src/store/session";
import type { AgentConfigTabVariant } from "@src/store/workstation/tabs";
import { getRustAgentType } from "@src/util/session/sessionDispatch";
import { openAgentConfigInWorkStation } from "@src/util/ui/openAgentConfigInWorkStation";

import { useContainerEngines } from "../hooks/useContainerEngines";
import { useContainers } from "../hooks/useContainers";
import {
  rustBuiltInVariantsFromDefinitions,
  useLaunchpadAgentCatalog,
} from "../hooks/useLaunchpadAgentCatalog";
import ContainerEnginesSection from "./ContainerEnginesSection";
import ContainersSection from "./ContainersSection";
import LaunchpadActionStrip from "./LaunchpadActionStrip";
import MacFolderIcon from "./MacFolderIcon";

interface LaunchpadDashboardProps {
  repos: Repo[];
  loading: boolean;
  /** Currently highlighted workspace card (drives the action strip). */
  selectedDashboardRepoId: string | null;
  onSelectDashboardRepo: (repoId: string | null) => void;
  /**
   * Explicit "Open details" path — navigates to the workspace overview
   * surface for the repo and selects the Details tab.
   */
  onOpenRepoDetails: (repo: Repo) => void;
  onAddWorkspace: () => void;
}

const LAUNCHPAD_TILE_CLASS =
  "group/launchpadtile flex w-20 shrink-0 flex-col items-center gap-1.5 border-none bg-transparent p-0 text-center outline-none";

const LAUNCHPAD_TILE_ICON_CLASS =
  "relative flex h-12 w-16 items-center justify-center rounded-lg transition-colors duration-150 group-hover/launchpadtile:bg-fill-2";

const LAUNCHPAD_TILE_ICON_SELECTED_CLASS =
  "relative flex h-12 w-16 items-center justify-center rounded-lg bg-fill-2 transition-colors duration-150";

const LAUNCHPAD_TILE_LABEL_CLASS =
  "line-clamp-2 w-20 text-center text-[12px] font-normal leading-tight text-text-2 transition-colors group-hover/launchpadtile:text-text-1";

const LAUNCHPAD_TILE_LABEL_SELECTED_CLASS =
  "line-clamp-2 w-20 text-center text-[12px] font-normal leading-tight text-text-1";

interface LaunchpadCollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
}

const LaunchpadCollapsibleSection: React.FC<LaunchpadCollapsibleSectionProps> =
  memo(({ title, children }) => (
    <CollapsibleSection title={title} compact chevronStrokeWidth={1.75}>
      {children}
    </CollapsibleSection>
  ));
LaunchpadCollapsibleSection.displayName = "LaunchpadCollapsibleSection";

const LaunchpadHScrollFade: React.FC<{
  children: React.ReactNode;
  gap?: string;
}> = ({ children, gap = "gap-2" }) => (
  <div
    className="relative overflow-hidden"
    style={{
      maskImage:
        "linear-gradient(to right, black calc(100% - 24px), rgba(0,0,0,0.15) 100%)",
      WebkitMaskImage:
        "linear-gradient(to right, black calc(100% - 24px), rgba(0,0,0,0.15) 100%)",
    }}
  >
    <div className={`flex ${gap} overflow-x-auto pb-2 scrollbar-hide`}>
      {children}
    </div>
  </div>
);

interface LaunchpadTileProps {
  icon: React.ReactNode;
  label: string;
  title?: string;
  status?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

const LaunchpadTile: React.FC<LaunchpadTileProps> = memo(
  ({ icon, label, title, status, selected = false, onClick }) => {
    const content = (
      <>
        <div
          className={
            selected
              ? LAUNCHPAD_TILE_ICON_SELECTED_CLASS
              : LAUNCHPAD_TILE_ICON_CLASS
          }
        >
          {icon}
          {status ? (
            <span className="absolute right-1.5 top-1.5">{status}</span>
          ) : null}
        </div>
        <span
          className={
            selected
              ? LAUNCHPAD_TILE_LABEL_SELECTED_CLASS
              : LAUNCHPAD_TILE_LABEL_CLASS
          }
        >
          {label}
        </span>
      </>
    );

    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className={LAUNCHPAD_TILE_CLASS}
          title={title ?? label}
        >
          {content}
        </button>
      );
    }

    return (
      <div className={LAUNCHPAD_TILE_CLASS} title={title ?? label}>
        {content}
      </div>
    );
  }
);
LaunchpadTile.displayName = "LaunchpadTile";

interface LaunchpadAddTileProps {
  onCreate: () => void;
  label: string;
}

const LaunchpadAddTile: React.FC<LaunchpadAddTileProps> = memo(
  ({ onCreate, label }) => (
    <button
      type="button"
      onClick={onCreate}
      className={LAUNCHPAD_TILE_CLASS}
      title={label}
      aria-label={label}
    >
      <div className={LAUNCHPAD_TILE_ICON_CLASS}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-1">
          <Plus size={18} strokeWidth={1.75} className="text-text-3" />
        </span>
      </div>
      <span className={LAUNCHPAD_TILE_LABEL_CLASS}>{label}</span>
    </button>
  )
);
LaunchpadAddTile.displayName = "LaunchpadAddTile";

interface LaunchpadWorkspaceCardProps {
  repo: Repo;
  selected: boolean;
  onSelect: (repo: Repo) => void;
}

const LaunchpadWorkspaceCard: React.FC<LaunchpadWorkspaceCardProps> = memo(
  ({ repo, selected, onSelect }) => {
    const label = repo.name || repo.path?.split("/").pop() || "Repo";
    const initial = label.charAt(0).toUpperCase();
    const handleClick = () => onSelect(repo);

    return (
      <button
        type="button"
        onClick={handleClick}
        className={LAUNCHPAD_TILE_CLASS}
        title={repo.path ?? label}
        aria-pressed={selected}
      >
        <div
          className={
            selected
              ? LAUNCHPAD_TILE_ICON_SELECTED_CLASS
              : LAUNCHPAD_TILE_ICON_CLASS
          }
        >
          <MacFolderIcon
            color="var(--color-primary-6)"
            label={initial}
            size={36}
            className="shrink-0"
          />
        </div>
        <span
          className={
            selected
              ? LAUNCHPAD_TILE_LABEL_SELECTED_CLASS
              : LAUNCHPAD_TILE_LABEL_CLASS
          }
        >
          {label}
        </span>
      </button>
    );
  }
);
LaunchpadWorkspaceCard.displayName = "LaunchpadWorkspaceCard";

interface LaunchpadAgentAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onLaunch: () => void;
  onOpenDetails: () => void;
}

interface LaunchpadAgentActionStripProps {
  agent: LaunchpadAgentAction;
}

const LaunchpadAgentActionStrip: React.FC<LaunchpadAgentActionStripProps> =
  memo(({ agent }) => {
    const { t } = useTranslation("navigation");

    return (
      <div className="w-fit max-w-full overflow-hidden rounded-full bg-fill-1 px-2 py-1.5">
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-hide">
          <Button
            variant="primary"
            size="small"
            shape="round"
            className="shrink-0"
            icon={<Play size={14} />}
            onClick={agent.onLaunch}
          >
            {t("navigation:launchpad.actions.startSession", {
              defaultValue: "Start session",
            })}
          </Button>
          <Button
            variant="secondary"
            size="small"
            shape="round"
            className="shrink-0"
            icon={<Expand size={14} />}
            onClick={agent.onOpenDetails}
          >
            {t("navigation:launchpad.actions.openDetails", {
              defaultValue: "Open details",
            })}
          </Button>
        </div>
      </div>
    );
  });
LaunchpadAgentActionStrip.displayName = "LaunchpadAgentActionStrip";

const LaunchpadDashboard: React.FC<LaunchpadDashboardProps> = memo(
  ({
    repos,
    loading,
    selectedDashboardRepoId,
    onSelectDashboardRepo,
    onOpenRepoDetails,
    onAddWorkspace,
  }) => {
    const { t } = useTranslation(["navigation", "sessions"]);
    const { goToNewSession, goToIntegrations } = useAppNavigation();
    const setCreatorState = useSetAtom(sessionCreatorStateAtom);
    const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(
      null
    );

    const {
      installedCliAgents,
      builtInRustAgents,
      customRustAgents,
      ready: catalogReady,
    } = useLaunchpadAgentCatalog();

    const { localAccounts, loading: keysLoading } = useKeyVault({
      autoLoad: true,
    });

    const {
      containers,
      loading: containersLoading,
      error: containersError,
      refresh: refreshContainers,
    } = useContainers();
    const {
      remoteEngines,
      loading: enginesLoading,
      error: enginesError,
      refresh: refreshEngines,
    } = useContainerEngines();

    const rankedAgents = useMemo<LaunchpadAgentAction[]>(() => {
      const cliRows = installedCliAgents
        .slice()
        .sort(
          (agentA, agentB) => Number(agentB.popular) - Number(agentA.popular)
        )
        .map((agent) => ({
          key: agent.name,
          label: agent.displayName,
          icon: <ModelIcon agentType={agent.name as CliAgentType} size={30} />,
          onLaunch: () => {
            setCreatorState((prev) => ({
              ...prev,
              dispatchCategory: "cli_agent",
              targetKind: SESSION_TARGET_KIND.CLI_AGENT,
              cliAgentType: agent.name as CliAgentType,
              selectedAgentDefinitionId: null,
              selectedAgentOrgId: null,
              agentName: agent.displayName,
              agentIconId: null,
            }));
            goToNewSession();
          },
          onOpenDetails: () => {
            openAgentConfigInWorkStation({
              variant: "cli",
              entityId: agent.name,
              displayName: agent.displayName,
              cliAgentType: agent.name,
            });
          },
        }));

      const rustBuiltInVariants =
        rustBuiltInVariantsFromDefinitions(builtInRustAgents);
      const rustRows = rustBuiltInVariants.map((rustType) => {
        const definition = builtInRustAgents.find(
          (definitionItem) => getRustAgentType(definitionItem.id) === rustType
        );
        const IconComponent = resolveAgentIcon(definition?.iconId);
        const label =
          definition?.name ??
          rustType ??
          t("sessions:controlTower.history.agentFallback");
        const variant: AgentConfigTabVariant =
          rustType === RUST_AGENT_TYPE.OS
            ? "builtin-os"
            : rustType === RUST_AGENT_TYPE.SDE
              ? "builtin-sde"
              : rustType === RUST_AGENT_TYPE.WINGMAN
                ? "wingman"
                : "custom";
        return {
          key: rustType,
          label,
          icon: React.createElement(IconComponent, {
            size: 30,
            strokeWidth: 1.75,
            className: "text-text-2",
          }),
          onLaunch: () => {
            setCreatorState((prev) => ({
              ...prev,
              dispatchCategory: "rust_agent",
              targetKind: SESSION_TARGET_KIND.AGENT,
              selectedAgentDefinitionId: definition?.id ?? null,
              selectedAgentOrgId: null,
              agentName: label,
              agentIconId: null,
              cliAgentType: null,
            }));
            goToNewSession();
          },
          onOpenDetails: () => {
            if (!definition) return;
            openAgentConfigInWorkStation({
              variant,
              entityId: definition.id,
              displayName: label,
            });
          },
        };
      });

      const customRows = customRustAgents.map((definition) => {
        const IconComponent = resolveAgentIcon(definition.iconId);
        return {
          key: definition.id,
          label: definition.name,
          icon: React.createElement(IconComponent, {
            size: 30,
            strokeWidth: 1.75,
            className: "text-text-2",
          }),
          onLaunch: () => {
            setCreatorState((prev) => ({
              ...prev,
              dispatchCategory: "rust_agent",
              targetKind: SESSION_TARGET_KIND.AGENT,
              selectedAgentDefinitionId: definition.id,
              selectedAgentOrgId: null,
              agentName: definition.name,
              agentIconId: null,
              cliAgentType: null,
            }));
            goToNewSession();
          },
          onOpenDetails: () => {
            openAgentConfigInWorkStation({
              variant: "custom",
              entityId: definition.id,
              displayName: definition.name,
            });
          },
        };
      });

      return [...rustRows, ...customRows, ...cliRows];
    }, [
      installedCliAgents,
      builtInRustAgents,
      customRustAgents,
      setCreatorState,
      goToNewSession,
      t,
    ]);

    const selectedDashboardRepo = useMemo<Repo | null>(
      () =>
        selectedDashboardRepoId
          ? (repos.find((repo) => repo.id === selectedDashboardRepoId) ?? null)
          : null,
      [repos, selectedDashboardRepoId]
    );

    const selectedAgent = useMemo(
      () =>
        selectedAgentKey
          ? (rankedAgents.find((agent) => agent.key === selectedAgentKey) ??
            null)
          : null,
      [rankedAgents, selectedAgentKey]
    );

    const handleSelectWorkspace = useCallback(
      (repo: Repo) => {
        if (repo.id === selectedDashboardRepoId) {
          onSelectDashboardRepo(null);
        } else {
          onSelectDashboardRepo(repo.id);
        }
      },
      [selectedDashboardRepoId, onSelectDashboardRepo]
    );

    const handleSelectAgent = useCallback((agent: LaunchpadAgentAction) => {
      setSelectedAgentKey((currentKey) =>
        currentKey === agent.key ? null : agent.key
      );
    }, []);

    const handleClearSelection = useCallback(
      () => onSelectDashboardRepo(null),
      [onSelectDashboardRepo]
    );

    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-bg-2">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 scrollbar-hide">
          <div
            className={`flex flex-col gap-5 py-5 ${DETAIL_PANEL_TOKENS.contentWidth}`}
          >
            <div className="flex flex-col gap-2">
              <LaunchpadCollapsibleSection
                title={t("navigation:launchpad.myWorkspaces")}
              >
                {loading ? (
                  <Placeholder variant="loading" />
                ) : (
                  <LaunchpadHScrollFade>
                    {repos.map((repo) => (
                      <LaunchpadWorkspaceCard
                        key={repo.id}
                        repo={repo}
                        selected={repo.id === selectedDashboardRepoId}
                        onSelect={handleSelectWorkspace}
                      />
                    ))}
                    <LaunchpadAddTile
                      onCreate={onAddWorkspace}
                      label={t("navigation:launchpad.addWorkspace")}
                    />
                  </LaunchpadHScrollFade>
                )}
              </LaunchpadCollapsibleSection>

              {selectedDashboardRepo ? (
                <LaunchpadActionStrip
                  repo={selectedDashboardRepo}
                  onOpenDetails={onOpenRepoDetails}
                  onClear={handleClearSelection}
                />
              ) : null}
            </div>

            <LaunchpadCollapsibleSection
              title={t("sessions:controlTower.myApiKeys", {
                count: localAccounts.length,
              })}
            >
              {keysLoading ? (
                <Placeholder variant="loading" />
              ) : (
                <LaunchpadHScrollFade>
                  {localAccounts.map((account) => {
                    const isReady = account.status === "ready";
                    return (
                      <LaunchpadTile
                        key={account.id}
                        icon={
                          <ModelIcon
                            agentType={account.modelType}
                            size={30}
                            className="shrink-0 text-text-2"
                          />
                        }
                        label={account.name}
                        title={account.name}
                        status={
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${isReady ? "bg-success-6" : "bg-text-4"}`}
                            title={account.status}
                          />
                        }
                      />
                    );
                  })}
                  <LaunchpadAddTile
                    onCreate={goToIntegrations}
                    label={t("sessions:controlTower.addApiKey")}
                  />
                </LaunchpadHScrollFade>
              )}
            </LaunchpadCollapsibleSection>

            <div className="flex flex-col gap-2">
              <LaunchpadCollapsibleSection
                title={t("sessions:controlTower.myAgents", {
                  count: rankedAgents.length,
                })}
              >
                {!catalogReady ? (
                  <Placeholder variant="loading" />
                ) : rankedAgents.length === 0 ? (
                  <Placeholder
                    variant="empty"
                    title={t("sessions:controlTower.noAgentsAvailable")}
                  />
                ) : (
                  <LaunchpadHScrollFade>
                    {rankedAgents.map((agent) => (
                      <LaunchpadTile
                        key={agent.key}
                        icon={agent.icon}
                        label={agent.label}
                        title={t("sessions:controlTower.newAgentSession", {
                          agent: agent.label,
                        })}
                        selected={agent.key === selectedAgentKey}
                        onClick={() => handleSelectAgent(agent)}
                      />
                    ))}
                    <LaunchpadAddTile
                      onCreate={goToIntegrations}
                      label={t("sessions:controlTower.addAgent")}
                    />
                  </LaunchpadHScrollFade>
                )}
              </LaunchpadCollapsibleSection>

              {selectedAgent ? (
                <LaunchpadAgentActionStrip agent={selectedAgent} />
              ) : null}
            </div>

            <ContainerEnginesSection
              engines={remoteEngines}
              loading={enginesLoading}
              error={enginesError}
              onRefresh={refreshEngines}
              defaultOpen={false}
              compact
            />

            <ContainersSection
              title={t("navigation:launchpad.containers.title")}
              containers={containers}
              loading={containersLoading}
              error={containersError}
              onRefresh={refreshContainers}
              emptyTitle={t("navigation:launchpad.containers.emptyTitle")}
              emptySubtitle={t("navigation:launchpad.containers.emptySubtitle")}
              defaultOpen={false}
              compact
            />
          </div>
        </div>
      </div>
    );
  }
);
LaunchpadDashboard.displayName = "LaunchpadDashboard";

export default LaunchpadDashboard;
