import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Circle, HatGlasses, Moon } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import NumberInput from "@src/components/NumberInput";
import Select, { type SelectOption } from "@src/components/Select";
import TagsInput from "@src/components/TagsInput";
import Textarea from "@src/components/Textarea";
import {
  FAMILIAR_LANGUAGE_TECH_STACKS,
  type FamiliarLanguageTechStack,
  TECH_SAVVY_LEVELS,
  type UserTechSavvySelection,
} from "@src/config/profile/userProfile";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { resolveCustomRoleIcon } from "@src/scaffold/NavigationSidebar/blocks/customRoleIcons";
import { updateSettingAtom, useAllSettings } from "@src/store/settings";
import { userPresenceAtom } from "@src/store/user/userPresenceAtom";
import { userCustomRolesAtom } from "@src/store/user/userRolesAtom";
import {
  AWAY_DURATIONS,
  type BuiltInPresenceMode,
  USER_PRESENCE_MODE,
  type UserPresenceMode,
  buildCustomRoleMode,
  computeBackAtMs,
} from "@src/types/userPresence";

export const MY_ROLES_TAB = {
  PRESENCE: "presence",
  PROFILE: "profile",
} as const;

export type MyRolesTab = (typeof MY_ROLES_TAB)[keyof typeof MY_ROLES_TAB];

type PresenceGuidanceKey =
  | "general.presenceGuidanceOnline"
  | "general.presenceGuidanceInvisible"
  | "general.presenceGuidanceAway";

interface MyRolesSectionProps {
  activeTab?: MyRolesTab;
}

const CUSTOM_ROLE_COLOR_CLASS = "text-primary-6";

const BUILT_IN_STATUS_OPTIONS = [
  {
    mode: USER_PRESENCE_MODE.ONLINE,
    labelKey: "sidebar.presence.online",
    icon: Circle,
    colorClass: "text-success-6",
  },
  {
    mode: USER_PRESENCE_MODE.INVISIBLE,
    labelKey: "sidebar.presence.invisible",
    icon: HatGlasses,
    colorClass: "text-text-3",
  },
  {
    mode: USER_PRESENCE_MODE.AWAY,
    labelKey: "sidebar.presence.away",
    icon: Moon,
    colorClass: "text-warning-6",
  },
] as const;

const MyRolesSection: React.FC<MyRolesSectionProps> = ({
  activeTab = MY_ROLES_TAB.PRESENCE,
}) => {
  const { t } = useTranslation(["settings", "navigation"]);
  const settings = useAllSettings();
  const updateSetting = useSetAtom(updateSettingAtom);
  const [presence, setPresence] = useAtom(userPresenceAtom);
  const customRoles = useAtomValue(userCustomRolesAtom);

  const questionAutoSkipTimeoutByPresence = settings[
    "agent.sde.questionAutoSkipTimeoutByPresence"
  ] as Record<BuiltInPresenceMode, number>;
  const planAutoApproveTimeoutByPresence = settings[
    "agent.sde.planAutoApproveTimeoutByPresence"
  ] as Record<BuiltInPresenceMode, number>;
  const goalMaxTurnsByPresence = settings[
    "agent.sde.goalMaxTurnsByPresence"
  ] as Record<BuiltInPresenceMode, number>;
  const presenceGuidanceOnline =
    (settings["general.presenceGuidanceOnline"] as string | undefined) ?? "";
  const presenceGuidanceInvisible =
    (settings["general.presenceGuidanceInvisible"] as string | undefined) ?? "";
  const presenceGuidanceAway =
    (settings["general.presenceGuidanceAway"] as string | undefined) ?? "";

  const statusOptions = useMemo<SelectOption[]>(() => {
    const builtInOptions = BUILT_IN_STATUS_OPTIONS.map((option) => {
      const StatusIcon = option.icon;
      return {
        value: option.mode,
        label: (
          <span className="inline-flex items-center gap-2">
            <StatusIcon size={14} className={option.colorClass} />
            <span>{t(option.labelKey, { ns: "navigation" })}</span>
          </span>
        ),
        triggerLabel: t(option.labelKey, { ns: "navigation" }),
      };
    });

    const customOptions = customRoles.map((role) => {
      const RoleIcon = resolveCustomRoleIcon(role.iconId);
      const mode = buildCustomRoleMode(role.id);
      return {
        value: mode,
        label: (
          <span className="inline-flex items-center gap-2">
            <RoleIcon size={14} className={CUSTOM_ROLE_COLOR_CLASS} />
            <span>{role.label}</span>
          </span>
        ),
        triggerLabel: role.label,
      };
    });

    return [...builtInOptions, ...customOptions];
  }, [customRoles, t]);

  const handleStatusChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      const nextMode = String(value) as UserPresenceMode;
      if (nextMode === USER_PRESENCE_MODE.AWAY) {
        const fallbackDuration = AWAY_DURATIONS[1];
        setPresence({
          mode: nextMode,
          backAtMs: computeBackAtMs(fallbackDuration.id),
          awayDurationLabel: fallbackDuration.id,
        });
        return;
      }
      setPresence({
        mode: nextMode,
        backAtMs: undefined,
        awayDurationLabel: undefined,
      });
    },
    [setPresence]
  );

  const handlePresenceGuidanceChange = useCallback(
    (key: PresenceGuidanceKey) => (value: string) => {
      updateSetting({ key, value });
    },
    [updateSetting]
  );

  const handleQuestionAutoSkipTimeoutChange = useCallback(
    (mode: BuiltInPresenceMode) => (value: number | undefined) => {
      if (value === undefined) return;
      updateSetting({
        key: "agent.sde.questionAutoSkipTimeoutByPresence",
        value: {
          ...questionAutoSkipTimeoutByPresence,
          [mode]: value,
        },
      });
    },
    [questionAutoSkipTimeoutByPresence, updateSetting]
  );

  const handlePlanAutoApproveTimeoutChange = useCallback(
    (mode: BuiltInPresenceMode) => (value: number | undefined) => {
      if (value === undefined) return;
      updateSetting({
        key: "agent.sde.planAutoApproveTimeoutByPresence",
        value: {
          ...planAutoApproveTimeoutByPresence,
          [mode]: value,
        },
      });
    },
    [planAutoApproveTimeoutByPresence, updateSetting]
  );

  const handleGoalMaxTurnsChange = useCallback(
    (mode: BuiltInPresenceMode) => (value: number | undefined) => {
      if (value === undefined) return;
      updateSetting({
        key: "agent.sde.goalMaxTurnsByPresence",
        value: {
          ...goalMaxTurnsByPresence,
          [mode]: value,
        },
      });
    },
    [goalMaxTurnsByPresence, updateSetting]
  );

  const renderPolicyRows = useCallback(
    (mode: BuiltInPresenceMode, statusLabel: string) => (
      <>
        <SectionRow
          label={t("sdeAgent.questionAutoSkipTimeoutByStatus", {
            status: statusLabel,
          })}
          description={t("sdeAgent.questionAutoSkipTimeoutByStatusDesc")}
        >
          <NumberInput
            value={questionAutoSkipTimeoutByPresence[mode]}
            onChange={handleQuestionAutoSkipTimeoutChange(mode)}
            min={0}
            max={300}
            step={5}
            suffix={t("common:common.s")}
            controlsPosition="sides"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("sdeAgent.planAutoApproveTimeoutByStatus", {
            status: statusLabel,
            defaultValue: `${statusLabel} plan auto-approve`,
          })}
          description={t("sdeAgent.planAutoApproveTimeoutByStatusDesc", {
            defaultValue:
              "Auto-approve a pending plan after this many seconds in this status (0 = disabled).",
          })}
        >
          <NumberInput
            value={planAutoApproveTimeoutByPresence[mode]}
            onChange={handlePlanAutoApproveTimeoutChange(mode)}
            min={0}
            max={3600}
            step={10}
            suffix={t("common:common.s")}
            controlsPosition="sides"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("sdeAgent.goalMaxTurnsByStatus", {
            status: statusLabel,
            defaultValue: `${statusLabel} goal continuation budget`,
          })}
          description={t("sdeAgent.goalMaxTurnsByStatusDesc", {
            defaultValue:
              "Keep working toward your last request for up to this many extra turns after the agent would normally stop (0 = disabled).",
          })}
        >
          <NumberInput
            value={goalMaxTurnsByPresence[mode]}
            onChange={handleGoalMaxTurnsChange(mode)}
            min={0}
            max={100}
            step={1}
            controlsPosition="sides"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </>
    ),
    [
      t,
      questionAutoSkipTimeoutByPresence,
      planAutoApproveTimeoutByPresence,
      goalMaxTurnsByPresence,
      handleQuestionAutoSkipTimeoutChange,
      handlePlanAutoApproveTimeoutChange,
      handleGoalMaxTurnsChange,
    ]
  );

  const techSavvy = settings[
    "general.profileTechSavvy"
  ] as UserTechSavvySelection;
  const jobRoles = settings["general.profileJobRoles"] as string[];
  const familiarTechStacks = settings[
    "general.profileFamiliarTechStacks"
  ] as FamiliarLanguageTechStack[];
  const profileDescription = settings["general.profileDescription"] as string;

  const techSavvyOptions = useMemo<SelectOption[]>(
    () =>
      TECH_SAVVY_LEVELS.map((level) => ({
        value: level,
        label: t(`myRoles.profile.techSavvyLevels.${level}`),
      })),
    [t]
  );

  const familiarTechStackOptions = useMemo<SelectOption[]>(
    () =>
      FAMILIAR_LANGUAGE_TECH_STACKS.map((stack) => ({
        value: stack,
        label: stack,
      })),
    []
  );

  const handleTechSavvyChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      updateSetting({
        key: "general.profileTechSavvy",
        value: String(value) as UserTechSavvySelection,
      });
    },
    [updateSetting]
  );

  const handleJobRolesChange = useCallback(
    (next: string[]) => {
      updateSetting({ key: "general.profileJobRoles", value: next });
    },
    [updateSetting]
  );

  const handleFamiliarTechStacksChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (!Array.isArray(value)) return;
      updateSetting({
        key: "general.profileFamiliarTechStacks",
        value: value.map(String) as FamiliarLanguageTechStack[],
      });
    },
    [updateSetting]
  );

  const handleProfileDescriptionChange = useCallback(
    (value: string) => {
      updateSetting({ key: "general.profileDescription", value });
    },
    [updateSetting]
  );

  const removeJobRoleAriaLabel = useCallback(
    (role: string) => t("myRoles.profile.removeJobRole", { role }),
    [t]
  );

  if (activeTab === MY_ROLES_TAB.PROFILE) {
    return (
      <div className="flex flex-col gap-3">
        <SectionContainer title={t("myRoles.profile.title")}>
          <SectionRow
            label={t("myRoles.profile.techSavvy")}
            description={t("myRoles.profile.techSavvyDescription")}
          >
            <Select
              value={techSavvy}
              onChange={handleTechSavvyChange}
              options={techSavvyOptions}
              placeholder={t("myRoles.profile.techSavvyPlaceholder")}
              allowClear
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
          <SectionRow
            label={t("myRoles.profile.jobRoles")}
            description={t("myRoles.profile.jobRolesDescription")}
            layout="vertical"
          >
            <TagsInput
              value={jobRoles}
              onChange={handleJobRolesChange}
              placeholder={t("myRoles.profile.jobRolesPlaceholder")}
              removeAriaLabel={removeJobRoleAriaLabel}
            />
          </SectionRow>
          <SectionRow
            label={t("myRoles.profile.familiarTechStacks")}
            description={t("myRoles.profile.familiarTechStacksDescription")}
            layout="vertical"
          >
            <Select
              value={familiarTechStacks}
              onChange={handleFamiliarTechStacksChange}
              options={familiarTechStackOptions}
              placeholder={t("myRoles.profile.familiarTechStacksPlaceholder")}
              mode="multiple"
              showSearch
              allowClear
              maxTagCount={4}
              dropdownWidthMode="match"
            />
          </SectionRow>
          <SectionRow
            label={t("myRoles.profile.description")}
            description={t("myRoles.profile.descriptionHelp")}
            layout="vertical"
          >
            <Textarea
              value={profileDescription}
              onChange={handleProfileDescriptionChange}
              rows={4}
              placeholder={t("myRoles.profile.descriptionPlaceholder")}
            />
          </SectionRow>
        </SectionContainer>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionContainer>
        <SectionRow label={t("myRoles.currentStatus")}>
          <Select
            value={presence.mode}
            onChange={handleStatusChange}
            options={statusOptions}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("navigation:sidebar.presence.online")}>
        <SectionRow
          label={t("myRoles.presence.instructionForAgent")}
          layout="vertical"
        >
          <Textarea
            value={presenceGuidanceOnline}
            onChange={handlePresenceGuidanceChange(
              "general.presenceGuidanceOnline"
            )}
            rows={3}
            placeholder={t("general.presenceGuidancePlaceholder")}
          />
        </SectionRow>
        {renderPolicyRows(
          USER_PRESENCE_MODE.ONLINE,
          t("navigation:sidebar.presence.online")
        )}
      </SectionContainer>

      <SectionContainer title={t("navigation:sidebar.presence.invisible")}>
        <SectionRow
          label={t("myRoles.presence.instructionForAgent")}
          layout="vertical"
        >
          <Textarea
            value={presenceGuidanceInvisible}
            onChange={handlePresenceGuidanceChange(
              "general.presenceGuidanceInvisible"
            )}
            rows={3}
            placeholder={t("general.presenceGuidancePlaceholder")}
          />
        </SectionRow>
        {renderPolicyRows(
          USER_PRESENCE_MODE.INVISIBLE,
          t("navigation:sidebar.presence.invisible")
        )}
      </SectionContainer>

      <SectionContainer title={t("navigation:sidebar.presence.away")}>
        <SectionRow
          label={t("myRoles.presence.instructionForAgent")}
          layout="vertical"
        >
          <Textarea
            value={presenceGuidanceAway}
            onChange={handlePresenceGuidanceChange(
              "general.presenceGuidanceAway"
            )}
            rows={3}
            placeholder={t("general.presenceGuidancePlaceholder")}
          />
        </SectionRow>
        {renderPolicyRows(
          USER_PRESENCE_MODE.AWAY,
          t("navigation:sidebar.presence.away")
        )}
      </SectionContainer>
    </div>
  );
};

export default MyRolesSection;
