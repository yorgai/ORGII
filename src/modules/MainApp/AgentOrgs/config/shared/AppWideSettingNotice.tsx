/**
 * AppWideSettingNotice
 *
 * Inline notice shown above per-agent UI rows that actually edit
 * `IntegrationsConfig` (i.e. app-wide values) so the user understands
 * the change applies to every agent, not just this one.
 *
 * P1-1 follow-up: until the dedicated App → Integrations subpage lands,
 * this notice is the alignment surface that explains the cross-agent
 * blast radius in-place.
 */
import { Info } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

interface AppWideSettingNoticeProps {
  /**
   * Optional extra translation key (under `settings`) appended to the
   * generic line — useful when a specific destination owns this knob
   * (e.g. "agentMemory.appWideHintEmbedding").
   */
  hintKey?: string;
}

const AppWideSettingNotice: React.FC<AppWideSettingNoticeProps> = ({
  hintKey,
}) => {
  const { t } = useTranslation("settings");

  return (
    <div className="flex items-start gap-2 rounded-md bg-fill-2 px-3 py-2 text-xs text-text-3">
      <Info size={14} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-medium text-text-2">
          {t("appWideSetting.title")}
        </span>
        <span className="ml-1">{t("appWideSetting.desc")}</span>
        {hintKey ? <span className="ml-1">{t(hintKey)}</span> : null}
      </span>
    </div>
  );
};

export default AppWideSettingNotice;
