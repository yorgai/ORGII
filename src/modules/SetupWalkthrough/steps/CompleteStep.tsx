/**
 * Complete Step
 *
 * Setup complete, ready to start using the app.
 */
import { Sparkles } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import { AnimatedTitle } from "../components";

export const CompleteStep: React.FC = () => {
  const { t } = useTranslation("onboarding");

  return (
    <>
      <AnimatedTitle
        title={t("complete.title")}
        subtitle={t("complete.description")}
      />
      <div className="flex animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col items-center gap-4 text-center">
        <Button variant="primary" size="large" icon={<Sparkles size={18} />}>
          {t("complete.startSession")}
        </Button>
      </div>
    </>
  );
};
