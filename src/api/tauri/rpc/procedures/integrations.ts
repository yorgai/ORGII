import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const integrations = {
  get: defineProcedure("integrations_get")
    .output(schemas.integrations.IntegrationsConfigSchema)
    .build(),

  updatePatch: defineProcedure("integrations_update_patch")
    .input(schemas.integrations.IntegrationsUpdatePatchInput)
    .output(schemas.integrations.IntegrationsConfigSchema)
    .build(),
} as const;
