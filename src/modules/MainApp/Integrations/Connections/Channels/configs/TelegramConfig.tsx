/**
 * Telegram Channel Configuration
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

const TelegramConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const token = getNestedString(config, `${pathPrefix}.token`, "");
  const proxy = getNestedString(config, `${pathPrefix}.proxy`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.telegramToken")}
        description={t("channels.telegramTokenDesc")}
      >
        <Input
          value={token}
          onChange={(val: string) => update(`${pathPrefix}.token`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="123456:ABC-..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.proxy")}
        description={t("channels.proxyDesc")}
      >
        <Input
          value={proxy}
          onChange={(val: string) => update(`${pathPrefix}.proxy`, val || null)}
          style={SECTION_CONTROL_STYLE}
          placeholder="socks5://127.0.0.1:1080"
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
          placeholder="123456789, 987654321"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default TelegramConfig;
