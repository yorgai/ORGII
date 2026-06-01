export const IS_TAURI = true;

const USER_AGENTS = {
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} as const;

function detectOS(): keyof typeof USER_AGENTS {
  if (typeof navigator === "undefined") return "macos";

  const platform = navigator.platform?.toLowerCase() || "";
  const userAgent = navigator.userAgent?.toLowerCase() || "";

  if (platform.includes("mac") || userAgent.includes("macintosh")) {
    return "macos";
  }
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "windows";
  }
  return "linux";
}

function getDefaultUserAgent(): string {
  const os = detectOS();
  return USER_AGENTS[os];
}

export const DEFAULT_USER_AGENT = getDefaultUserAgent();

export const DEFAULT_POLL_INTERVAL = 1000;
