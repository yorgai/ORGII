/**
 * Git Settings Section
 *
 * Pull strategy, auto-fetch, sync preferences, and link to Git Proxy (Network).
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { useAtom, useSetAtom } from "jotai";
import { SquareArrowOutUpRight } from "lucide-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import Button from "@src/components/Button";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import { buildSettingsPath } from "@src/config/mainAppPaths";
import { HintWithInfo } from "@src/modules/shared/layouts/blocks";
import { monitorActiveTabAtom } from "@src/store";
import {
  GIT_EXECUTABLE_MODES,
  GIT_PULL_STRATEGIES,
  type GitExecutableMode,
  type GitPullStrategy,
  gitAutoFetchAtom,
  gitAutoFetchIntervalAtom,
  gitExecutableModeAtom,
  gitPullStrategyAtom,
  gitWorktreeCleanupIntervalHoursAtom,
  gitWorktreeMaxCountAtom,
} from "@src/store/ui/editorSettingsAtom";

const AUTO_FETCH_INTERVALS = [
  { value: 30, labelKey: "editor.git.interval30s" },
  { value: 60, labelKey: "editor.git.interval1m" },
  { value: 180, labelKey: "editor.git.interval3m" },
  { value: 300, labelKey: "editor.git.interval5m" },
  { value: 600, labelKey: "editor.git.interval10m" },
  { value: 1800, labelKey: "editor.git.interval30m" },
  { value: 3600, labelKey: "editor.git.interval1h" },
];

const WORKTREE_MAX_COUNT_OPTIONS = [1, 2, 4, 6, 8, 12, 16, 24, 32].map(
  (count) => ({
    value: count,
    label: String(count),
  })
);

const WORKTREE_CLEANUP_INTERVAL_OPTIONS = [1, 3, 6, 12, 24, 48, 72, 168].map(
  (hours) => ({
    value: hours,
    labelKey: `editor.git.worktreeCleanupInterval${hours}h`,
  })
);

const GitSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const setMonitorActiveTab = useSetAtom(monitorActiveTabAtom);
  const [gitExecutableMode, setGitExecutableMode] = useAtom(
    gitExecutableModeAtom
  );
  const [pullStrategy, setPullStrategy] = useAtom(gitPullStrategyAtom);
  const [autoFetch, setAutoFetch] = useAtom(gitAutoFetchAtom);
  const [autoFetchInterval, setAutoFetchInterval] = useAtom(
    gitAutoFetchIntervalAtom
  );
  const [worktreeMaxCount, setWorktreeMaxCount] = useAtom(
    gitWorktreeMaxCountAtom
  );
  const [worktreeCleanupIntervalHours, setWorktreeCleanupIntervalHours] =
    useAtom(gitWorktreeCleanupIntervalHoursAtom);

  const handleOpenGitProxy = useCallback(() => {
    setMonitorActiveTab("network");
    navigate(buildSettingsPath({ section: "monitor" }));
  }, [navigate, setMonitorActiveTab]);

  return (
    <>
      <SectionContainer title={t("editor.git.title")}>
        <SectionRow
          label={t("editor.git.pullStrategy")}
          description={t("editor.git.pullStrategyDesc")}
        >
          <div className="flex items-center gap-2">
            <HintWithInfo
              content={t("editor.git.pullStrategyHint")}
              position="left"
            />
            <Select
              value={pullStrategy}
              size="default"
              onChange={(value) => setPullStrategy(value as GitPullStrategy)}
              options={GIT_PULL_STRATEGIES.map((strategy) => ({
                label: t(strategy.labelKey),
                value: strategy.value,
              }))}
              style={SECTION_CONTROL_STYLE}
            />
          </div>
        </SectionRow>

        <SectionRow
          label={t("editor.git.autoFetch")}
          description={t("editor.git.autoFetchDesc")}
        >
          <Switch checked={autoFetch} onChange={setAutoFetch} />
        </SectionRow>

        {autoFetch && (
          <SectionRow
            label={t("editor.git.autoFetchInterval")}
            description={t("editor.git.autoFetchIntervalDesc")}
            indent
          >
            <Select
              value={autoFetchInterval}
              size="default"
              onChange={(value) => setAutoFetchInterval(Number(value))}
              options={AUTO_FETCH_INTERVALS.map((interval) => ({
                label: t(interval.labelKey),
                value: interval.value,
              }))}
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        )}

        <div data-testid="settings-git-worktree-max-count-row">
          <SectionRow
            label={t("editor.git.worktreeMaxCount")}
            description={t("editor.git.worktreeMaxCountDesc")}
          >
            <Select
              value={worktreeMaxCount}
              size="default"
              onChange={(value) => setWorktreeMaxCount(Number(value))}
              options={WORKTREE_MAX_COUNT_OPTIONS}
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        </div>

        <div data-testid="settings-git-worktree-cleanup-interval-row">
          <SectionRow
            label={t("editor.git.worktreeCleanupInterval")}
            description={t("editor.git.worktreeCleanupIntervalDesc")}
          >
            <Select
              value={worktreeCleanupIntervalHours}
              size="default"
              onChange={(value) =>
                setWorktreeCleanupIntervalHours(Number(value))
              }
              options={WORKTREE_CLEANUP_INTERVAL_OPTIONS.map((interval) => ({
                label: t(interval.labelKey),
                value: interval.value,
              }))}
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        </div>
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("editor.git.executableMode")}
          description={t("editor.git.executableModeDesc")}
        >
          <Select
            value={gitExecutableMode}
            size="default"
            onChange={(value) =>
              setGitExecutableMode(value as GitExecutableMode)
            }
            options={GIT_EXECUTABLE_MODES.map((mode) => ({
              label: t(mode.labelKey),
              value: mode.value,
            }))}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer>
        <SectionRow
          label={t("editor.git.gitProxyLink")}
          description={t("editor.git.gitProxyLinkDesc")}
        >
          <Button
            size="default"
            icon={<SquareArrowOutUpRight size={14} />}
            iconPosition="right"
            onClick={handleOpenGitProxy}
          >
            {t("common:actions.configure")}
          </Button>
        </SectionRow>
      </SectionContainer>
    </>
  );
};

export default GitSection;
