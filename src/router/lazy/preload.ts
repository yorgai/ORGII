/**
 * Route preloading — extracted from pages.tsx to avoid circular dependencies.
 *
 * This module uses only dynamic import() expressions (no static imports from
 * the app module graph), so it is safe to import from NavigationMenu, TabItem,
 * AppShell, etc. without creating cycles.
 */

type RouteLoader = () => Promise<unknown>;

const loadAgentOrgs: RouteLoader = () =>
  import("@src/modules/MainApp/AgentOrgs");
const loadMyRole: RouteLoader = () => import("@src/modules/MainApp/MyRole");
const loadSettingsSlot: RouteLoader = () =>
  import("@src/modules/MainApp/Settings/SettingsSlot");
const loadMarketPlaceholder: RouteLoader = () =>
  import("@src/router/routes/OpenSourceMarketUnavailablePage");
const loadOpsControl: RouteLoader = () =>
  import("@src/modules/MainApp/OpsControl");

/**
 * Route segment → chunk loader(s). Keys are matched as prefixes of the
 * URL segment after `/app/`, in insertion order. A single key may map
 * to multiple loaders when one URL prefix can render multiple modules.
 *
 * Settings: every `/settings/*` URL is rendered by `SettingsSlot`,
 * which dispatches to `AgentOrgsPage` / `MyRolePage` / inline section
 * renderers at runtime. We warm the slot chunk plus its lazy children
 * so any settings landing is ready.
 */
const APP_ROUTE_LOADERS: Record<string, RouteLoader | RouteLoader[]> = {
  "start-page": () => import("@src/modules/MainApp/StartPage"),
  settings: [loadSettingsSlot, loadAgentOrgs, loadMyRole],
  inbox: () => import("@src/modules/MainApp/Inbox"),
  changelog: () => import("@src/modules/MainApp/Changelog"),
  "journey/record": () => import("@src/modules/MainApp/DevRecord"),
  "market/tokens": loadMarketPlaceholder,
  "market/services": loadMarketPlaceholder,
  "market/profile": loadMarketPlaceholder,
  "market/wallet": loadMarketPlaceholder,
  "market/earnings": loadMarketPlaceholder,
  "market/boost": loadMarketPlaceholder,
  "market/agent-apps": loadMarketPlaceholder,
  "market/agent-studio": loadMarketPlaceholder,
  "market/delegation-history": loadMarketPlaceholder,
};

const WORKSTATION_ROUTE_LOADERS: Record<string, RouteLoader | RouteLoader[]> = {
  kanban: loadOpsControl,
};

function runLoaders(loader: RouteLoader | RouteLoader[]): void {
  const loaders = Array.isArray(loader) ? loader : [loader];
  for (const fn of loaders) fn().catch(() => {});
}

const _preloadedRoutes = new Set<string>();

/** Safari/WebKit WebView (used by Tauri on macOS) lacks requestIdleCallback. */
const scheduleIdle: (cb: () => void) => void =
  typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 50);

/**
 * Preload a single route's chunk based on its full path (e.g. "/orgii/app/inbox").
 * Deduplicates so each chunk is only fetched once.
 */
function preloadRouteSegment(
  namespace: string,
  segment: string,
  loadersByRoute: Record<string, RouteLoader | RouteLoader[]>
): void {
  const key = `${namespace}:${segment}`;
  if (_preloadedRoutes.has(key)) return;

  for (const [route, loader] of Object.entries(loadersByRoute)) {
    if (segment.startsWith(route)) {
      _preloadedRoutes.add(key);
      runLoaders(loader);
      return;
    }
  }
}

export function preloadRouteByPath(routePath: string): void {
  const appSegment = routePath.split("/app/")[1];
  if (appSegment) {
    preloadRouteSegment("app", appSegment, APP_ROUTE_LOADERS);
    return;
  }

  const workstationSegment = routePath.split("/workstation/")[1];
  if (workstationSegment) {
    preloadRouteSegment(
      "workstation",
      workstationSegment,
      WORKSTATION_ROUTE_LOADERS
    );
  }
}

/**
 * Background-preload all MainApp route chunks during idle time.
 * Call once after authentication completes so subsequent navigation is instant.
 */
export function preloadMainAppRoutes(): void {
  for (const [route, loader] of Object.entries(APP_ROUTE_LOADERS)) {
    _preloadedRoutes.add(`app:${route}`);
    scheduleIdle(() => {
      runLoaders(loader);
    });
  }
}

/**
 * Secondary-window chunks the main app may open at any time.
 *
 * These all share `webpackChunkName: "windows"` with TabWindow +
 * ModeSelectionWindow, so warming any one fetches the whole chunk. We
 * still list each module so the entry graph is explicit — if a future
 * reorg splits them into separate chunks this will do the right thing.
 */
const WINDOW_LOADERS: Array<() => Promise<unknown>> = [
  () => import("@src/windows/WingmanWindow"),
];

let _wingmanPreloaded = false;

/**
 * Preload the Wingman panel chunk during idle time.
 *
 * The Wingman panel opens in a fresh Tauri webview that has to download
 * the main bundle and the "windows" chunk before React can render. The
 * bottom bar is native on macOS and is not a webview.
 */
export function preloadWingmanWindows(): void {
  if (_wingmanPreloaded) return;
  _wingmanPreloaded = true;
  for (const loader of WINDOW_LOADERS) {
    scheduleIdle(() => {
      loader().catch(() => {
        // preload is best-effort; fall back to lazy on real open
        _wingmanPreloaded = false;
      });
    });
  }
}
