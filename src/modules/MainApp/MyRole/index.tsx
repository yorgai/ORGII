/**
 * My Role — page module.
 *
 * Rendered by the unified Settings surface for the route:
 *   /orgii/app/settings/my-role
 *
 * This page is where the user manages presence-mode guidance and adds
 * custom roles on top of the three built-ins (Online / Invisible /
 * Away). The active mode + its guidance string travel with every agent
 * turn via the IDE context payload (see `userPresenceWireAtom`).
 *
 * Sidebar navigation lives in `SettingsSidebar` under the My Role
 * drill-down. This module is a full-width detail panel and has no
 * sub-tabs — the single visible heading is "My Roles".
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Circle, HatGlasses, Moon, Plus, Trash2 } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Select from "@src/components/Select";
import Textarea from "@src/components/Textarea";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionHeading,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  CUSTOM_ROLE_ICON_IDS,
  resolveCustomRoleIcon,
} from "@src/scaffold/NavigationSidebar/blocks/customRoleIcons";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";
import { userPresenceModeAtom } from "@src/store/user/userPresenceAtom";
import {
  generateRoleId,
  userCustomRolesAtom,
} from "@src/store/user/userRolesAtom";
import {
  type CustomRoleDefinition,
  type CustomRoleIconId,
  USER_PRESENCE_MODE,
  buildCustomRoleMode,
} from "@src/types/userPresence";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

interface BuiltInRoleConfig {
  mode:
    | typeof USER_PRESENCE_MODE.ONLINE
    | typeof USER_PRESENCE_MODE.INVISIBLE
    | typeof USER_PRESENCE_MODE.AWAY;
  labelKey: string;
  settingsKey:
    | "general.presenceGuidanceOnline"
    | "general.presenceGuidanceInvisible"
    | "general.presenceGuidanceAway";
  icon: typeof Circle;
  colorClass: string;
}

const BUILT_IN_ROLES: BuiltInRoleConfig[] = [
  {
    mode: USER_PRESENCE_MODE.ONLINE,
    labelKey: "sidebar.presence.online",
    settingsKey: "general.presenceGuidanceOnline",
    icon: Circle,
    colorClass: "text-success-6",
  },
  {
    mode: USER_PRESENCE_MODE.INVISIBLE,
    labelKey: "sidebar.presence.invisible",
    settingsKey: "general.presenceGuidanceInvisible",
    icon: HatGlasses,
    colorClass: "text-text-3",
  },
  {
    mode: USER_PRESENCE_MODE.AWAY,
    labelKey: "sidebar.presence.away",
    settingsKey: "general.presenceGuidanceAway",
    icon: Moon,
    colorClass: "text-warning-6",
  },
];

const MyRolePage: React.FC = () => {
  const { t } = useTranslation("navigation");

  const [settings] = useAtom(settingsAtom);
  const updateSetting = useSetAtom(updateSettingAtom);
  const [customRoles, setCustomRoles] = useAtom(userCustomRolesAtom);
  const activeMode = useAtomValue(userPresenceModeAtom);

  const guidancePlaceholder = t("myRole.guidancePlaceholder", {
    defaultValue:
      "How should the agent adapt its behavior when this role is active?",
  });

  const handleBuiltInChange = useCallback(
    (key: BuiltInRoleConfig["settingsKey"]) => (value: string) => {
      updateSetting({ key, value });
    },
    [updateSetting]
  );

  const handleAddRole = useCallback(() => {
    const baseLabel = t("myRole.newRoleDefaultLabel", {
      defaultValue: "Custom role",
    });
    const taken = new Set(customRoles.map((role) => role.id));
    const id = generateRoleId(baseLabel, taken);
    const next: CustomRoleDefinition = {
      id,
      label: baseLabel,
      iconId: "sparkles",
      guidance: "",
      createdAtMs: Date.now(),
    };
    setCustomRoles((prev) => [...prev, next]);
  }, [customRoles, setCustomRoles, t]);

  const handleRoleChange = useCallback(
    (id: string, patch: Partial<CustomRoleDefinition>) => {
      setCustomRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...patch } : role))
      );
    },
    [setCustomRoles]
  );

  const handleDeleteRole = useCallback(
    async (role: CustomRoleDefinition) => {
      const confirmed = await confirmDestructiveAction({
        title: t("myRole.deleteRoleTitle", {
          defaultValue: "Delete role?",
        }),
        message: t("myRole.deleteRoleMessage", {
          name: role.label,
          defaultValue: `"${role.label}" will be removed. This cannot be undone.`,
        }),
        okLabel: t("myRole.deleteRoleOk", { defaultValue: "Delete" }),
        cancelLabel: t("myRole.deleteRoleCancel", {
          defaultValue: "Cancel",
        }),
      });
      if (!confirmed) return;
      setCustomRoles((prev) =>
        prev.filter((existing) => existing.id !== role.id)
      );
    },
    [setCustomRoles, t]
  );

  const iconOptions = useMemo(
    () =>
      CUSTOM_ROLE_ICON_IDS.map((id) => {
        const IconComp = resolveCustomRoleIcon(id);
        return {
          value: id,
          label: (
            <span className="inline-flex items-center gap-2">
              <IconComp size={14} />
              <span className="capitalize">{id}</span>
            </span>
          ),
        };
      }),
    []
  );

  return (
    <div className="settings-page absolute inset-0 overflow-hidden rounded-page">
      <div className="custom-scrollbar h-full overflow-y-auto px-6 pb-8 pt-2">
        <SectionHeading
          title={t("myRole.pageTitle", { defaultValue: "My Roles" })}
        >
          <p className="text-[13px] leading-relaxed text-text-2">
            {t("myRole.pageDescription", {
              defaultValue:
                "Define the role you're playing right now. The agent reads the active role's guidance and adapts its behavior accordingly — for example, asking fewer clarifying questions when you're heads-down, or batching summaries when you're away.",
            })}
          </p>

          <SectionContainer
            title={t("myRole.builtInTitle", { defaultValue: "Built-in roles" })}
          >
            {BUILT_IN_ROLES.map((role) => {
              const RoleIcon = role.icon;
              const value =
                (settings[role.settingsKey] as string | undefined) ?? "";
              const isActive = role.mode === activeMode;
              return (
                <SectionRow
                  key={role.mode}
                  layout="vertical"
                  label={
                    <span className="inline-flex items-center gap-2">
                      <RoleIcon size={14} className={role.colorClass} />
                      <span>{t(role.labelKey)}</span>
                      {isActive && (
                        <span className="rounded-full bg-primary-1 px-2 py-[1px] text-[10px] font-medium text-primary-6">
                          {t("myRole.activeBadge", { defaultValue: "Active" })}
                        </span>
                      )}
                    </span>
                  }
                >
                  <Textarea
                    value={value}
                    onChange={handleBuiltInChange(role.settingsKey)}
                    rows={3}
                    placeholder={guidancePlaceholder}
                  />
                </SectionRow>
              );
            })}
          </SectionContainer>

          <SectionContainer
            title={t("myRole.customTitle", { defaultValue: "Custom roles" })}
          >
            {customRoles.length === 0 ? (
              <div className="px-2 py-4 text-[13px] text-text-3">
                {t("myRole.customEmpty", {
                  defaultValue:
                    'No custom roles yet. Add one to capture a stance the built-in three don\'t cover — e.g. "Deep work", "Pairing", or "On call".',
                })}
              </div>
            ) : (
              customRoles.map((role) => {
                const RoleIcon = resolveCustomRoleIcon(role.iconId);
                const isActive = buildCustomRoleMode(role.id) === activeMode;
                return (
                  <div
                    key={role.id}
                    className="flex flex-col gap-3 border-t border-border-2 pt-3 first:border-t-0 first:pt-0"
                  >
                    <SectionRow
                      layout="vertical"
                      label={
                        <span className="inline-flex items-center gap-2">
                          <RoleIcon size={14} className="text-primary-6" />
                          <span>
                            {t("myRole.roleNameLabel", {
                              defaultValue: "Name",
                            })}
                          </span>
                          {isActive && (
                            <span className="rounded-full bg-primary-1 px-2 py-[1px] text-[10px] font-medium text-primary-6">
                              {t("myRole.activeBadge", {
                                defaultValue: "Active",
                              })}
                            </span>
                          )}
                        </span>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={role.label}
                          onChange={(value) =>
                            handleRoleChange(role.id, { label: value })
                          }
                          style={SECTION_CONTROL_STYLE}
                          placeholder={t("myRole.roleNamePlaceholder", {
                            defaultValue: "Role name",
                          })}
                        />
                        <Select
                          value={role.iconId}
                          onChange={(value) =>
                            handleRoleChange(role.id, {
                              iconId: value as CustomRoleIconId,
                            })
                          }
                          options={iconOptions}
                          style={{ width: 180 }}
                        />
                        <Button
                          variant="tertiary"
                          size="small"
                          iconOnly
                          icon={<Trash2 size={14} />}
                          onClick={() => void handleDeleteRole(role)}
                          aria-label={t("myRole.deleteRoleOk", {
                            defaultValue: "Delete",
                          })}
                          title={t("myRole.deleteRoleOk", {
                            defaultValue: "Delete",
                          })}
                        />
                      </div>
                    </SectionRow>
                    <SectionRow
                      layout="vertical"
                      label={t("myRole.guidanceLabel", {
                        defaultValue: "Agent guidance",
                      })}
                    >
                      <Textarea
                        value={role.guidance}
                        onChange={(value) =>
                          handleRoleChange(role.id, { guidance: value })
                        }
                        rows={3}
                        placeholder={guidancePlaceholder}
                      />
                    </SectionRow>
                  </div>
                );
              })
            )}
            <div className="flex pt-2">
              <Button
                variant="secondary"
                size="default"
                icon={<Plus size={14} />}
                onClick={handleAddRole}
              >
                {t("myRole.addRole", { defaultValue: "Add custom role" })}
              </Button>
            </div>
          </SectionContainer>
        </SectionHeading>
      </div>
    </div>
  );
};

export default MyRolePage;
