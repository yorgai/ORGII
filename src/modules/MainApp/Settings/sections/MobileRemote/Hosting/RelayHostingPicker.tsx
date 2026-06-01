/**
 * RelayHostingPicker
 *
 * Standard settings rows for the only supported Mobile Remote hosting path:
 * Cloudflare Tunnel. The phone reaches the desktop through the user's
 * Cloudflare-managed public URL; local-only and self-hosted VPS paths are not
 * offered in the settings surface.
 */
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_VALUE_SMALL_SECONDARY_CLASSES,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { ExternalLink } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import CopyableCommand from "./CopyableCommand";

const CLOUDFLARED_INSTALL_URL =
  "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

const RelayHostingPicker: React.FC = () => {
  const { t } = useTranslation("settings");

  return (
    <>
      <SectionRow
        label={t("mobileRemote.hosting.title")}
        description={t("mobileRemote.hosting.subtitle")}
        align="start"
      >
        <div className="flex flex-col items-start gap-1 text-left @[480px]:items-end @[480px]:text-right">
          <span className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
            {t("mobileRemote.hosting.cost.free")}
          </span>
          <span className={SECTION_VALUE_SMALL_SECONDARY_CLASSES}>
            {t("mobileRemote.hosting.setupTime.fifteenMin")} ·{" "}
            {t("mobileRemote.hosting.reachableFrom.public")}
          </span>
        </div>
      </SectionRow>

      <SectionRow
        label={t("mobileRemote.hosting.tunnel.title")}
        description={t("mobileRemote.hosting.tunnel.summary")}
        indent
      >
        <div className={SECTION_ACTION_GAP_CLASSES}>
          <Button
            size="small"
            appearance="ghost"
            icon={<ExternalLink size={14} />}
            onClick={() => window.open(CLOUDFLARED_INSTALL_URL, "_blank")}
          >
            cloudflared
          </Button>
        </div>
      </SectionRow>

      <SectionRow
        label={t("mobileRemote.hosting.tunnel.step1")}
        indent
        compact
        align="start"
      >
        <CopyableCommand command="brew install cloudflared" />
      </SectionRow>

      <SectionRow
        label={t("mobileRemote.hosting.tunnel.step2")}
        indent
        compact
        align="start"
      >
        <CopyableCommand command="cargo run -p orgii_mobile_relay -- serve" />
      </SectionRow>

      <SectionRow
        label={t("mobileRemote.hosting.tunnel.step3")}
        indent
        compact
        align="start"
      >
        <CopyableCommand command="cloudflared tunnel --url http://localhost:7878" />
      </SectionRow>

      <SectionRow
        label={t("mobileRemote.hosting.tunnel.step4")}
        description={t("mobileRemote.hosting.tunnel.note")}
        indent
      />
    </>
  );
};

export default RelayHostingPicker;
