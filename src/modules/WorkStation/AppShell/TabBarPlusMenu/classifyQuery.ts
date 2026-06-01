/**
 * Smart query classifier for {@link TabBarPlusMenu}'s search input.
 *
 * Splits the user's input into one of:
 *   - `"file"`  — looks like a file path or filename. Routed to the
 *                 global file palette via `openEditorSpotlight`.
 *   - `"url"`   — looks like a URL, domain, or freeform search query.
 *                 Routed to the Browser host, which normalizes it
 *                 through `normalizeBrowserInput` (search engines for
 *                 bare keywords, scheme-prepended for partial domains).
 *
 * The classifier is intentionally biased toward file detection: when a
 * value plausibly names a file (extension, path separator, leading `.`
 * or `/`) we route to the palette, since misrouting a file query to the
 * Browser would land the user on a search results page that has no
 * affordance for finding the actual file. The Browser path remains the
 * default fallback for everything else (including URLs that lack a
 * scheme, host:port pairs, IPv4 literals, and freeform text).
 *
 * Inputs are expected to be already trimmed by the caller.
 */

const FILE_EXTENSION = /\.[A-Za-z0-9_-]{1,8}$/;
const URL_SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const PATH_SEPARATOR = /[\\/]/;
const HOST_PORT = /^[A-Za-z0-9.-]+:\d{2,5}(?:\/|$)/;

export type PlusMenuQueryKind = "file" | "url";

export function classifyPlusMenuQuery(input: string): PlusMenuQueryKind {
  const trimmed = input.trim();
  if (!trimmed) return "url";

  // Explicit URL schemes (http://, https://, file://, vscode://, …) are
  // always URL-routed.
  if (URL_SCHEME_PREFIX.test(trimmed)) return "url";

  // `host:port` / `host:port/path` is URL-routed even though it contains
  // a path separator — guard against the path heuristic below capturing
  // it as a "file".
  if (HOST_PORT.test(trimmed)) return "url";

  // Leading `.` or `./` or `../` is unambiguously a relative path.
  if (trimmed.startsWith(".")) return "file";

  // Absolute POSIX path / Windows drive letter.
  if (trimmed.startsWith("/")) return "file";
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return "file";

  // Contains a path separator at all → treat as file (e.g. `src/foo.ts`,
  // `components\Button.tsx`). Domain-like inputs that contain `/` would
  // have hit a scheme or `HOST_PORT` rule already; what's left here is
  // almost always a path.
  if (PATH_SEPARATOR.test(trimmed)) return "file";

  // No separators — disambiguate via extension. `foo.ts`, `index.html`,
  // `README.md` are files; `react.dev`, `cursor.com`, `google.com` are
  // URLs. We treat any token ending in a recognized file-extension shape
  // as a file *unless* the suffix looks like a public TLD. The
  // public-TLD allowlist is intentionally tiny — we only need to cover
  // the cases where a user-typed bare domain (no path) would otherwise
  // be misrouted to the file palette.
  if (FILE_EXTENSION.test(trimmed)) {
    const lastDot = trimmed.lastIndexOf(".");
    const suffix = trimmed.slice(lastDot + 1).toLowerCase();
    if (PUBLIC_TLD_HINTS.has(suffix)) return "url";
    return "file";
  }

  // No extension, no separator → freeform search query.
  return "url";
}

/**
 * Tiny allowlist of suffixes that *look* like file extensions to
 * {@link FILE_EXTENSION} but are actually common public TLDs users type
 * as bare domains in a URL bar. Keep this list minimal — exotic TLDs
 * (`.dev`, `.app`, `.io`) collide with real file extensions (`.dev`
 * env files, `.app` bundle paths) and we err on the side of treating
 * them as URLs only when they appear as a bare host with no path.
 *
 * Note that any input containing `/` already short-circuits to "file",
 * so a query like `https://my.dev` would have hit the scheme rule and
 * a query like `react.dev/blog` would have hit the path-separator rule
 * before reaching this map.
 */
const PUBLIC_TLD_HINTS = new Set<string>([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "io",
  "dev",
  "app",
  "ai",
  "co",
  "me",
  "info",
  "biz",
  "xyz",
]);
