const INVALID_AUTHORITY_CHARACTER_PATTERN = /[$`{}<>"'\\\s*~]/;
const IPV6_AUTHORITY_PATTERN = /^\[[0-9a-f:.]+\](?::\d+)?$/i;
const TRAILING_TEXT_URL_BOUNDARY_PATTERN = /(?:[.,;:!?]+|\*+|_{2,}|~{2,})+$/;

interface NormalizeHttpUrlCandidateOptions {
  stripTextBoundaries?: boolean;
}

function getRawAuthority(candidate: string): string | null {
  const authorityMatch = candidate.match(/^https?:\/\/([^/?#]*)/i);
  return authorityMatch?.[1] ?? null;
}

function hasInvalidAuthority(authority: string): boolean {
  if (!authority) return true;
  if (IPV6_AUTHORITY_PATTERN.test(authority)) return false;
  return INVALID_AUTHORITY_CHARACTER_PATTERN.test(authority);
}

function hasInvalidParsedHost(hostname: string): boolean {
  return !hostname || INVALID_AUTHORITY_CHARACTER_PATTERN.test(hostname);
}

function hasInvalidParsedPort(port: string): boolean {
  if (!port) return false;
  const portNumber = Number(port);
  return !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535;
}

export function normalizeHttpUrlCandidate(
  candidate: string,
  options: NormalizeHttpUrlCandidateOptions = {}
): string | null {
  const base = candidate.trim();
  const trimmed = options.stripTextBoundaries
    ? base.replace(TRAILING_TEXT_URL_BOUNDARY_PATTERN, "")
    : base;
  if (!trimmed) return null;

  const rawAuthority = getRawAuthority(trimmed);
  if (!rawAuthority || hasInvalidAuthority(rawAuthority)) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (hasInvalidParsedHost(parsed.hostname)) return null;
    if (hasInvalidParsedPort(parsed.port)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}
