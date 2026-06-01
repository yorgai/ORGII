/**
 * Microphone permission service.
 *
 * Mirrors the shape of `src/api/services/notification.ts` — exposes
 * `check / request / openSystemSettings` so UI components can render a
 * "Granted / Denied / Not requested" status row with a Configure
 * deep-link button, exactly like the Notifications block does.
 *
 * Permission is owned by Chromium (the Tauri webview), not the OS. We
 * use:
 *  - `navigator.permissions.query({ name: "microphone" })` for the
 *    non-disruptive status check (where supported).
 *  - `navigator.mediaDevices.getUserMedia({ audio: true })` to trigger
 *    the actual OS prompt. The captured track is stopped immediately —
 *    we only care about flipping the grant.
 *
 * Both macOS and Windows expose a settings deep-link. We pick the
 * scheme by `isMacOS()` / `isWindows()` and use `shellOpen` from
 * `@tauri-apps/plugin-shell` (already enabled in capabilities).
 */
import { open as shellOpen } from "@tauri-apps/plugin-shell";

import { createLogger } from "@src/hooks/logger";
import { isMacOS, isWindows } from "@src/util/platform/tauri";

const logger = createLogger("MicrophoneService");

export type MicrophonePermissionStatus =
  | "granted"
  | "denied"
  | "prompt"
  | "unknown"
  | "unsupported";

/**
 * macOS: System Settings → Privacy & Security → Microphone.
 * Windows 10/11: Settings → Privacy & security → Microphone.
 * Linux and others: no universal scheme; we return null so the UI can
 * hide the Configure button (matches the notifications pattern).
 */
export function getMicrophoneSettingsDeepLink(): string | null {
  if (isMacOS()) {
    return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  }
  if (isWindows()) {
    return "ms-settings:privacy-microphone";
  }
  return null;
}

export function canOpenMicrophoneSystemSettings(): boolean {
  return getMicrophoneSettingsDeepLink() !== null;
}

export async function openMicrophoneSystemSettings(): Promise<void> {
  const url = getMicrophoneSettingsDeepLink();
  if (!url) {
    logger.warn("No deep-link available for this platform");
    return;
  }
  try {
    await shellOpen(url);
  } catch (err) {
    logger.error("Failed to open system settings:", err);
    throw err;
  }
}

/**
 * Non-disruptive status check. Uses the Permissions API where it
 * supports the `"microphone"` descriptor (Chromium does), otherwise
 * returns `"unknown"`. Never triggers an OS prompt.
 */
export async function checkMicrophonePermission(): Promise<MicrophonePermissionStatus> {
  if (typeof navigator === "undefined") return "unsupported";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";

  // Permissions API — preferred non-disruptive path.
  if (navigator.permissions?.query) {
    try {
      // The "microphone" PermissionDescriptor is a Chromium/WebKit
      // extension; lib.dom types it as a narrow union that excludes it.
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      switch (status.state) {
        case "granted":
          return "granted";
        case "denied":
          return "denied";
        case "prompt":
          return "prompt";
        default:
          return "unknown";
      }
    } catch (err) {
      logger.debug("permissions.query unavailable, falling back:", err);
      // Some platforms throw `TypeError` for unrecognized descriptors —
      // fall through to "unknown" so the UI shows a Request button.
    }
  }
  return "unknown";
}

/**
 * Triggers the OS microphone-access prompt. Returns the resulting
 * status. Captured tracks are stopped immediately — we just want the
 * grant flipped, not the device held open.
 */
export async function requestMicrophonePermission(): Promise<MicrophonePermissionStatus> {
  if (typeof navigator === "undefined") return "unsupported";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (err) {
    // DOMException names per the MediaDevices spec:
    //   NotAllowedError  — user (or system policy) said no
    //   SecurityError    — blocked by feature policy / sandbox
    //   NotFoundError    — no microphone hardware present
    //   NotReadableError — device exists but can't be opened (driver / in use)
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: unknown }).name)
        : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "denied";
    }
    if (name === "NotFoundError" || name === "NotReadableError") {
      logger.warn("Microphone hardware unavailable:", err);
      return "unsupported";
    }
    logger.error("Unexpected microphone request error:", err);
    return "unknown";
  }
}
