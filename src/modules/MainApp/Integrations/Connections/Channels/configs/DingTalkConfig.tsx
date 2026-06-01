/**
 * DingTalk Channel Configuration
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";

import {
  getNestedString,
  getNestedStringArray,
} from "../../../../AgentOrgs/config/osAgent/utils";
import type { ChannelConfigProps } from "../types";
import { parseCommaSeparated } from "../utils";

const DingTalkConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const clientId = getNestedString(config, `${pathPrefix}.clientId`, "");
  const clientSecret = getNestedString(
    config,
    `${pathPrefix}.clientSecret`,
    ""
  );
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.dingtalkClientId")}
        description={t("channels.dingtalkClientIdDesc")}
      >
        <Input
          value={clientId}
          onChange={(val: string) => update(`${pathPrefix}.clientId`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="dingxxxxxxxx"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.dingtalkClientSecret")}
        description={t("channels.dingtalkClientSecretDesc")}
      >
        <Input
          value={clientSecret}
          onChange={(val: string) => update(`${pathPrefix}.clientSecret`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="******"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.allowFrom")}
        description={t("channels.allowFromDesc")}
      >
        <Input
          value={allowFrom.join(", ")}
          onChange={(val: string) =>
            update(`${pathPrefix}.allowFrom`, parseCommaSeparated(val))
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="user1, user2"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default DingTalkConfig;
