import { Globe, Keyboard } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { STORY_SYNC_AUTH_METHOD } from "@src/api/http/integrations";
import { OAUTH_FLOW_KIND, type OAuthFlowStart } from "@src/api/http/project";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import type { ChannelProbeResult } from "@src/modules/MainApp/Integrations/Connections/Channels/types";
import GitHubConnectWebview from "@src/modules/MainApp/Integrations/Connections/Git/GitHubConnectWebview";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import { CHANNEL_FORMS } from "./SetupForms";
import {
  type ProjectSyncAuthMethod,
  SERVICE_CONFIG,
  type ServiceType,
} from "./channelWizardTypes";

interface ChannelContentProps {
  selectedType: string | null;
  channelConfig: Record<string, unknown>;
  channelIsValid: boolean;
  probing: boolean;
  probeResult: ChannelProbeResult | null;
  probeErrorDismissed: boolean;
  onConfigChange: (updates: Record<string, unknown>) => void;
  onProbe: () => void;
  onDismissProbeError: () => void;
}

export const ChannelContent: React.FC<ChannelContentProps> = ({
  selectedType,
  channelConfig,
  channelIsValid,
  probing,
  probeResult,
  probeErrorDismissed,
  onConfigChange,
  onProbe,
  onDismissProbeError,
}) => {
  const { t } = useTranslation("integrations");
  const ChannelForm = selectedType ? CHANNEL_FORMS[selectedType] : null;

  if (!selectedType) return null;

  return (
    <>
      {ChannelForm && (
        <ChannelForm config={channelConfig} onChange={onConfigChange} />
      )}
      <SectionContainer>
        <SectionRow
          label={t("integrations.testConnection")}
          description={t("integrations.testConnectionDesc")}
          required
        >
          <Button
            variant={probeResult?.ok ? "success" : "primary"}
            appearance={probeResult?.ok ? "outline" : undefined}
            size="default"
            loading={probing}
            disabled={!channelIsValid || probing}
            onClick={onProbe}
            className="h-8 min-h-8"
          >
            {probeResult?.ok
              ? `✓ ${t("integrations.probeSuccess")}`
              : t("integrations.testConnection")}
          </Button>
        </SectionRow>
      </SectionContainer>
      {probeResult && !probeResult.ok && !probeErrorDismissed && (
        <div className="mt-3">
          <InlineAlert type="danger" onClose={onDismissProbeError}>
            {probeResult.error || t("integrations.probeFailed")}
          </InlineAlert>
        </div>
      )}
    </>
  );
};

interface ServiceContentProps {
  selectedType: string | null;
  serviceApiKey: string;
  onServiceApiKeyChange: (apiKey: string) => void;
}

export const ServiceContent: React.FC<ServiceContentProps> = ({
  selectedType,
  serviceApiKey,
  onServiceApiKeyChange,
}) => {
  const { t } = useTranslation("integrations");
  const serviceConfig = selectedType
    ? SERVICE_CONFIG[selectedType as ServiceType]
    : null;

  if (!selectedType || !serviceConfig) return null;

  return (
    <SectionContainer>
      <SectionRow
        label={t(serviceConfig.labelKey)}
        description={t(serviceConfig.descriptionKey)}
        required
      >
        <Input
          value={serviceApiKey}
          onChange={onServiceApiKeyChange}
          placeholder={t(serviceConfig.placeholderKey)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

interface ProjectContentProps {
  selectedType: string | null;
  accountName: string;
  isDuplicateName: boolean;
  projectAuthMethod: ProjectSyncAuthMethod;
  projectToken: string;
  projectSubmitting: boolean;
  projectSubmitError: string | null;
  projectOAuthFlow: OAuthFlowStart | null;
  onProjectMethodChange: (method: ProjectSyncAuthMethod) => void;
  onProjectTokenChange: (token: string) => void;
  onProjectSubmit: () => void;
}

export const ProjectContent: React.FC<ProjectContentProps> = ({
  selectedType,
  accountName,
  isDuplicateName,
  projectAuthMethod,
  projectToken,
  projectSubmitting,
  projectSubmitError,
  projectOAuthFlow,
  onProjectMethodChange,
  onProjectTokenChange,
  onProjectSubmit,
}) => {
  const { t } = useTranslation("integrations");
  const projectMethodOptions = useMemo<
    SelectionGridOption<ProjectSyncAuthMethod>[]
  >(
    () => [
      {
        key: STORY_SYNC_AUTH_METHOD.OAUTH,
        label: t("keyVault.guidedSetup"),
        icon: Globe,
      },
      {
        key: STORY_SYNC_AUTH_METHOD.PAT,
        label: t("keyVault.enterToken"),
        icon: Keyboard,
      },
    ],
    [t]
  );

  if (!selectedType) return null;

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={t("keyVault.setupMethod")}
          description={t("keyVault.setupMethodDesc")}
          layout="vertical"
          required
        >
          <SelectionGrid
            options={projectMethodOptions}
            selected={projectAuthMethod}
            cardVariant="subtle"
            onSelect={onProjectMethodChange}
          />
        </SectionRow>
      </SectionContainer>

      {projectAuthMethod === STORY_SYNC_AUTH_METHOD.PAT && (
        <SectionContainer>
          <SectionRow
            label={t("projectConnections.personalAccessToken")}
            description={t("projectConnections.personalAccessTokenDesc")}
            required
          >
            <Input
              value={projectToken}
              onChange={onProjectTokenChange}
              placeholder={t(
                "projectConnections.personalAccessTokenPlaceholder"
              )}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        </SectionContainer>
      )}

      {projectAuthMethod === STORY_SYNC_AUTH_METHOD.OAUTH && (
        <SectionContainer>
          <SectionRow
            label={
              projectOAuthFlow
                ? t("projectConnections.oauthWaiting")
                : t("keyVault.signIn")
            }
            description={
              projectOAuthFlow
                ? projectOAuthFlow.kind === OAUTH_FLOW_KIND.DEVICE
                  ? t("projectConnections.oauthDeviceDesc")
                  : t("projectConnections.oauthBrowserDesc")
                : t("keyVault.signInDesc")
            }
            required
          >
            {projectOAuthFlow ? (
              projectOAuthFlow.kind === OAUTH_FLOW_KIND.DEVICE ? (
                <div className="flex flex-col gap-2 text-[12px] text-text-2">
                  <Input
                    value={projectOAuthFlow.user_code}
                    readOnly
                    style={SECTION_CONTROL_STYLE}
                  />
                  <a
                    className="text-primary-6 hover:underline"
                    href={projectOAuthFlow.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {projectOAuthFlow.verification_uri}
                  </a>
                </div>
              ) : (
                <div className="text-[12px] text-text-2">
                  {t("projectConnections.oauthBrowserOpened")}
                </div>
              )
            ) : (
              <Button
                variant="primary"
                size="default"
                loading={projectSubmitting}
                disabled={
                  !accountName.trim() || isDuplicateName || projectSubmitting
                }
                onClick={onProjectSubmit}
                className="h-8 min-h-8"
              >
                {t("keyVault.signIn")}
              </Button>
            )}
          </SectionRow>
        </SectionContainer>
      )}

      {projectSubmitError && (
        <div className="mt-3">
          <InlineAlert type="danger">{projectSubmitError}</InlineAlert>
        </div>
      )}
    </>
  );
};

interface GitContentProps {
  selectedType: string | null;
  gitStoreError: string | null;
  onConnected: () => void;
  onBrowserStateChange: (open: boolean) => void;
  onDetectReady: (ready: boolean) => void;
  onTokenSelect: (token: string | null) => void;
}

export const GitContent: React.FC<GitContentProps> = ({
  selectedType,
  gitStoreError,
  onConnected,
  onBrowserStateChange,
  onDetectReady,
  onTokenSelect,
}) => {
  const { t } = useTranslation("integrations");

  if (!selectedType) return null;

  return (
    <>
      <GitHubConnectWebview
        embedded
        onConnected={onConnected}
        onBrowserStateChange={onBrowserStateChange}
        onDetectReady={onDetectReady}
        onTokenSelect={onTokenSelect}
      />
      {gitStoreError && (
        <InlineAlert type="danger" title={t("git.connectionFailed")}>
          {gitStoreError}
        </InlineAlert>
      )}
    </>
  );
};
