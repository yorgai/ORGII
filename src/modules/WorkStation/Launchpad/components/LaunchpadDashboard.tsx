import { useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
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
import { getRustAgentType } from "@src/util/session/sessionDispatch";

import { getRepoColor } from "../config";
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
  /** Explicit "Open details" path — still opens the launchpad-repo tab. */
  onOpenRepoDetails: (repo: Repo) => void;
  onAddWorkspace: () => void;
}

const LAUNCHPAD_TILE_CLASS =
  "group/launchpadtile flex w-24 shrink-0 flex-col items-center gap-2 border-none bg-transparent p-0 text-center outline-none";

const LAUNCHPAD_TILE_ICON_CLASS =
  "relative flex h-16 w-20 items-center justify-center rounded-xl transition-colors duration-150 group-hover/launchpadtile:bg-fill-2";

const LAUNCHPAD_TILE_ICON_SELECTED_CLASS =
  "relative flex h-16 w-20 items-center justify-center rounded-xl bg-fill-2 transition-colors duration-150";

const LAUNCHPAD_TILE_LABEL_CLASS =
  "line-clamp-2 w-24 text-center text-[13px] font-medium leading-tight text-text-2 transition-colors group-hover/launchpadtile:text-text-1";

const LAUNCHPAD_TILE_LABEL_SELECTED_CLASS =
  "line-clamp-2 w-24 text-center text-[13px] font-medium leading-tight text-text-1";

interface LaunchpadCollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
}

const LaunchpadCollapsibleSection: React.FC<LaunchpadCollapsibleSectionProps> =
  memo(({ title, children }) => (
    <CollapsibleSection
      title={title}
      compact
      titleClassName="text-[13px] font-semibold text-text-1"
      headerRowClassName="mb-3"
      chevronSize={16}
      chevronStrokeWidth={1.75}
      chevronClassName="text-text-2"
    >
      {children}
    </CollapsibleSection>
  ));
LaunchpadCollapsibleSection.displayName = "LaunchpadCollapsibleSection";

const LaunchpadHScrollFade: React.FC<{
  children: React.ReactNode;
  gap?: string;
}> = ({ children, gap = "gap-3" }) => (
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
  onClick?: () => void;
}

const LaunchpadTile: React.FC<LaunchpadTileProps> = memo(
  ({ icon, label, title, status, onClick }) => {
    const content = (
      <>
        <div className={LAUNCHPAD_TILE_ICON_CLASS}>
          {icon}
          {status ? (
            <span className="absolute right-2 top-2">{status}</span>
          ) : null}
        </div>
        <span className={LAUNCHPAD_TILE_LABEL_CLASS}>{label}</span>
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
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-1">
          <Plus size={20} strokeWidth={1.75} className="text-text-3" />
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
            color={getRepoColor(label)}
            label={initial}
            size={44}
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

    const rankedAgents = useMemo(() => {
      const cliRows = installedCliAgents
        .slice()
        .sort(
          (agentA, agentB) => Number(agentB.popular) - Number(agentA.popular)
        )
        .map((agent) => ({
          key: agent.name,
          label: agent.displayName,
          icon: <ModelIcon agentType={agent.name as CliAgentType} size={36} />,
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
        return {
          key: rustType,
          label,
          icon: React.createElement(IconComponent, {
            size: 36,
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
        };
      });

      const customRows = customRustAgents.map((definition) => {
        const IconComponent = resolveAgentIcon(definition.iconId);
        return {
          key: definition.id,
          label: definition.name,
          icon: React.createElement(IconComponent, {
            size: 36,
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
        };
      });

      return [...cliRows, ...rustRows, ...customRows];
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

    const handleClearSelection = useCallback(
      () => onSelectDashboardRepo(null),
      [onSelectDashboardRepo]
    );

    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
          <div className="mx-auto flex w-full max-w-[980px] flex-col gap-8 px-4 py-6">
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

            <LaunchpadCollapsibleSection
              title={t("sessions:controlTower.myAgents")}
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
                      onClick={agent.onLaunch}
                    />
                  ))}
                  <LaunchpadAddTile
                    onCreate={goToIntegrations}
                    label={t("sessions:controlTower.addAgent")}
                  />
                </LaunchpadHScrollFade>
              )}
            </LaunchpadCollapsibleSection>

            <LaunchpadCollapsibleSection
              title={t("sessions:controlTower.myApiKeys")}
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
                            size={36}
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

            <ContainerEnginesSection
              engines={remoteEngines}
              loading={enginesLoading}
              error={enginesError}
              onRefresh={refreshEngines}
              defaultOpen={false}
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
            />
          </div>
        </div>
      </div>
    );
  }
);
LaunchpadDashboard.displayName = "LaunchpadDashboard";

export default LaunchpadDashboard;
