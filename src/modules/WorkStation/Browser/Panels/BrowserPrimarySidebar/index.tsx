/**
 * BrowserPrimarySidebar Component
 *
 * Primary sidebar for Browser tool using PrimarySidebarLayout.
 * Provides pill tabs:
 * - Sessions: Two collapsible sections (Regular Browsing / Private Browsing)
 * - Design: Two collapsible sections (Pages / Components)
 * - Settings: Browser settings
 *
 * Shares structural components with other Workstation for consistency.
 */
import type { BrowserSession } from "@/src/engines/BrowserCore/types";
import {
  PrimarySidebarLayout,
  type PrimarySidebarTab,
} from "@/src/modules/WorkStation/shared";
import {
  BookOpen,
  Code2,
  Filter as FilterIcon,
  Globe,
  History,
  Pencil,
  Plus,
} from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import type { CatalogEntry } from "@src/modules/WorkStation/Browser/hooks/useComponentCatalog";
import type { ProjectFileInfo } from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";

import {
  DesignTabAddedComponents,
  DesignTabGlobalTokens,
  DesignTabRepoComponents,
  getAddedComponentsActions,
  getCandidatesActions,
  getGlobalTokensActions,
} from "./tabs/DesignTab";
import HistoryTab from "./tabs/HistoryTab";
import SessionsTab from "./tabs/SessionsTab";

// ============================================
// Types
// ============================================

export interface BrowserPrimarySidebarProps {
  /** Repository path for component scanning */
  repoPath?: string;
  /** List of browser sessions */
  sessions: BrowserSession[];
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Callback to set active session */
  onSelectSession: (sessionId: string) => void;
  /** Callback to create a new session */
  onNewSession: () => void;
  /** Callback to create a new private session */
  onNewPrivateSession?: () => void;
  /** Callback to close a session */
  onCloseSession: (sessionId: string) => void;
  /** Callback to open a browsing history entry */
  onOpenHistoryUrl: (url: string) => void;
  /** Hide per-section new-tab actions when creation is owned by outer chrome. */
  hideNewSessionActions?: boolean;

  // Design tab props
  /** Select a component with storybook (from Added Components) */
  onSelectProjectComponent?: (projectFile: ProjectFileInfo) => void;
  /** Currently selected project file path */
  selectedProjectPath?: string | null;
  /** Preview a repo component (from Candidates) */
  onPreviewRepoComponent?: (entry: CatalogEntry) => void;
  /** Open Color Tokens consolidated tab */
  onOpenColorTokens?: () => void;
}

// ============================================
// Component
// ============================================

export const BrowserPrimarySidebar: React.FC<BrowserPrimarySidebarProps> = memo(
  ({
    repoPath,
    sessions,
    activeSessionId,
    onSelectSession,
    onNewSession,
    onNewPrivateSession,
    onCloseSession,
    onOpenHistoryUrl,
    hideNewSessionActions = false,
    onSelectProjectComponent,
    selectedProjectPath,
    onPreviewRepoComponent,
    onOpenColorTokens,
  }) => {
    const { t } = useTranslation();

    // Active tab state
    const [activeTab, setActiveTab] = useState("sessions");

    // Filter state for design sections (follows explorer pattern)
    const [showFilterTokens, setShowFilterTokens] = useState(false);
    const [showFilterAddedComponents, setShowFilterAddedComponents] =
      useState(false);
    const [showFilterCandidates, setShowFilterCandidates] = useState(false);
    const [showFilterRegularSessions, setShowFilterRegularSessions] =
      useState(false);
    const [showFilterPrivateSessions, setShowFilterPrivateSessions] =
      useState(false);

    // State to store collapseAll/refresh callbacks from child components
    const [collapseAllCandidates, setCollapseAllCandidates] = useState<
      (() => void) | null
    >(null);
    const [refreshTokens, setRefreshTokens] = useState<(() => void) | null>(
      null
    );
    const [refreshAddedComponents, setRefreshAddedComponents] = useState<
      (() => void) | null
    >(null);
    const [refreshCandidates, setRefreshCandidates] = useState<
      (() => void) | null
    >(null);

    // Handlers to register callbacks
    const handleRegisterCollapseAllCandidates = useCallback(
      (collapseAll: () => void) => {
        setCollapseAllCandidates(() => collapseAll);
      },
      []
    );

    const handleRegisterRefreshTokens = useCallback((refresh: () => void) => {
      setRefreshTokens(() => refresh);
    }, []);

    const handleRegisterRefreshAddedComponents = useCallback(
      (refresh: () => void) => {
        setRefreshAddedComponents(() => refresh);
      },
      []
    );

    const handleRegisterRefreshCandidates = useCallback(
      (refresh: () => void) => {
        setRefreshCandidates(() => refresh);
      },
      []
    );

    // Collapse all handlers
    const handleCollapseAllCandidates = useCallback(() => {
      collapseAllCandidates?.();
    }, [collapseAllCandidates]);

    // Refresh handlers
    const handleRefreshTokens = useCallback(() => {
      refreshTokens?.();
    }, [refreshTokens]);

    const handleRefreshAddedComponents = useCallback(() => {
      refreshAddedComponents?.();
    }, [refreshAddedComponents]);

    const handleRefreshCandidates = useCallback(() => {
      refreshCandidates?.();
    }, [refreshCandidates]);

    // Handle tab change
    const handleTabChange = useCallback((tab: string) => {
      setActiveTab(tab);
    }, []);

    // Toggle filter for Global Tokens section
    const handleToggleFilterTokens = useCallback(() => {
      setShowFilterTokens((prev) => !prev);
    }, []);

    // Toggle filter for Added Components section
    const handleToggleFilterAddedComponents = useCallback(() => {
      setShowFilterAddedComponents((prev) => !prev);
    }, []);

    // Toggle filter for Candidates section
    const handleToggleFilterCandidates = useCallback(() => {
      setShowFilterCandidates((prev) => !prev);
    }, []);

    const handleToggleFilterRegularSessions = useCallback(() => {
      setShowFilterRegularSessions((prev) => !prev);
    }, []);

    const handleToggleFilterPrivateSessions = useCallback(() => {
      setShowFilterPrivateSessions((prev) => !prev);
    }, []);

    // Split sessions into regular and private
    const { regularSessions, privateSessions } = useMemo(() => {
      const regular: BrowserSession[] = [];
      const priv: BrowserSession[] = [];

      for (const session of sessions) {
        if (session.incognito) {
          priv.push(session);
        } else {
          regular.push(session);
        }
      }

      return { regularSessions: regular, privateSessions: priv };
    }, [sessions]);

    // Section header actions for regular browsing
    const regularActions: SectionHeaderAction[] = useMemo(
      () => [
        {
          key: "filter-regular-sessions",
          icon: (
            <FilterIcon
              size={14}
              className={showFilterRegularSessions ? "text-primary-6" : ""}
            />
          ),
          tooltip: "Filter",
          onClick: handleToggleFilterRegularSessions,
        },
        ...(!hideNewSessionActions
          ? [
              {
                key: "new-session",
                icon: <Plus size={14} />,
                tooltip: t("common:controlTower.sidebar.newTab"),
                onClick: onNewSession,
              },
            ]
          : []),
      ],
      [
        showFilterRegularSessions,
        handleToggleFilterRegularSessions,
        hideNewSessionActions,
        onNewSession,
        t,
      ]
    );

    // Section header actions for private browsing
    const privateActions: SectionHeaderAction[] = useMemo(
      () => [
        {
          key: "filter-private-sessions",
          icon: (
            <FilterIcon
              size={14}
              className={showFilterPrivateSessions ? "text-primary-6" : ""}
            />
          ),
          tooltip: "Filter",
          onClick: handleToggleFilterPrivateSessions,
        },
        ...(!hideNewSessionActions
          ? [
              {
                key: "new-private-session",
                icon: <Plus size={14} />,
                tooltip: "New Private Tab",
                onClick: onNewPrivateSession || onNewSession,
              },
            ]
          : []),
      ],
      [
        showFilterPrivateSessions,
        handleToggleFilterPrivateSessions,
        hideNewSessionActions,
        onNewPrivateSession,
        onNewSession,
      ]
    );

    // Section header actions for Global Tokens
    const globalTokensActions: SectionHeaderAction[] = useMemo(
      () =>
        getGlobalTokensActions({
          showFilter: showFilterTokens,
          onToggleFilter: handleToggleFilterTokens,
          onRefresh: handleRefreshTokens,
        }),
      [showFilterTokens, handleToggleFilterTokens, handleRefreshTokens]
    );

    // Section header actions for Added Components
    const addedComponentsActions: SectionHeaderAction[] = useMemo(
      () =>
        getAddedComponentsActions({
          showFilter: showFilterAddedComponents,
          onToggleFilter: handleToggleFilterAddedComponents,
          onRefresh: handleRefreshAddedComponents,
        }),
      [
        showFilterAddedComponents,
        handleToggleFilterAddedComponents,
        handleRefreshAddedComponents,
      ]
    );

    // Section header actions for Candidates
    const candidatesActions: SectionHeaderAction[] = useMemo(
      () =>
        getCandidatesActions({
          showFilter: showFilterCandidates,
          onToggleFilter: handleToggleFilterCandidates,
          onCollapseAll: handleCollapseAllCandidates,
          onRefresh: handleRefreshCandidates,
        }),
      [
        showFilterCandidates,
        handleToggleFilterCandidates,
        handleCollapseAllCandidates,
        handleRefreshCandidates,
      ]
    );

    // Build tabs configuration
    const tabs: PrimarySidebarTab[] = useMemo(
      () => [
        {
          key: "sessions",
          label: t("tabs.sessions"),
          icon: <Globe size={16} strokeWidth={1.75} />,
          sections: [
            {
              key: "regular-browsing",
              title: t("labels.regularBrowsing"),
              content: (
                <SessionsTab
                  sessions={regularSessions}
                  activeSessionId={activeSessionId}
                  onSelectSession={onSelectSession}
                  onCloseSession={onCloseSession}
                  showFilter={showFilterRegularSessions}
                />
              ),
              defaultFlexGrow: 1,
              resizable: true,
              actions: regularActions,
            },
            {
              key: "private-browsing",
              title: t("labels.privateBrowsing"),
              icon: <Globe size={14} strokeWidth={1.75} />,
              content: (
                <SessionsTab
                  sessions={privateSessions}
                  activeSessionId={activeSessionId}
                  onSelectSession={onSelectSession}
                  onCloseSession={onCloseSession}
                  showFilter={showFilterPrivateSessions}
                />
              ),
              defaultFlexGrow: 1,
              defaultCollapsed: true,
              resizable: true,
              actions: privateActions,
            },
          ],
        },
        {
          key: "history",
          label: t("tabs.history"),
          icon: <History size={16} strokeWidth={1.75} />,
          sections: [
            {
              key: "browsing-history",
              title: t("labels.history"),
              icon: <History size={14} strokeWidth={1.75} />,
              content: (
                <HistoryTab
                  sessions={sessions}
                  onOpenHistoryUrl={onOpenHistoryUrl}
                />
              ),
              defaultFlexGrow: 1,
              resizable: true,
            },
          ],
        },
        {
          key: "design",
          label: t("tabs.design"),
          icon: <Pencil size={16} strokeWidth={1.75} />,
          sections: [
            {
              key: "global-tokens",
              title: t("labels.globalTokens"),
              icon: <Code2 size={14} strokeWidth={1.75} />,
              content: (
                <DesignTabGlobalTokens
                  repoPath={repoPath}
                  showFilter={showFilterTokens}
                  onOpenColorTokens={onOpenColorTokens}
                  onRegisterRefresh={handleRegisterRefreshTokens}
                />
              ),
              defaultFlexGrow: 1,
              defaultCollapsed: true,
              resizable: true,
              actions: globalTokensActions,
            },
            {
              key: "added-components",
              title: t("labels.addedComponents"),
              icon: <BookOpen size={14} strokeWidth={1.75} />,
              content: (
                <DesignTabAddedComponents
                  repoPath={repoPath}
                  onSelectComponent={onSelectProjectComponent}
                  selectedPath={selectedProjectPath}
                  showFilter={showFilterAddedComponents}
                  onRegisterRefresh={handleRegisterRefreshAddedComponents}
                />
              ),
              defaultFlexGrow: 1,
              resizable: true,
              actions: addedComponentsActions,
            },
            {
              key: "candidates",
              title: t("labels.candidates"),
              icon: <Code2 size={14} strokeWidth={1.75} />,
              content: (
                <DesignTabRepoComponents
                  repoPath={repoPath}
                  onPreviewComponent={onPreviewRepoComponent}
                  showFilter={showFilterCandidates}
                  onRegisterCollapseAll={handleRegisterCollapseAllCandidates}
                  onRegisterRefresh={handleRegisterRefreshCandidates}
                />
              ),
              defaultFlexGrow: 1,
              resizable: true,
              actions: candidatesActions,
            },
          ],
        },
      ],
      [
        t,
        repoPath,
        regularSessions,
        privateSessions,
        activeSessionId,
        onSelectSession,
        onCloseSession,
        regularActions,
        privateActions,
        sessions,
        onOpenHistoryUrl,
        showFilterTokens,
        showFilterRegularSessions,
        showFilterPrivateSessions,
        onOpenColorTokens,
        handleRegisterRefreshTokens,
        globalTokensActions,
        onSelectProjectComponent,
        selectedProjectPath,
        showFilterAddedComponents,
        handleRegisterRefreshAddedComponents,
        addedComponentsActions,
        onPreviewRepoComponent,
        showFilterCandidates,
        handleRegisterCollapseAllCandidates,
        handleRegisterRefreshCandidates,
        candidatesActions,
      ]
    );

    return (
      <PrimarySidebarLayout
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabIconOnly={true}
      />
    );
  }
);

BrowserPrimarySidebar.displayName = "BrowserPrimarySidebar";

export default BrowserPrimarySidebar;
