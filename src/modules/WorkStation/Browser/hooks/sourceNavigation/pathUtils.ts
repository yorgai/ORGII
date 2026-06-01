import type { SourceLocation } from "../useWebviewInspector";

function resolveSourcePath(sourcePath: string, repoPath: string): string {
  let cleanPath = sourcePath
    .replace(/^webpack:\/\/\/?/, "")
    .replace(/^vite:\/\/\/?/, "")
    .replace(/^\.\/?/, "");

  if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.replace("file://", "");
  }

  if (cleanPath.startsWith("/")) {
    if (cleanPath.startsWith(repoPath)) {
      return cleanPath;
    }
    const relativePart = cleanPath.replace(/^\/+/, "");
    return `${repoPath}/${relativePart}`;
  }

  return `${repoPath}/${cleanPath}`;
}

export function getFilenameFromPath(filepath: string): string {
  const parts = filepath.split("/");
  return parts[parts.length - 1] || filepath;
}

export function formatSourceLocation(sourceLocation: SourceLocation): string {
  if (!sourceLocation.path) {
    return sourceLocation.componentName || "Unknown";
  }

  const filename = getFilenameFromPath(sourceLocation.path);
  const line = sourceLocation.line || 1;

  if (sourceLocation.componentName) {
    return `<${sourceLocation.componentName}> in ${filename}:${line}`;
  }

  return `${filename}:${line}`;
}

export { resolveSourcePath };
