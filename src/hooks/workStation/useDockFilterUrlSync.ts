/**
 * Bidirectional URL ↔ `dockFilterAtom` sync via the `?filter=` query param.
 *
 * Active only on the bare workstation base path (`/orgii/workstation`).
 * The legacy per-host sub-routes (`/orgii/workstation/browser`, `.../code`,
 * …) keep their existing route → atom flow via `appModeToDockFilter` in
 * `AppShell`. On the base path that route effect is intentionally
 * disabled (see `AppShell/index.tsx`) so this hook is the sole writer
 * to `dockFilterAtom`, and the URL is the sole shareable surface.
 *
 * | Path                              | route effect (AppShell)         | this hook        |
 * |-----------------------------------|---------------------------------|------------------|
 * | `/orgii/workstation/browser`      | writes `"browser"` on mount     | inert            |
 * | `/orgii/workstation?filter=data`  | inert (base path)               | adopts `"data"`  |
 * | `/orgii/workstation` (no query)   | inert (base path)               | adopts `"all"`   |
 *
 * Why not `useSearchParams`:
 *
 * React Router's `setSearchParams` setter closes over the current
 * `searchParams` value, so its identity changes every time the search
 * string mutates (remix-run/react-router#9991). Putting it in a
 * `useEffect` dependency array therefore re-fires the effect after every
 * write, and we hit the browser's `history.replaceState()` rate limit
 * (>100 calls / 10s) when a render cycle round-trips the atom. We use
 * `useNavigate` instead — its identity is genuinely stable across
 * renders — and read the canonical search string off `useLocation()`.
 *
 * Loop prevention:
 *
 * Both the URL → atom and atom → URL writes echo back as state changes
 * that *would* re-trigger their counterpart, so we keep a single
 * reconciliation effect that diffs (URL, atom) against the values they
 * had after the most recent successful sync. Only the side whose value
 * has changed since the last sync is treated as the new authority; a
 * tie (neither moved) is a no-op. Convergence happens within at most
 * two renders for any user action.
 */
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import {
  DEFAULT_DOCK_FILTER,
  DOCK_FILTER_QUERY_KEY,
  type DockFilter,
  composeDockFilterSearch,
  dockFilterAtom,
} from "@src/store/workstation";

const VALID_DOCK_FILTERS: ReadonlySet<DockFilter> = new Set<DockFilter>([
  "all",
  "code",
  "browser",
  "data",
  "project",
]);

function parseDockFilter(raw: string | null): DockFilter {
  if (raw === null) return DEFAULT_DOCK_FILTER;
  return VALID_DOCK_FILTERS.has(raw as DockFilter)
    ? (raw as DockFilter)
    : DEFAULT_DOCK_FILTER;
}

function readFilterFromSearch(search: string): DockFilter {
  return parseDockFilter(
    new URLSearchParams(search).get(DOCK_FILTER_QUERY_KEY)
  );
}

export function useDockFilterUrlSync(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const [dockFilter, setDockFilter] = useAtom(dockFilterAtom);

  const isBasePath = location.pathname === ROUTES.workStation.base.path;

  // Snapshot of (URL filter, atom filter) at the end of the most recent
  // sync. The reconciliation effect compares this against the current
  // pair to decide which side moved and is therefore the new authority.
  // Initialised lazily on first base-path render.
  const syncedRef = useRef<{ url: DockFilter; atom: DockFilter } | null>(null);

  useEffect(() => {
    if (!isBasePath) {
      // Clear the sync record so leaving and re-entering the base path
      // doesn't compare against a stale snapshot.
      syncedRef.current = null;
      return;
    }

    const urlFilter = readFilterFromSearch(location.search);
    const synced = syncedRef.current;

    if (!synced) {
      // First base-path render: the URL is canonical (it survives
      // reloads / link sharing) so adopt it into the atom. If the atom
      // already matches, this is a no-op write that jotai dedupes.
      if (urlFilter !== dockFilter) setDockFilter(urlFilter);
      // Canonicalise the URL: an unrecognised or default-valued
      // `?filter=…` is rewritten to its canonical form so subsequent
      // diffs against `location.search` compare clean.
      const canonicalSearch = composeDockFilterSearch(urlFilter);
      if (canonicalSearch !== location.search) {
        navigate(`${location.pathname}${canonicalSearch}${location.hash}`, {
          replace: true,
        });
      }
      syncedRef.current = { url: urlFilter, atom: urlFilter };
      return;
    }

    const urlMoved = urlFilter !== synced.url;
    const atomMoved = dockFilter !== synced.atom;

    if (!urlMoved && !atomMoved) return;

    // If only one side moved (or both moved to the same value), adopt
    // that value as the truth. If both moved to *different* values
    // simultaneously — vanishingly rare; effectively only possible via
    // synchronous external code — the URL wins because it is the
    // shareable surface.
    const next: DockFilter = urlMoved ? urlFilter : dockFilter;

    if (dockFilter !== next) setDockFilter(next);

    const desiredSearch = composeDockFilterSearch(next);
    if (desiredSearch !== location.search) {
      navigate(`${location.pathname}${desiredSearch}${location.hash}`, {
        replace: true,
      });
    }

    syncedRef.current = { url: next, atom: next };
  }, [
    isBasePath,
    location.search,
    location.pathname,
    location.hash,
    dockFilter,
    navigate,
    setDockFilter,
  ]);
}
