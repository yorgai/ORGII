import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const MatrixForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.matrixHomeserver")} required>
        <Input
          value={getString(config, "homeserverUrl")}
          onChange={(val: string) => onChange({ homeserverUrl: val })}
          placeholder="https://matrix.org"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.matrixUserId")}>
        <Input
          value={getString(config, "userId")}
          onChange={(val: string) => onChange({ userId: val })}
          placeholder="@bot:matrix.org"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.matrixAccessToken")}>
        <Input
          value={getString(config, "accessToken")}
          onChange={(val: string) => onChange({ accessToken: val })}
          type="password"
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.matrixPassword")}>
        <Input
          value={getString(config, "password")}
          onChange={(val: string) => onChange({ password: val })}
          type="password"
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.allowFrom")}>
        <Input
          value={getString(config, "allowFrom")}
          onChange={(val: string) => onChange({ allowFrom: val })}
          placeholder="@user:matrix.org"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default MatrixForm;
