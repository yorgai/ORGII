/**
 * Preview panel for a service integration (e.g. Smithery API key).
 * Shows current key (masked) and an input to update it.
 */
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PanelFooter,
  PanelHeader,
} from "@src/modules/shared/layouts/blocks";

import { getNestedString } from "../../../../AgentOrgs/config/osAgent/utils";
import { DetailHeaderClose } from "../../../shared/DetailHeaderClose";
import { SERVICE_TYPES, type ServiceType } from "../../Channels";

const SERVICE_CONFIG_PATHS: Record<ServiceType, string> = {
  smithery: "tools.mcpSmithery.apiKey",
};

interface ServicePreviewPanelProps {
  serviceType: ServiceType;
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
  onClose: () => void;
  onExpand?: () => void;
}

const ServicePreviewPanel: React.FC<ServicePreviewPanelProps> = ({
  serviceType,
  config,
  update,
  onClose,
  onExpand,
}) => {
  const { t: tIntegrations } = useTranslation("integrations");
  const configPath = SERVICE_CONFIG_PATHS[serviceType];
  const currentKey = getNestedString(config, configPath, "");
  const _svcDef = SERVICE_TYPES.find((st) => st.type === serviceType);
  const [localKey, setLocalKey] = useState(currentKey);

  const handleSave = useCallback(() => {
    update(configPath, localKey.trim());
  }, [configPath, localKey, update]);

  const maskedKey = currentKey
    ? `${currentKey.slice(0, 6)}${"*".repeat(Math.max(0, currentKey.length - 6))}`
    : "";

  return (
    <DetailPanelContainer>
      <PanelHeader
        title={tIntegrations("common:common.preview")}
        actions={<DetailHeaderClose onClick={onClose} onExpand={onExpand} />}
      />
      <div className={DETAIL_PANEL_TOKENS.scrollContent}>
        <div className={DETAIL_PANEL_TOKENS.contentWidthWithPadding}>
          <div className="flex flex-col gap-3 rounded-lg bg-fill-2 p-4">
            {currentKey && (
              <div className="flex items-center gap-2 text-xs text-text-2">
                <span className="text-text-3">
                  {tIntegrations("services.currentKey")}:
                </span>
                <code className="rounded bg-fill-3 px-1.5 py-0.5 text-text-2">
                  {maskedKey}
                </code>
              </div>
            )}
            <Input
              value={localKey}
              onChange={setLocalKey}
              placeholder={tIntegrations("services.smitheryApiKeyPlaceholder")}
              className="w-full"
            />
            <p className="text-xs text-text-3">
              {tIntegrations("services.smitheryApiKeyDesc")}
            </p>
          </div>
        </div>
      </div>
      <PanelFooter
        primaryAction={{
          label: tIntegrations("common:actions.save"),
          onClick: handleSave,
          disabled: !localKey.trim() || localKey.trim() === currentKey,
        }}
      />
    </DetailPanelContainer>
  );
};

export default ServicePreviewPanel;
