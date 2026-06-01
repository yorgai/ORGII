import { ROUTES } from "@src/config/routes";

/** Routes that show toolbar spotlight + table search on the left (no repo selector). */
export function isSearchOnlyToolbarRoute(pathname: string): boolean {
  if (
    pathname.startsWith(ROUTES.app.home.inbox.path) ||
    pathname.startsWith(ROUTES.app.settings.path)
  ) {
    return true;
  }
  return pathname.startsWith("/orgii/app/market");
}
