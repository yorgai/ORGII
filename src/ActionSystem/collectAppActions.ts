import type { ZodTypeAny } from "zod";

import { extractAppActionRegistrations } from "./schema/actionRegistration";
import type { ZodAction } from "./schema/defineZodAction";

interface WebpackRequireContext {
  keys: () => string[];
  (id: string): unknown;
}

declare const require: {
  context: (
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp
  ) => WebpackRequireContext;
};

const actionContext = require.context(
  "../",
  true,
  /\/actions\/[^/]+\.zod\.ts$/
);

function isCoreRegistrationActionPath(path: string): boolean {
  return path.includes(
    "/modules/WorkStation/ActionSystem/registration/actions/"
  );
}

function collectAppActionModules(): unknown[] {
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
