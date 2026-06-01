import { LogIn } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ClaudeCodeSessionSetup } from "@src/features/SessionSetup";
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import type { ClaudeCodeSetupProps } from "./types";

const ClaudeCodeSetup: React.FC<ClaudeCodeSetupProps> = ({
  tokenDetected,
  tokenError,
  onClearTokenError,
  onSessionCaptured,
  preselectedMethod,
  browserOpen,
  setBrowserOpen,
  browserCloseSignal,
}) => {
  const { t } = useTranslation("integrations");

  const setupOptions: SelectionGridOption[] = useMemo(
    () => [{ key: "signin", label: t("keyVault.signIn"), icon: LogIn }],
    [t]
  );

  return (
    <div
      className={
        browserOpen
          ? "flex h-full min-h-0 flex-1 flex-col"
          : SECTION_GAP_CLASSES
      }
    >
      {!preselectedMethod && (
        <SectionContainer>
          <SectionRow
            label={t("keyVault.setupMethod")}
            description={t("keyVault.claudeCodeSetupMethodDesc")}
            layout="vertical"
            required
          >
            <SelectionGrid
              options={setupOptions}
              selected="signin"
              cardVariant="subtle"
              onSelect={() => {}}
            />
          </SectionRow>
        </SectionContainer>
      )}

      <ClaudeCodeSessionSetup
        tokenDetected={tokenDetected}
        tokenError={tokenError}
        onClearTokenError={onClearTokenError}
        onSessionCaptured={onSessionCaptured}
        onBrowserStateChange={setBrowserOpen}
        closeSignal={browserCloseSignal}
      />
    </div>
  );
};

export { ClaudeCodeSetup };
