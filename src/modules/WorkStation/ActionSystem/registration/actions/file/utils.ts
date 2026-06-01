/**
 * File action utilities shared across file action modules.
 */

export function resolvePath(path: string, repoPath: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  return `${repoPath}/${path}`;
}
