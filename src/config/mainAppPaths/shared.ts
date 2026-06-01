export const SETTINGS_BASE = "/orgii/app/settings";

export function settingsPathParts(pathname: string): string[] {
  const stripped = pathname.startsWith(SETTINGS_BASE)
    ? pathname.slice(SETTINGS_BASE.length)
    : "";
  return stripped.split("/").filter((segment) => segment.length > 0);
}
