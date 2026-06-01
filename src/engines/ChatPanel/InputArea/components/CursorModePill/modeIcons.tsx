/**
 * Mode-id → Lucide icon mapping for the Cursor unified-mode picker.
 *
 * Cursor's `composerModesService.getAllModes()` returns codicon ids
 * (e.g. `"infinity"`, `"todos"`, `"bug"`) — we don't ship VS Code's
 * codicon font, so the pill / palette renders an approximate Lucide
 * equivalent instead. Mappings are picked to be visually close to
 * what Cursor's own picker shows, not byte-identical.
 *
 * Unknown ids fall through to a neutral `Circle` so a Cursor build
 * that introduces a new mode doesn't strand the picker on a broken
 * icon — the row still renders with its label and is selectable.
 */
import {
  Infinity as InfinityIcon,
  Bug,
  Circle,
  Folder,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  Shapes,
} from "lucide-react";

/**
 * Mode id → icon. Keyed off Cursor's canonical mode ids
 * (`agent`, `plan`, `debug`, `multitask`, `chat`, `project`).
 * The Cursor UI labels the `chat` mode as "Ask"; we pick the speech-
 * bubble icon to match that public-facing wording.
 */
const MODE_ICON_MAP: Readonly<Record<string, LucideIcon>> = {
  agent: InfinityIcon,
  plan: ListChecks,
  debug: Bug,
  multitask: Shapes,
  chat: MessageSquare,
  project: Folder,
};

export function getModeIcon(modeId: string | null | undefined): LucideIcon {
  if (!modeId) return Circle;
  return MODE_ICON_MAP[modeId] ?? Circle;
}
