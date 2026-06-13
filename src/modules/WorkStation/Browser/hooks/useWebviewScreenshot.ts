/**
 * useWebviewScreenshot
 *
 * Captures the visible contents of an inline browser webview and injects the
 * resulting PNG directly into `chatImageAttachmentsAtom` — the same atom
 * consumed by the ChatPanel input area and SessionCreator. Reuses the shared
 * `useImageAttachment` ingestion path, so the image goes through `optimizeImage`
 * and respects the `MAX_CHAT_IMAGES` cap exactly like pasted / dropped images.
 *
 * Intended usage: wire to the Camera button in `WebUrlBar`.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { useImageAttachment } from "@src/engines/ChatPanel/hooks/useInputArea/useImageAttachment";
import { createLogger } from "@src/hooks/logger";
import { invokeTauri } from "@src/util/platform/tauri/init";

const log = createLogger("useWebviewScreenshot");

// ============================================
// Helpers
// ============================================

/** Convert a `data:image/png;base64,...` URL into a browser `File` object. */
function dataUrlToFile(dataUrl: string, fileName: string): File {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid data URL returned from webview capture");
  }
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mime });
}

/** Build a filename like `browser-screenshot-2026-04-18T10-30-00.png`. */
function buildFileName(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `browser-screenshot-${iso}.png`;
}

// ============================================
// Hook
// ============================================

export interface UseWebviewScreenshotOptions {
  /** Inline webview label, e.g. `browser-session-${sessionId}`. */
  webviewLabel: string | null | undefined;
}

export interface UseWebviewScreenshotReturn {
  /** Capture the current webview and push it into the chat attachments atom. */
  triggerScreenshot: () => Promise<void>;
  /** True while a capture is in flight. */
  isCapturing: boolean;
}

export function useWebviewScreenshot(
  options: UseWebviewScreenshotOptions
): UseWebviewScreenshotReturn {
  const { webviewLabel } = options;
  const { t } = useTranslation();
  const { handleImagePaste } = useImageAttachment();
  const [isCapturing, setIsCapturing] = useState(false);

  const triggerScreenshot = useCallback(async () => {
    if (!webviewLabel) {
      Message.warning(t("browser.screenshot.noActivePage"));
      return;
    }
    if (isCapturing) return;

    setIsCapturing(true);
    try {
      const dataUrl = await invokeTauri<string>("browser_inline_capture", {
        label: webviewLabel,
      });
      if (!dataUrl) {
        throw new Error("empty data URL");
      }

      const file = dataUrlToFile(dataUrl, buildFileName());
      await handleImagePaste([file]);
      Message.success(t("browser.screenshot.added"));
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error ?? "unknown");
      log.error("[useWebviewScreenshot] capture failed:", reason);
      Message.error(t("browser.screenshot.failed", { reason }));
    } finally {
      setIsCapturing(false);
    }
  }, [webviewLabel, isCapturing, handleImagePaste, t]);

  return { triggerScreenshot, isCapturing };
}
