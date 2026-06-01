/**
 * usePluginLogo
 *
 * Async hook that reads a plugin logo from the filesystem, converts it
 * to a data URL, and detects whether it is a monochrome SVG (for brand
 * background / invert-filter styling).
 *
 * Encapsulates the `readFile` + cancellation pattern shared between
 * `PluginLogoCell` (table) and `CursorPluginPreviewPanel` (detail panel).
 */
import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

import { uint8ArrayToDataUrl } from "@src/util/file/binaryUtils";
import { getImageMimeType } from "@src/util/file/previewTypes";

import { isMonochromeSvg } from "./pluginBrandColors";

export interface PluginLogoResult {
  src: string | null;
  monochrome: boolean;
}

export function usePluginLogo(logoPath: string | null): PluginLogoResult {
  const [result, setResult] = useState<PluginLogoResult>({
    src: null,
    monochrome: false,
  });

  useEffect(() => {
    if (!logoPath) return;
    let cancelled = false;
    const mime = getImageMimeType(logoPath) ?? "image/svg+xml";
    readFile(logoPath)
      .then((data) => {
        if (cancelled) return;
        const isMono =
          logoPath.endsWith(".svg") &&
          isMonochromeSvg(new TextDecoder().decode(data));
        setResult({ src: uint8ArrayToDataUrl(data, mime), monochrome: isMono });
      })
      .catch(() => {
        if (!cancelled) setResult({ src: null, monochrome: false });
      });
    return () => {
      cancelled = true;
    };
  }, [logoPath]);

  return logoPath ? result : { src: null, monochrome: false };
}

/**
 * Extract the list of MCP server names from a plugin's mcpConfig blob.
 * Returns an empty array if the blob is missing or malformed.
 */
export function getMcpServerNames(
  mcpConfig: Record<string, unknown> | null | undefined
): string[] {
  if (!mcpConfig) return [];
  const servers = mcpConfig["mcpServers"];
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    return Object.keys(servers as Record<string, unknown>);
  }
  return [];
}
