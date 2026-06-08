import { documentDir, homeDir, join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";

import {
  WORKSPACE_DEFAULT_REPO_LOCATION,
  type WorkspaceDefaultRepoLocation,
} from "@src/config/workspaceDefaultRepoPaths";

interface ResolveDefaultRepoParentPathOptions {
  location: WorkspaceDefaultRepoLocation;
  customPath: string;
  ensureDirectory?: boolean;
}

function stripTrailingSlash(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

async function expandHomePath(path: string): Promise<string> {
  const trimmedPath = path.trim();
  if (trimmedPath === "~") {
    return stripTrailingSlash(await homeDir());
  }
  if (!trimmedPath.startsWith("~/")) return trimmedPath;

  const home = stripTrailingSlash(await homeDir());
  return `${home}/${trimmedPath.slice(2)}`;
}

export async function resolveDefaultRepoParentPath({
  location,
  customPath,
  ensureDirectory = false,
}: ResolveDefaultRepoParentPathOptions): Promise<string> {
  const documentsPath = stripTrailingSlash(await documentDir());

  switch (location) {
    case WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS_GITHUB:
      return join(documentsPath, "GitHub");
    case WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS_ORGII: {
      const orgiiPath = await join(documentsPath, "ORGII");
      if (ensureDirectory) {
        await mkdir(orgiiPath, { recursive: true });
      }
      return orgiiPath;
    }
    case WORKSPACE_DEFAULT_REPO_LOCATION.DOCUMENTS:
      return documentsPath;
    case WORKSPACE_DEFAULT_REPO_LOCATION.CUSTOM:
      return expandHomePath(customPath);
  }
}
