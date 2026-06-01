import type { E2EHelpers } from "./types";

export function registerE2EHelpers(helpers: E2EHelpers): void {
  window.__e2e = helpers;
}
