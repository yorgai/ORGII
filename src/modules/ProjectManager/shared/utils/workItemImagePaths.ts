/**
 * Work Item Image Path Resolution
 *
 * Transforms between relative markdown image paths (for storage)
 * and absolute asset:// URLs (for display in the editor).
 *
 * Asset files now live under `~/.orgii/projects/{slug}/assets/{filename}`;
 * we ask Rust to resolve the absolute path via `project_resolve_asset_path`
 * (slug-keyed), then expose it as `asset://` for the editor.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

import { projectApi } from "@src/api/http/project";

const ASSET_REF_REGEX = /!\[([^\]]*)\]\((assets\/[^)]+)\)/g;

const ASSET_URL_REGEX =
  /!\[([^\]]*)\]\(((?:https?:\/\/asset\.localhost|asset:\/\/)[^)]+)\)/g;

/**
 * Resolve relative `assets/` references in markdown to displayable URLs.
 * Called before passing content to the editor.
 *
 * `![alt](assets/abc123.png)` -> `![alt](asset://localhost/abs/path/assets/abc123.png)`
 */
export async function resolveImagePathsForDisplay(
  markdown: string,
  projectSlug: string
): Promise<string> {
  const matches = [...markdown.matchAll(ASSET_REF_REGEX)];
  if (matches.length === 0) return markdown;

  let resolved = markdown;
  for (const match of matches) {
    const [fullMatch, alt, relativePath] = match;
    const filename = relativePath.replace(/^assets\//, "");
    const absolutePath = await projectApi.resolveAssetPath(
      projectSlug,
      filename
    );
    const assetUrl = convertFileSrc(absolutePath);
    resolved = resolved.replace(fullMatch, `![${alt}](${assetUrl})`);
  }

  return resolved;
}

/**
 * Convert absolute asset:// URLs back to relative `assets/` references.
 * Called before persisting markdown to disk.
 *
 * `![alt](asset://localhost/.../assets/abc123.png)` -> `![alt](assets/abc123.png)`
 */
export function unresolveImagePathsForStorage(markdown: string): string {
  return markdown.replace(ASSET_URL_REGEX, (_match, alt, url: string) => {
    const assetsIdx = url.indexOf("/assets/");
    if (assetsIdx === -1) return _match;
    const relativePath = url.slice(assetsIdx + 1);
    return `![${alt}](${relativePath})`;
  });
}
