/**
 * SidebarBottomBar
 *
 * Footer strip rendered inside any sidebar variant via the `bottomContent`
 * slot. Left side hosts the user presence pill — a QQ-style availability
 * control (Online / Invisible / Away) the user toggles from here. The
 * selected mode is shipped to every agent turn via the IDE context payload
 * and surfaced in the system prompt's `user_presence` section so the agent
 * can adapt to whether the human is at the keyboard.
 *
 * Right side hosts compact action buttons — by default a Settings gear
 * that opens quick settings actions and links to the app settings route.
 * `AppShell` detects that route and renders Settings inside the
 * chat-panel slot with the WorkStation kept visible underneath, so the
 * URL stays deeplinkable while the layout matches the slot affordance.
 * Extra actions can be supplied by the caller (e.g. session group-by).
 */
import { useAtom, useAtomValue } from "jotai";
import { Circle, HatGlasses, type LucideIcon, Moon } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Dropdown, { type DropdownPosition } from "@src/components/Dropdown";
import DropdownSelectedCheck from "@src/components/Dropdown/DropdownSelectedCheck";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import PillGroup, { type PillGroupSegment } from "@src/components/PillGroup";
import {
  userPresenceAtom,
  userPresenceModeAtom,
} from "@src/store/user/userPresenceAtom";
import { userCustomRolesAtom } from "@src/store/user/userRolesAtom";
import {
  AWAY_DURATIONS,
  type BuiltInPresenceMode,
  USER_PRESENCE_MODE,
  type UserPresenceMode,
  buildCustomRoleMode,
  computeBackAtMs,
  isBuiltInPresenceMode,
  parseCustomRoleId,
} from "@src/types/userPresence";

import SidebarSettingsMenuButton from "./SidebarSettingsMenuButton";
import SidebarUpdateButton from "./SidebarUpdateButton";
import { resolveCustomRoleIcon } from "./customRoleIcons";

interface SidebarBottomBarProps {
  /** Extra action buttons rendered to the left of the Settings gear. */
  rightActions?: React.ReactNode;
  /** Hide the built-in Settings gear (e.g. when already on Settings). */
  hideSettings?: boolean;
}

const PRESENCE_ICON: Record<BuiltInPresenceMode, LucideIcon> = {
  [USER_PRESENCE_MODE.ONLINE]: Circle,
  [USER_PRESENCE_MODE.INVISIBLE]: HatGlasses,
  [USER_PRESENCE_MODE.AWAY]: Moon,
};

const PRESENCE_COLOR: Record<BuiltInPresenceMode, string> = {
  [USER_PRESENCE_MODE.ONLINE]: "text-success-6",
  [USER_PRESENCE_MODE.INVISIBLE]: "text-text-3",
  [USER_PRESENCE_MODE.AWAY]: "text-warning-6",
};

// Custom roles all render in the same neutral accent so they read as
// "user-defined" without competing with the built-ins' semantic colors.
const CUSTOM_ROLE_COLOR_CLASS = "text-primary-6";
const SIDEBAR_BOTTOM_HOVER_ACTION_CLASS =
  "pointer-events-none opacity-0 transition-opacity duration-150 group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100";

function formatBackAt(backAtMs: number): string {
  const now = Date.now();
  const diffMs = backAtMs - now;
  if (diffMs <= 0) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) {
    return remMin > 0 ? `${hours}h${remMin}m` : `${hours}h`;
  }
  const date = new Date(backAtMs);
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PresenceItemContentProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  selected?: boolean;
}

function PresenceItemContent({
  icon,
  label,
  selected,
}: PresenceItemContentProps) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {selected && <DropdownSelectedCheck />}
    </>
  );
}

const PRESENCE_MENU_ORDER: ReadonlyArray<BuiltInPresenceMode> = [
  USER_PRESENCE_MODE.ONLINE,
  USER_PRESENCE_MODE.INVISIBLE,
  USER_PRESENCE_MODE.AWAY,
];

/**
 * Two label variants for the trigger pill:
 * - `concise` (default): bare status word, e.g. "Online" — fits the
 *   compact sidebar bottom strip.
 * - `detailed`: first-person framing, e.g. "I am Online" — used in
 *   roomier surfaces like the SessionCreator under the composer.
 */
export type PresenceMenuButtonVariant = "concise" | "detailed";

export interface PresenceMenuButtonProps {
  variant?: PresenceMenuButtonVariant;
  /**
   * Where the dropdown opens relative to the trigger pill. Defaults to
   * `top-start` since the canonical mount point is the sidebar bottom
   * bar (limited room below). Callers anchored at the top of a panel can
   * pass a `bottom-*` position so the menu drops downward instead.
   */
  dropdownPosition?: DropdownPosition;
}

const PRESENCE_LABEL_KEY: Record<
  PresenceMenuButtonVariant,
  Record<BuiltInPresenceMode, string>
> = {
  concise: {
    [USER_PRESENCE_MODE.ONLINE]: "sidebar.presence.online",
    [USER_PRESENCE_MODE.INVISIBLE]: "sidebar.presence.invisible",
    [USER_PRESENCE_MODE.AWAY]: "sidebar.presence.away",
  },
  detailed: {
    [USER_PRESENCE_MODE.ONLINE]: "sidebar.presence.iAmOnline",
    [USER_PRESENCE_MODE.INVISIBLE]: "sidebar.presence.iAmInvisible",
    [USER_PRESENCE_MODE.AWAY]: "sidebar.presence.iAmAway",
  },
};

export const PresenceMenuButton: React.FC<PresenceMenuButtonProps> = ({
  variant = "concise",
  dropdownPosition = "top-start",
}) => {
  const { t } = useTranslation("navigation");
  const [presence, setPresence] = useAtom(userPresenceAtom);
  const mode = useAtomValue(userPresenceModeAtom);
  const customRoles = useAtomValue(userCustomRolesAtom);
  const [menuVisible, setMenuVisible] = useState(false);

  const closeMenu = useCallback(() => setMenuVisible(false), []);

  const activeCustomRole = useMemo(() => {
    const id = parseCustomRoleId(mode);
    if (!id) return undefined;
    return customRoles.find((role) => role.id === id);
  }, [mode, customRoles]);

  const handleSelectMode = useCallback(
    (next: UserPresenceMode) => {
      if (next === USER_PRESENCE_MODE.AWAY) {
        // Default to AWAY_DURATIONS[1] (30m) so picking Away alone is
        // immediately useful; the user can refine via the duration group
        // that appears below the mode list.
        const fallback = AWAY_DURATIONS[1];
        setPresence({
          mode: next,
          backAtMs: computeBackAtMs(fallback.id),
          awayDurationLabel: fallback.id,
        });
        closeMenu();
        return;
      }
      setPresence({
        mode: next,
        backAtMs: undefined,
        awayDurationLabel: undefined,
      });
      closeMenu();
    },
    [setPresence, closeMenu]
  );

  const handleSelectAwayDuration = useCallback(
    (durationId: string) => {
      setPresence({
        mode: USER_PRESENCE_MODE.AWAY,
        backAtMs: computeBackAtMs(durationId),
        awayDurationLabel: durationId,
      });
      closeMenu();
    },
    [setPresence, closeMenu]
  );

  // Resolve icon / color / label for either a built-in mode or a custom
  // role. Custom roles that have been deleted (stale `role:<id>` in the
  // presence atom) fall back to the Online appearance with a generic
  // "Unknown role" label, and the user can pick something else from the
  // menu to recover.
  const Icon = isBuiltInPresenceMode(mode)
    ? PRESENCE_ICON[mode]
    : activeCustomRole
      ? resolveCustomRoleIcon(activeCustomRole.iconId)
      : Circle;
  const colorClass = isBuiltInPresenceMode(mode)
    ? PRESENCE_COLOR[mode]
    : CUSTOM_ROLE_COLOR_CLASS;
  const modeLabel = isBuiltInPresenceMode(mode)
    ? t(PRESENCE_LABEL_KEY[variant][mode])
    : (activeCustomRole?.label ??
      t("sidebar.presence.unknownRole", { defaultValue: "Unknown role" }));
  const ariaLabel = isBuiltInPresenceMode(mode)
    ? t(PRESENCE_LABEL_KEY.concise[mode])
    : (activeCustomRole?.label ??
      t("sidebar.presence.unknownRole", { defaultValue: "Unknown role" }));

  const backLabel = useMemo(() => {
    if (mode !== USER_PRESENCE_MODE.AWAY || !presence.backAtMs) return null;
    const formatted = formatBackAt(presence.backAtMs);
    return formatted
      ? t("sidebar.presence.backInShort", { value: formatted })
      : null;
  }, [mode, presence.backAtMs, t]);
  const pillLabel = backLabel ? `${modeLabel} · ${backLabel}` : modeLabel;

  // Single-segment PillGroup so the trigger matches the visual size and
  // hover/active treatment of the SessionCreator's repo / branch / model
  // pills: icon at rest, chevron on hover, chevron-up while open. The
  // surrounding Dropdown owns the click — segment onClick is a noop so
  // the parent's click handler fires unopposed.
  // `React.createElement` (rather than `<Icon … />`) keeps the
  // `react-hooks/static-components` lint rule happy: the rule flags
  // any PascalCase variable used as a JSX tag inside a hook callback
  // as a "component created during render", which we aren't actually
  // doing — `Icon` is just a stable lucide component reference.
  const segments: PillGroupSegment[] = useMemo(
    () => [
      {
        id: "presence",
        icon: React.createElement(Icon, {
          size: 12,
          className: colorClass,
        }),
        label: pillLabel,
        active: menuVisible,
        ariaLabel,
        title: t("sidebar.presence.tooltip"),
      },
    ],
    [Icon, colorClass, pillLabel, menuVisible, ariaLabel, t]
  );

  const droplist = (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
    >
      {PRESENCE_MENU_ORDER.map((option) => {
        const OptionIcon = PRESENCE_ICON[option];
        const optionColor = PRESENCE_COLOR[option];
        const isSelected = option === mode;
        return (
          <button
            key={option}
            type="button"
            onClick={() => handleSelectMode(option)}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <PresenceItemContent
              icon={
                <OptionIcon
                  size={DROPDOWN_ITEM.iconSize}
                  className={optionColor}
                />
              }
              label={t(`sidebar.presence.${option}`)}
              selected={isSelected}
            />
          </button>
        );
      })}

      {customRoles.length > 0 && (
        <>
          <div className={DROPDOWN_CLASSES.menuSeparator} />
          {customRoles.map((role) => {
            const RoleIcon = resolveCustomRoleIcon(role.iconId);
            const roleMode = buildCustomRoleMode(role.id);
            const isSelected = roleMode === mode;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => handleSelectMode(roleMode)}
                className={DROPDOWN_CLASSES.menuActionItem}
              >
                <PresenceItemContent
                  icon={
                    <RoleIcon
                      size={DROPDOWN_ITEM.iconSize}
                      className={CUSTOM_ROLE_COLOR_CLASS}
                    />
                  }
                  label={role.label}
                  selected={isSelected}
                />
              </button>
            );
          })}
        </>
      )}

      {mode === USER_PRESENCE_MODE.AWAY && (
        <>
          <div className={DROPDOWN_CLASSES.menuSeparator} />
          <div className={DROPDOWN_CLASSES.sectionLabel}>
            {t("sidebar.presence.awayDurationHeading")}
          </div>
          {AWAY_DURATIONS.map((entry) => {
            const isSelected = presence.awayDurationLabel === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleSelectAwayDuration(entry.id)}
                className={DROPDOWN_CLASSES.menuActionItem}
              >
                <PresenceItemContent
                  label={t(entry.labelKey)}
                  selected={isSelected}
                />
              </button>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      trigger="click"
      position={dropdownPosition}
      popupVisible={menuVisible}
      onVisibleChange={setMenuVisible}
    >
      <div className="inline-flex">
        <PillGroup segments={segments} />
      </div>
    </Dropdown>
  );
};

const SidebarBottomBar: React.FC<SidebarBottomBarProps> = React.memo(
  ({ rightActions, hideSettings = false }) => {
    return (
      <div className="flex h-[52px] flex-shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1">
          <PresenceMenuButton />
        </div>
        <div className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1 ${SIDEBAR_BOTTOM_HOVER_ACTION_CLASS}`}
          >
            {rightActions}
            {!hideSettings && <SidebarSettingsMenuButton />}
          </div>
          <SidebarUpdateButton />
        </div>
      </div>
    );
  }
);

SidebarBottomBar.displayName = "SidebarBottomBar";

export default SidebarBottomBar;
