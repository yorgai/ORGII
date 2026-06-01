/**
 * Terminal session display names.
 *
 * Prefer shell-derived labels (zsh, bash) and settings-based defaults.
 * Avoid random adjective-noun strings so new tabs match the actual shell.
 */
import type { SettingsObject } from "@src/config/settingsSchema";
import type { AddSessionOptions } from "@src/engines/TerminalCore/types";

/** Derive a short label from a shell executable path (e.g. /bin/zsh → zsh). */
export function shellPathToTerminalLabel(shellPath: string): string {
  const trimmed = shellPath.trim();
  if (!trimmed) return "Terminal";
  const segment = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const withoutExe = segment.replace(/\.exe$/i, "");
  return withoutExe || "Terminal";
}

/**
 * Pick a unique display name: use `base` if unused, otherwise `base 2`, `base 3`, …
 */
export function generateUniqueLabelFromBase(
  baseRaw: string,
  existingNames: string[]
): string {
  const base = baseRaw.trim() || "Terminal";
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

/** When terminal.shellType is custom, use the custom path basename; else "Terminal". */
export function defaultTerminalLabelBaseFromSettings(
  settings: Pick<
    SettingsObject,
    "terminal.shellType" | "terminal.customShellPath"
  >
): string {
  if (settings["terminal.shellType"] === "custom") {
    const path = settings["terminal.customShellPath"] as string | undefined;
    if (path?.trim()) {
      return shellPathToTerminalLabel(path);
    }
  }
  return "Terminal";
}

/**
 * Resolve the stored `name` for a new terminal session.
 * Priority: explicit `name` → label from `shell` → uniquified default from settings.
 */
export function resolveTerminalDisplayName(
  options: AddSessionOptions | undefined,
  existingNames: string[],
  defaultLabelBase: string
): string {
  if (options?.name?.trim()) return options.name.trim();
  if (options?.shell?.trim()) {
    return generateUniqueLabelFromBase(
      shellPathToTerminalLabel(options.shell),
      existingNames
    );
  }
  return generateUniqueLabelFromBase(defaultLabelBase, existingNames);
}
