import { normalizeHttpUrlCandidate } from "./validation";

const SEARCH_URL_PREFIX = "https://www.google.com/search?q=";

const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const BING_BARE_HOST = "bing.com";
const BING_WWW_HOST = "www.bing.com";

function toSearchUrl(query: string): string {
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(query)}`;
}

function parseHttpUrl(candidate: string): URL | null {
  const normalized = normalizeHttpUrlCandidate(candidate);
  if (!normalized) return null;

  try {
    const parsedUrl = new URL(normalized);
    if (
      (parsedUrl.protocol === HTTP_PROTOCOL ||
        parsedUrl.protocol === HTTPS_PROTOCOL) &&
      parsedUrl.hostname.length > 0
    ) {
      return parsedUrl;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeKnownHttpUrl(parsedUrl: URL): string {
  if (parsedUrl.hostname.toLowerCase() === BING_BARE_HOST) {
    parsedUrl.hostname = BING_WWW_HOST;
  }
  return parsedUrl.toString();
}

function hasExplicitScheme(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input);
}

function isLocalHost(input: string): boolean {
  return /^localhost(?::\d+)?(?:[/?#]|$)/i.test(input);
}

function isIpv4Host(input: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(input);
}

function isHostPort(input: string): boolean {
  return /^[a-zA-Z0-9_-]+:\d+(?:[/?#]|$)/.test(input);
}

function normalizeKnownBareHost(input: string): string {
  const [head, ...rest] = input.split(/([/?#].*)/, 2);
  const hostWithPort = head.toLowerCase();
  if (hostWithPort === BING_BARE_HOST) {
    return `${BING_WWW_HOST}${rest.join("")}`;
  }
  return input;
}

function isDomainLike(input: string): boolean {
  if (input.includes(" ")) return false;
  const host = input.split(/[/?#]/, 1)[0];
  const hostWithoutPort = host.replace(/:\d+$/, "");
  if (!hostWithoutPort.includes(".")) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(
    hostWithoutPort
  );
}

export function normalizeBrowserInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (hasExplicitScheme(trimmed)) {
    const parsedUrl = parseHttpUrl(trimmed);
    return parsedUrl ? normalizeKnownHttpUrl(parsedUrl) : toSearchUrl(trimmed);
  }

  if (isLocalHost(trimmed) || isIpv4Host(trimmed) || isHostPort(trimmed)) {
    const candidate = `http://${trimmed}`;
    const parsedUrl = parseHttpUrl(candidate);
    return parsedUrl ? normalizeKnownHttpUrl(parsedUrl) : toSearchUrl(trimmed);
  }

  if (isDomainLike(trimmed)) {
    const normalizedDomain = normalizeKnownBareHost(trimmed);
    const candidate = `https://${normalizedDomain}`;
    const parsedUrl = parseHttpUrl(candidate);
    return parsedUrl ? normalizeKnownHttpUrl(parsedUrl) : toSearchUrl(trimmed);
  }

  return toSearchUrl(trimmed);
}

export function comparableBrowserUrl(input: string): string {
  const normalized = normalizeBrowserInput(input);
  if (!normalized) return "";

  try {
    const parsedUrl = new URL(normalized);
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/$/, "") || "/";
    return parsedUrl.toString();
  } catch {
    return normalized;
  }
}
