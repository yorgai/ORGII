import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { STORY_SYNC_AUTH_METHOD } from "@src/api/http/integrations";
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

export interface ChannelWizardStateOptions {
  existingAccounts: Map<string, string[]>;
}

export function useChannelWizardState({
  existingAccounts,
}: ChannelWizardStateOptions) {
  const [category, setCategory] = useState<WizardCategory | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [errors, setErrors] = useState<ChannelWizardErrors>({});
  const [channelConfig, setChannelConfig] = useState<Record<string, unknown>>(
    {}
  );
  const [gitBrowserOpen, setGitBrowserOpen] = useState(false);
  const [gitDetectReady, setGitDetectReady] = useState(false);
  const [gitSelectedToken, setGitSelectedToken] = useState<string | null>(null);
  const [gitStoring, setGitStoring] = useState(false);
  const [gitStoreError, setGitStoreError] = useState<string | null>(null);
  const [serviceApiKey, setServiceApiKey] = useState("");
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

  const isGit = category === "git";
  const isService = category === "services";
  const isProjects = category === "projects";
  const isChannels = category === "channels";

  const clearSelectedFlowState = useCallback(() => {
    setErrors((previousErrors) => ({ ...previousErrors, type: undefined }));
    setChannelConfig({});
    setProjectToken("");
    setProjectSubmitError(null);
    setProjectOAuthFlow(null);
    setProbeResult(null);
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
    gitBrowserOpen,
    gitDetectReady,
    gitSelectedToken,
    gitStoring,
    gitStoreError,
    handleAccountNameChange,
    handleConfigChange,
    handleProbe,
    handleProjectMethodChange,
    handleSelectType,
    handleSelectionClear,
    isChannels,
    isDuplicateName,
    isGit,
    isProjects,
    isService,
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
    serviceApiKey,
    setErrors,
    setGitBrowserOpen,
    setGitDetectReady,
    setGitSelectedToken,
    setGitStoreError,
    setGitStoring,
    setProbeErrorDismissed,
    setProjectOAuthFlow,
    setProjectSubmitError,
    setProjectSubmitting,
    setProjectToken,
    setServiceApiKey,
  };
}
