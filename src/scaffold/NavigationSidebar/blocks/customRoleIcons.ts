/**
 * Curated icon palette for custom presence roles.
 *
 * Stored as a string id (`CustomRoleIconId`) in user data so the
 * persisted shape doesn't carry a component reference. Every visual
 * surface that needs to render the icon (presence pill, dropdown menu,
 * Settings → My Role list, role editor) resolves the lucide component
 * through `resolveCustomRoleIcon`.
 */
import {
  Book,
  Briefcase,
  Code,
  Coffee,
  Compass,
  Feather,
  Flame,
  Headphones,
  type LucideIcon,
  Rocket,
  Shield,
  Sparkles,
  User,
} from "lucide-react";

import type { CustomRoleIconId } from "@src/types/userPresence";

export const CUSTOM_ROLE_ICONS: Record<CustomRoleIconId, LucideIcon> = {
  user: User,
  briefcase: Briefcase,
  code: Code,
  rocket: Rocket,
  coffee: Coffee,
  headphones: Headphones,
  book: Book,
  compass: Compass,
  feather: Feather,
  flame: Flame,
  shield: Shield,
  sparkles: Sparkles,
};

export const CUSTOM_ROLE_ICON_IDS: readonly CustomRoleIconId[] = [
  "user",
  "briefcase",
  "code",
  "rocket",
  "coffee",
  "headphones",
  "book",
  "compass",
  "feather",
  "flame",
  "shield",
  "sparkles",
] as const;

export function resolveCustomRoleIcon(id: CustomRoleIconId): LucideIcon {
  return CUSTOM_ROLE_ICONS[id] ?? User;
}
