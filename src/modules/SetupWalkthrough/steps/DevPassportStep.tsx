/**
 * Dev Passport Step
 *
 * Allows user to create their developer passport with code name and avatar.
 */
import { Dices, Upload } from "lucide-react";
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  type PageContent,
  PassportDossier,
  type UserProfile,
} from "@src/components/DevPassport";

import { AnimatedTitle } from "../components";
import { AGENT_CODE_NAMES } from "../constants";

export const DevPassportStep: React.FC = () => {
  const { t } = useTranslation("onboarding");
  const [codeName, setCodeName] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isGenerated, setIsGenerated] = useState(false);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRandomName = () => {
    const randomIndex = Math.floor(Math.random() * AGENT_CODE_NAMES.length);
    setCodeName(AGENT_CODE_NAMES[randomIndex]);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfileImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleGenerate = () => {
    setIsGenerated(true);
  };

  const handleFlip = (index: number) => {
    setCurrentSheetIndex(index);
  };

  // Generate stable ID number once on mount (lazy initializer runs outside render)
  const [idNumber] = useState(
    () => `VE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  );

  // Generate user profile from form data
  const userProfile: UserProfile = {
    name: codeName.toUpperCase() || "AGENT",
    role: t("devPassport.role"),
    memberSince: new Date()
      .toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .toUpperCase(),
    idNumber,
    avatarUrl: profileImage || "",
  };

  const passportPages: PageContent[] = [
    { id: "p0", type: "profile" },
    { id: "p1", type: "stamps", stamps: [] },
    { id: "p2", type: "stamps", stamps: [] },
    { id: "p3", type: "stamps", stamps: [] },
    { id: "p4", type: "stamps", stamps: [] },
    { id: "p5", type: "stamps", stamps: [] },
  ];

  // Show passport when generated
  if (isGenerated) {
    return (
      <>
        <AnimatedTitle
          title={t("devPassport.passportTitle")}
          subtitle={t("devPassport.passportWelcome", { name: codeName })}
        />
        <div className="relative flex h-full w-[600px] animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col items-center overflow-hidden pt-14">
          {/* Passport Display Section - uses Dossier animation */}
          <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-visible p-6 pb-10">
            <div className="scale-110">
              <PassportDossier
                user={userProfile}
                pages={passportPages}
                currentSheetIndex={currentSheetIndex}
                onFlip={handleFlip}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AnimatedTitle
        title={t("devPassport.title")}
        subtitle={t("devPassport.description")}
      />

      <div className="flex w-[600px] animate-[fadeInUp_0.6s_ease-out_2s_backwards] flex-col items-center gap-5">
        {/* Code Name Section */}
        <div className="flex w-full flex-col gap-3 rounded-xl bg-fill-2 p-6">
          <label className="text-left text-xs font-semibold uppercase tracking-wider text-text-1">
            {t("devPassport.codeName")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="h-12 flex-1 rounded-lg border border-border-2 bg-bg-1 px-4 text-base text-text-1 transition-all placeholder:text-text-3 focus:border-primary-6 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-6)_10%,transparent)] focus:outline-none"
              placeholder={t("devPassport.codeNamePlaceholder")}
              value={codeName}
              onChange={(event) => setCodeName(event.target.value)}
            />
            <button
              type="button"
              className="flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border-2 bg-bg-1 text-text-2 transition-all hover:border-primary-6 hover:bg-fill-3 hover:text-primary-6"
              onClick={handleRandomName}
              title={t("devPassport.randomNameTooltip")}
            >
              <Dices size={20} />
            </button>
          </div>
        </div>

        {/* Profile Image Section */}
        <div className="flex w-full flex-col gap-3 rounded-xl bg-fill-2 p-6">
          <label className="text-left text-xs font-semibold uppercase tracking-wider text-text-1">
            {t("devPassport.avatar")}
          </label>
          <div className="flex items-center gap-4">
            <div
              className="flex h-24 w-24 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-border-2 bg-bg-1 text-text-3 transition-all hover:border-primary-6 hover:text-primary-6"
              onClick={handleUploadClick}
            >
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Upload size={28} />
              )}
            </div>
            <div className="flex flex-col gap-1 text-left">
              <span className="text-base font-medium text-text-1">
                {t("devPassport.selectImage")}
              </span>
              <span className="text-sm text-text-3">
                {t("devPassport.avatarHint")}
              </span>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: "none" }}
          />
        </div>

        {/* Generate Button */}
        <Button
          variant="primary"
          size="large"
          disabled={!codeName.trim() || !profileImage}
          className="mt-3 self-center"
          onClick={handleGenerate}
        >
          {t("devPassport.generateButton")}
        </Button>
      </div>
    </>
  );
};
