/**
 * ChannelWizard Component
 *
 * Single-step wizard for adding a new integration.
 * All categories (Git, Channels, Services) complete in one step.
 * Git browser flows collapse the selectors while the webview is active.
 *
 * Uses SectionContainer + SectionRow for form fields and SelectionGrid for
 * grouped integration choices, inside WizardShell + WizardStepLayout.
 */
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  STORY_SYNC_AUTH_METHOD,
  syncConnectionsApi,
} from "@src/api/http/integrations";
import { storeDetectedGitHubToken } from "@src/api/tauri/github";
import { useServiceAuthState } from "@src/hooks/auth";
import { WizardShell } from "@src/scaffold/WizardSystem/primitives";

import {
  ChannelContent,
  GitContent,
  ProjectContent,
  ServiceContent,
} from "./ChannelSections";
import {
  ChannelWizardActions,
  ChannelWizardFooterStatus,
} from "./ChannelWizardActions";
import IntegrationSelection from "./IntegrationSelection";
import {
  buildConfigData,
  extractHostedUserId,
  validateAccountName,
} from "./channelWizardHelpers";
import type { ProjectSyncAdapterType, ServiceType } from "./channelWizardTypes";
import { useChannelWizardState } from "./useChannelWizardState";

export { SERVICE_TYPES } from "./channelWizardTypes";
export type { ServiceType } from "./channelWizardTypes";

export interface ChannelWizardProps {
  onSubmit: (
    channelType: string,
    accountId: string,
    configData: Record<string, unknown>
  ) => void;
  onCancel: () => void;
  existingAccounts: Map<string, string[]>;
  onGitConnected?: () => void;
  onProjectsConnected?: () => void | Promise<void>;
  onServiceSubmit?: (serviceType: ServiceType, apiKey: string) => void;
}

const ChannelWizard: React.FC<ChannelWizardProps> = ({
  onSubmit,
  onCancel,
  existingAccounts,
  onGitConnected,
  onProjectsConnected,
  onServiceSubmit,
}) => {
  const { t } = useTranslation("integrations");
  const { token: hostedToken } = useServiceAuthState();
  const wizardState = useChannelWizardState({ existingAccounts });

  const {
    accountName,
    category,
    channelConfig,
    channelIsValid,
    errors,
    gitBrowserOpen,
    gitDetectReady,
    gitSelectedToken,
    gitStoreError,
    gitStoring,
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
  } = wizardState;

  const handleSubmit = useCallback(() => {
    if (!selectedType) return;

    const validationErrors = validateAccountName(accountName, isDuplicateName, {
      required: t("keyVault.nameRequired"),
      duplicate: t("integrations.accountNameDuplicate"),
    });
    if (validationErrors.name) {
      setErrors(validationErrors);
      return;
    }

    const configData = buildConfigData(channelConfig);
    onSubmit(selectedType, normalizedAccountName, configData);
  }, [
    selectedType,
    accountName,
    isDuplicateName,
    normalizedAccountName,
    channelConfig,
    t,
    onSubmit,
    setErrors,
  ]);

  const handleGitConnected = useCallback(() => {
    onGitConnected?.();
    onCancel();
  }, [onGitConnected, onCancel]);

  const handleGitAdd = useCallback(async () => {
    if (!gitSelectedToken || !hostedToken) {
      handleGitConnected();
      return;
    }
    setGitStoring(true);
    setGitStoreError(null);
    try {
      const userId = extractHostedUserId(hostedToken);
      await storeDetectedGitHubToken(userId, gitSelectedToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[GitHub][Detect] Failed to store token:", message);
      setGitStoreError(message);
      setGitStoring(false);
      return;
    }
    setGitStoring(false);
    onCancel();
  }, [
    gitSelectedToken,
    hostedToken,
    handleGitConnected,
    onCancel,
    setGitStoreError,
    setGitStoring,
  ]);

  const handleServiceSubmit = useCallback(() => {
    if (!selectedType || !serviceApiKey.trim()) return;
    onServiceSubmit?.(selectedType as ServiceType, serviceApiKey.trim());
    onCancel();
  }, [selectedType, serviceApiKey, onServiceSubmit, onCancel]);

  const handleProjectSubmit = useCallback(async () => {
    if (!selectedType) return;

    const validationErrors = validateAccountName(accountName, isDuplicateName, {
      required: t("keyVault.nameRequired"),
      duplicate: t("integrations.accountNameDuplicate"),
    });
    if (validationErrors.name) {
      setErrors(validationErrors);
      return;
    }

    if (
      projectAuthMethod === STORY_SYNC_AUTH_METHOD.PAT &&
      !projectToken.trim()
    ) {
      setProjectSubmitError(t("projectConnections.tokenRequired"));
      return;
    }

    setProjectSubmitting(true);
    setProjectSubmitError(null);
    try {
      const adapterId = selectedType as ProjectSyncAdapterType;
      if (projectAuthMethod === STORY_SYNC_AUTH_METHOD.PAT) {
        await syncConnectionsApi.createPat(
          adapterId,
          accountName.trim(),
          projectToken.trim()
        );
      } else {
        const started = await syncConnectionsApi.oauthStart(
          adapterId,
          accountName.trim()
        );
        setProjectOAuthFlow(started.flow);
        await syncConnectionsApi.oauthComplete(started.connection.id);
      }
      await onProjectsConnected?.();
      onCancel();
    } catch (error) {
      setProjectSubmitError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setProjectSubmitting(false);
    }
  }, [
    selectedType,
    accountName,
    isDuplicateName,
    projectAuthMethod,
    projectToken,
    t,
    onProjectsConnected,
    onCancel,
    setErrors,
    setProjectOAuthFlow,
    setProjectSubmitError,
    setProjectSubmitting,
  ]);

  const stepActions = (
    <ChannelWizardActions
      categorySelected={!!category}
      isChannels={isChannels}
      isService={isService}
      isProjects={isProjects}
      selectedType={selectedType}
      accountName={accountName}
      isDuplicateName={isDuplicateName}
      channelIsValid={channelIsValid}
      serviceApiKey={serviceApiKey}
      projectAuthMethod={projectAuthMethod}
      projectToken={projectToken}
      projectSubmitting={projectSubmitting}
      gitDetectReady={gitDetectReady}
      gitStoring={gitStoring}
      onChannelSubmit={handleSubmit}
      onServiceSubmit={handleServiceSubmit}
      onProjectSubmit={handleProjectSubmit}
      onGitAdd={handleGitAdd}
    />
  );

  const footerLeft = (
    <ChannelWizardFooterStatus
      isChannels={isChannels}
      verified={!!probeResult?.ok}
    />
  );

  const channelContent = isChannels ? (
    <ChannelContent
      selectedType={selectedType}
      channelConfig={channelConfig}
      channelIsValid={channelIsValid}
      probing={probing}
      probeResult={probeResult}
      probeErrorDismissed={probeErrorDismissed}
      onConfigChange={handleConfigChange}
      onProbe={handleProbe}
      onDismissProbeError={() => setProbeErrorDismissed(true)}
    />
  ) : null;

  const serviceContent = isService ? (
    <ServiceContent
      selectedType={selectedType}
      serviceApiKey={serviceApiKey}
      onServiceApiKeyChange={setServiceApiKey}
    />
  ) : null;

  const projectContent = isProjects ? (
    <ProjectContent
      selectedType={selectedType}
      accountName={accountName}
      isDuplicateName={isDuplicateName}
      projectAuthMethod={projectAuthMethod}
      projectToken={projectToken}
      projectSubmitting={projectSubmitting}
      projectSubmitError={projectSubmitError}
      projectOAuthFlow={projectOAuthFlow}
      onProjectMethodChange={handleProjectMethodChange}
      onProjectTokenChange={setProjectToken}
      onProjectSubmit={handleProjectSubmit}
    />
  ) : null;

  const gitContent = isGit ? (
    <GitContent
      selectedType={selectedType}
      gitStoreError={gitStoreError}
      onConnected={handleGitConnected}
      onBrowserStateChange={setGitBrowserOpen}
      onDetectReady={setGitDetectReady}
      onTokenSelect={setGitSelectedToken}
    />
  ) : null;

  return (
    <WizardShell title={t("integrations.addAccount")} onCancel={onCancel}>
      <IntegrationSelection
        category={category}
        selectedType={selectedType}
        onSelectType={handleSelectType}
        onClearSelection={handleSelectionClear}
        accountName={accountName}
        onAccountNameChange={handleAccountNameChange}
        errors={errors}
        isDuplicateName={isDuplicateName}
        isGit={isGit}
        totalSteps={1}
        actions={stepActions}
        onCancel={onCancel}
        footerLeft={footerLeft}
        channelContent={channelContent}
        serviceContent={serviceContent}
        projectContent={projectContent}
        gitContent={gitContent}
        gitBrowserOpen={gitBrowserOpen}
      />
    </WizardShell>
  );
};

export default ChannelWizard;
