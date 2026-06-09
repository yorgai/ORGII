import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  STORY_SYNC_ADAPTER,
  STORY_SYNC_AUTH_METHOD,
} from "@src/api/http/integrations";
import type { OAuthFlowStart } from "@src/api/http/project";
import { probeChannel } from "@src/modules/MainApp/Integrations/Connections/Channels/api";
import type { ChannelProbeResult } from "@src/modules/MainApp/Integrations/Connections/Channels/types";

import { canSubmitChannel } from "./SetupForms";
import {
  type ChannelWizardErrors,
  hasDuplicateAccountName,
  normalizeAccountName,
} from "./channelWizardHelpers";
import type {
  ProjectSyncAuthMethod,
  WizardCategory,
} from "./channelWizardTypes";

/// One credential the host-scan flow turned up. Mirrors the variants the
/// GitHub setup's "Detect" tile can act on:
/// - `"gh_cli"` / `"credential_helper"` → call `createFromScan` with the token.
/// - `"ssh_key"` → call `createFromSsh` with the private-key path
///   (derived by stripping the `.pub` from the public key path the scan
///   surfaces).
export interface GitScanCandidate {
  kind: "gh_cli" | "credential_helper" | "ssh_key";
  label: string;
  /// Token (for gh_cli / credential_helper) or absolute path to the
  /// **private** SSH key (for ssh_key). The wizard's submit handler
  /// dispatches based on `kind`, not on this field's shape.
  secret: string;
  username?: string;
}

export interface ChannelWizardStateOptions {
  existingAccounts: Map<string, string[]>;
  initialCategory?: WizardCategory | null;
  initialType?: string | null;
}

export function useChannelWizardState({
  existingAccounts,
  initialCategory = null,
  initialType = null,
}: ChannelWizardStateOptions) {
  const [category, setCategory] = useState<WizardCategory | null>(
    initialCategory
  );
  const [selectedType, setSelectedType] = useState<string | null>(initialType);
  const [accountName, setAccountName] = useState("");
  const [errors, setErrors] = useState<ChannelWizardErrors>({});
  const [channelConfig, setChannelConfig] = useState<Record<string, unknown>>(
    {}
  );
  // GitHub setup state — picks one of four methods (scan / oauth / pat /
  // ssh) and carries per-method scratch values. `gitMethod` defaults
  // to `null` so the user sees the picker before any input.
  const [gitMethod, setGitMethod] = useState<ProjectSyncAuthMethod | null>(
    null
  );
  const [gitPat, setGitPat] = useState("");
  const [gitSshKeyPath, setGitSshKeyPath] = useState("");
  const [gitScanCandidate, setGitScanCandidate] =
    useState<GitScanCandidate | null>(null);
  const [gitOAuthFlow, setGitOAuthFlow] = useState<OAuthFlowStart | null>(null);
  const [gitSubmitting, setGitSubmitting] = useState(false);
  const [gitSubmitError, setGitSubmitError] = useState<string | null>(null);
  const [projectAuthMethod, setProjectAuthMethod] =
    useState<ProjectSyncAuthMethod>(STORY_SYNC_AUTH_METHOD.OAUTH);
  const [projectToken, setProjectToken] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectSubmitError, setProjectSubmitError] = useState<string | null>(
    null
  );
  const [projectOAuthFlow, setProjectOAuthFlow] =
    useState<OAuthFlowStart | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(
    null
  );
  const [probeErrorDismissed, setProbeErrorDismissed] = useState(false);
  const probeIdRef = useRef(0);

  useEffect(() => {
    if (probeResult && !probeResult.ok) setProbeErrorDismissed(false);
  }, [probeResult]);

  const normalizedAccountName = useMemo(
    () => normalizeAccountName(accountName),
    [accountName]
  );

  const isDuplicateName = useMemo(
    () =>
      hasDuplicateAccountName(
        selectedType,
        normalizedAccountName,
        existingAccounts
      ),
    [selectedType, normalizedAccountName, existingAccounts]
  );

  const channelIsValid = selectedType
    ? canSubmitChannel(selectedType, channelConfig)
    : false;

  const isGit = selectedType === STORY_SYNC_ADAPTER.GITHUB;
  const isProjects = category === "projects" && !isGit;
  const isChannels = category === "channels";

  const clearSelectedFlowState = useCallback(() => {
    setErrors((previousErrors) => ({ ...previousErrors, type: undefined }));
    setChannelConfig({});
    setProjectToken("");
    setProjectSubmitError(null);
    setProjectOAuthFlow(null);
    setProbeResult(null);
    // Reset every `git` scratch field too — the user just clicked a
    // different adapter card and any half-typed PAT / chosen SSH key
    // is no longer meaningful. Leaving stale state would cause the
    // next visit to the Git card to show a half-filled form.
    setGitMethod(null);
    setGitPat("");
    setGitSshKeyPath("");
    setGitScanCandidate(null);
    setGitOAuthFlow(null);
    setGitSubmitError(null);
  }, []);

  const handleGitMethodChange = useCallback((method: ProjectSyncAuthMethod) => {
    setGitMethod(method);
    setGitPat("");
    setGitSshKeyPath("");
    setGitScanCandidate(null);
    setGitOAuthFlow(null);
    setGitSubmitError(null);
  }, []);

  const handleSelectType = useCallback(
    (nextCategory: WizardCategory, nextType: string) => {
      setCategory(nextCategory);
      setSelectedType(nextType);
      clearSelectedFlowState();
    },
    [clearSelectedFlowState]
  );

  const handleSelectionClear = useCallback(() => {
    setCategory(null);
    setSelectedType(null);
    clearSelectedFlowState();
  }, [clearSelectedFlowState]);

  const handleAccountNameChange = useCallback((name: string) => {
    setAccountName(name);
    setErrors((previousErrors) => ({ ...previousErrors, name: undefined }));
  }, []);

  const handleProjectMethodChange = useCallback(
    (method: ProjectSyncAuthMethod) => {
      setProjectAuthMethod(method);
      setProjectToken("");
      setProjectSubmitError(null);
      setProjectOAuthFlow(null);
    },
    []
  );

  const handleConfigChange = useCallback((updates: Record<string, unknown>) => {
    setChannelConfig((previousConfig) => ({ ...previousConfig, ...updates }));
  }, []);

  const handleProbe = useCallback(async () => {
    if (!selectedType) return;
    const currentId = ++probeIdRef.current;
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await probeChannel(selectedType, channelConfig);
      if (probeIdRef.current !== currentId) return;
      setProbeResult(result);
    } catch (error) {
      if (probeIdRef.current !== currentId) return;
      setProbeResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        elapsed_ms: 0,
      });
    } finally {
      if (probeIdRef.current === currentId) setProbing(false);
    }
  }, [selectedType, channelConfig]);

  return {
    accountName,
    category,
    channelConfig,
    channelIsValid,
    errors,
    gitMethod,
    gitOAuthFlow,
    gitPat,
    gitScanCandidate,
    gitSshKeyPath,
    gitSubmitError,
    gitSubmitting,
    handleAccountNameChange,
    handleConfigChange,
    handleGitMethodChange,
    handleProbe,
    handleProjectMethodChange,
    handleSelectType,
    handleSelectionClear,
    isChannels,
    isDuplicateName,
    isGit,
    isProjects,
    normalizedAccountName,
    probeErrorDismissed,
    probeResult,
    probing,
    projectAuthMethod,
    projectOAuthFlow,
    projectSubmitError,
    projectSubmitting,
    projectToken,
    selectedType,
    setErrors,
    setGitOAuthFlow,
    setGitPat,
    setGitScanCandidate,
    setGitSshKeyPath,
    setGitSubmitError,
    setGitSubmitting,
    setProbeErrorDismissed,
    setProjectOAuthFlow,
    setProjectSubmitError,
    setProjectSubmitting,
    setProjectToken,
  };
}
