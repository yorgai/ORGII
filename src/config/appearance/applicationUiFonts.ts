/**
 * Application UI font stacks (system / platform fonts only — no webfont loading).
 * Used by Settings → Appearance → Application and applied via --app-font-family on :root.
 *
 * VS Code presets mirror `monaco-workbench.{mac,windows,linux}` in VS Code's workbench style.css.
 */
export const APPLICATION_UI_FONT_IDS = [
  "default",
  "systemUi",
  "vscodeMac",
  "vscodeWindows",
  "vscodeLinux",
  "helveticaNeue",
] as const;

export type ApplicationUiFontId = (typeof APPLICATION_UI_FONT_IDS)[number];

export const APPLICATION_UI_FONT_DEFAULT_ID: ApplicationUiFontId = "default";

const APPLICATION_UI_FONT_STACKS: Record<ApplicationUiFontId, string> = {
  default:
    '"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  systemUi:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  vscodeMac: "-apple-system, BlinkMacSystemFont, sans-serif",
  vscodeWindows: '"Segoe WPC", "Segoe UI", sans-serif',
  vscodeLinux: 'system-ui, "Ubuntu", "Droid Sans", sans-serif',
  helveticaNeue:
    '"Helvetica Neue", Helvetica, Arial, "PingFang SC", system-ui, sans-serif',
};

export function isApplicationUiFontId(
  value: string
): value is ApplicationUiFontId {
  return (APPLICATION_UI_FONT_IDS as readonly string[]).includes(value);
}

export function normalizeApplicationUiFontId(
  value: unknown
): ApplicationUiFontId {
  if (typeof value === "string" && isApplicationUiFontId(value)) {
    return value;
  }
  return APPLICATION_UI_FONT_DEFAULT_ID;
}

export function getApplicationUiFontStack(id: ApplicationUiFontId): string {
  return APPLICATION_UI_FONT_STACKS[id];
}
