/**
 * Swap the theme CSS by creating a new <link>, waiting for it to load,
 * then removing the old one.
 *
 * Changing link.href in-place causes a race condition in Tauri's WebView:
 * the old stylesheet can be partially dropped before the new one finishes
 * loading, creating a mixed light/dark state. This utility avoids that
 * by keeping the old CSS active until the new one is fully loaded.
 */

const THEME_LINK_ATTR = "data-orgii-theme";
const PRELOAD_LINK_ATTR = "data-orgii-theme-preload";
const SWAP_TIMEOUT_MS = 2000;

/**
 * Warm the browser's stylesheet cache for the given theme CSS files so a
 * subsequent `swapThemeCss(...)` finishes parsing on the same frame as the
 * JS atom flip — avoiding a 1–2 frame lag where Tailwind/CSS-variable
 * surfaces visibly trail JS-driven surfaces (background, glass, etc.)
 * during a theme switch.
 *
 * Implemented as `<link rel="preload" as="style">` so the browser fetches,
 * parses, and keeps the CSS in cache *without* applying it. The actual
 * activation still happens via `swapThemeCss`, which moves the bytes from
 * the preload cache to a live stylesheet effectively for free.
 *
 * Idempotent: skips paths that already have a preload tag.
 */
export function preloadThemeCss(paths: readonly string[]): void {
  const head = document.querySelector("head");
  if (!head) return;

  for (const path of paths) {
    const existing = head.querySelector<HTMLLinkElement>(
      `link[${PRELOAD_LINK_ATTR}][href$="${cssPathSelector(path)}"]`
    );
    if (existing) continue;

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "style";
    link.href = path;
    link.setAttribute(PRELOAD_LINK_ATTR, "");
    head.appendChild(link);
  }
}

function cssPathSelector(path: string): string {
  return path.replace(/"/g, '\\"');
}

export function swapThemeCss(newCssPath: string): Promise<void> {
  const head = document.querySelector("head");
  if (!head) return Promise.resolve();

  const existingLink = head.querySelector<HTMLLinkElement>(
    `link[${THEME_LINK_ATTR}]`
  );

  if (!existingLink) {
    const legacyLinks = Array.from(
      head.querySelectorAll<HTMLLinkElement>("link")
    ).filter((link) => link.href.includes("orgii"));

    if (legacyLinks.length > 0) {
      legacyLinks[0].setAttribute(THEME_LINK_ATTR, "");
      const swapPromise = swapFromExisting(head, legacyLinks[0], newCssPath);
      legacyLinks.slice(1).forEach((link) => link.remove());
      return swapPromise;
    }

    return insertFreshLink(head, newCssPath);
  }

  if (existingLink.href.endsWith(newCssPath)) return Promise.resolve();

  return swapFromExisting(head, existingLink, newCssPath);
}

function swapFromExisting(
  head: HTMLHeadElement,
  oldLink: HTMLLinkElement,
  newCssPath: string
): Promise<void> {
  return new Promise((resolve) => {
    const newLink = document.createElement("link");
    newLink.rel = "stylesheet";
    newLink.type = "text/css";
    newLink.href = newCssPath;
    newLink.setAttribute(THEME_LINK_ATTR, "");

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      oldLink.remove();
      resolve();
    };

    const timeoutId = setTimeout(settle, SWAP_TIMEOUT_MS);
    newLink.onload = settle;
    newLink.onerror = settle;

    head.insertBefore(newLink, oldLink.nextSibling);
  });
}

function insertFreshLink(
  head: HTMLHeadElement,
  cssPath: string
): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = cssPath;
    link.setAttribute(THEME_LINK_ATTR, "");

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = setTimeout(settle, SWAP_TIMEOUT_MS);
    link.onload = settle;
    link.onerror = settle;

    head.insertBefore(link, head.firstChild);
  });
}
