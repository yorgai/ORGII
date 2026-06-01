import { homeDir } from "@tauri-apps/api/path";
import { message as showTauriMessage } from "@tauri-apps/plugin-dialog";

const ABSOLUTE_PATH_PATTERN = /^(?:~\/|\/|[A-Za-z]:[\\/])/;

export function looksLikeWorkspacePath(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value.trim());
}

export async function expandHomePath(path: string): Promise<string> {
  const trimmedPath = path.trim();
  if (!trimmedPath.startsWith("~/")) return trimmedPath;

  const home = await homeDir();
  return `${home.replace(/[\\/]$/, "")}/${trimmedPath.slice(2)}`;
}

export async function showInvalidWorkspacePathDialog(
  title: string,
  dialogMessage: string
): Promise<void> {
  await showTauriMessage(dialogMessage, {
    title,
    kind: "error",
    buttons: { ok: "OK" },
  });
}
