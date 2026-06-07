import type { ZodTypeAny } from "zod";

import * as appActionExports from "./actions";
import { extractAppActionRegistrations } from "./schema/actionRegistration";
import type { ZodAction } from "./schema/defineZodAction";

interface WebpackRequireContext {
  keys: () => string[];
  (id: string): unknown;
}

declare const require: {
  context?: (
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp
  ) => WebpackRequireContext;
};

function createWebpackActionContext(): WebpackRequireContext | null {
  return typeof require.context === "function"
    ? require.context("../", true, /\/actions\/[^/]+\.zod\.ts$/)
    : null;
}

function isCoreRegistrationActionPath(path: string): boolean {
  return path.includes(
    "/modules/WorkStation/ActionSystem/registration/actions/"
  );
}

function collectAppActionModules(): unknown[] {
  const actionContext = createWebpackActionContext();
  if (!actionContext) return [appActionExports];

  return actionContext
    .keys()
    .filter((path) => !isCoreRegistrationActionPath(path))
    .map((path) => actionContext(path));
}

export function collectAppZodActions(): ZodAction<ZodTypeAny>[] {
  return collectAppActionModules().flatMap((moduleExports) =>
    extractAppActionRegistrations(moduleExports).flatMap((registration) => [
      ...registration.actions,
    ])
  );
}
