/**
 * Native Tauri dialog for opening a URL.
 * Asks the user whether to open internally (Browser app) or in the system browser.
 */

export type OpenLinkChoice = "internal" | "external" | "cancel";

export async function openLinkDialog(url: string): Promise<OpenLinkChoice> {
  let displayUrl = url;
  try {
    const parsed = new URL(url);
    displayUrl =
      parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    // keep original
  }

  const { message } = await import("@tauri-apps/plugin-dialog");

  const result = await message(displayUrl, {
    title: "Open Link",
    kind: "info",
    buttons: {
      yes: "Open in App",
      no: "Open in Browser",
      cancel: "Cancel",
    },
  });

  if (result === "Open in App") return "internal";
  if (result === "Open in Browser") return "external";
  return "cancel";
}
