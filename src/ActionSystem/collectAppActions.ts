import type { ZodTypeAny } from "zod";

import * as appActionExports from "./actions";
import { extractAppActionRegistrations } from "./schema/actionRegistration";
import type { ZodAction } from "./schema/defineZodAction";

export function collectAppZodActions(): ZodAction<ZodTypeAny>[] {
  return extractAppActionRegistrations(appActionExports).flatMap(
    (registration) => [...registration.actions]
  );
}
