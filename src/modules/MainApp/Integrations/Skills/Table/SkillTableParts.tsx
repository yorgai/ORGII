import type { TFunction } from "i18next";

import { SETTINGS_TABLE_CELL } from "@src/components/SettingsTable";
import type { CursorRepo } from "@src/hooks/policies";

import { StatusDot } from "../../Tables/shared";
import { getSkillResolvedSourceLabel } from "../skillSourceLabel";

export interface SkillTableRow {
  name: string;
  path: string;
  source: string;
  description: string;
  available: boolean;
  enabled: boolean;
}

interface SkillCellProps<TSkill extends SkillTableRow> {
  skill: TSkill;
}

interface SkillSourceCellProps<
  TSkill extends SkillTableRow,
> extends SkillCellProps<TSkill> {
  t: TFunction;
  cursorRepos?: CursorRepo[];
}

export function skillStatusRank(skill: SkillTableRow): number {
  if (!skill.enabled) return 0;
  return skill.available ? 2 : 1;
}

export function SkillNameCell<TSkill extends SkillTableRow>({
  skill,
}: SkillCellProps<TSkill>) {
  return (
    <span className={`${SETTINGS_TABLE_CELL.primary} font-bold`}>
      {skill.name}
    </span>
  );
}

export function SkillSourceCell<TSkill extends SkillTableRow>({
  skill,
  t,
  cursorRepos,
}: SkillSourceCellProps<TSkill>) {
  return (
    <span className={SETTINGS_TABLE_CELL.value}>
      {getSkillResolvedSourceLabel(t, skill, cursorRepos)}
    </span>
  );
}

export function SkillStatusCell<TSkill extends SkillTableRow>({
  skill,
  t,
}: SkillCellProps<TSkill> & { t: TFunction }) {
  const color = skill.enabled
    ? skill.available
      ? "bg-success-6"
      : "bg-warning-6"
    : "bg-fill-3";
  const label = skill.enabled
    ? skill.available
      ? t("status.enabled")
      : t("status.unavailable")
    : t("status.disabled");
  return <StatusDot color={color} label={label} />;
}
