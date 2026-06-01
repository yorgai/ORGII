import React from "react";
import { useTranslation } from "react-i18next";

import {
  MODEL_WIKI_MODEL_COUNT,
  MODEL_WIKI_SOURCE,
} from "../KeyVault/ModelWiki/modelWikiData";

const disclaimerClass =
  "flex flex-col gap-1.5 px-1 pt-3 text-[11px] leading-relaxed text-text-3";

export const TrademarkDisclaimer: React.FC = () => {
  const { t } = useTranslation("terms");

  return (
    <div className={disclaimerClass}>
      <p>{t("notices.trademark")}</p>
      <p>{t("notices.responsibleUse")}</p>
    </div>
  );
};

export const KeyPrivacyDisclaimer: React.FC = () => {
  const { t } = useTranslation("terms");

  return (
    <div className={disclaimerClass}>
      <p>{t("notices.trademark")}</p>
      <p>{t("notices.keyPrivacy")}</p>
      <p>{t("notices.responsibleUse")}</p>
    </div>
  );
};

export const CliDisclaimer: React.FC = () => {
  const { t } = useTranslation("terms");

  return (
    <div className={disclaimerClass}>
      <p>{t("notices.trademark")}</p>
      <p>{t("notices.cli")}</p>
      <p>{t("notices.responsibleUse")}</p>
    </div>
  );
};

export const ThirdPartyDisclaimer: React.FC = () => {
  const { t } = useTranslation("terms");

  return (
    <div className={disclaimerClass}>
      <p>{t("notices.trademark")}</p>
    </div>
  );
};

export const ModelWikiDisclaimer: React.FC = () => {
  const { t } = useTranslation("terms");

  return (
    <div className={disclaimerClass}>
      <p>
        {t("notices.modelWikiSource", { count: MODEL_WIKI_MODEL_COUNT })}{" "}
        <a
          href={MODEL_WIKI_SOURCE}
          target="_blank"
          rel="noreferrer"
          className="text-primary-6 hover:text-primary-5"
        >
          {t("notices.modelWikiSourceLink")}
        </a>
      </p>
      <p>{t("notices.iconsAndBadges")}</p>
      <p>{t("notices.trademark")}</p>
      <p>{t("notices.responsibleUse")}</p>
    </div>
  );
};
