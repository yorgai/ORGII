import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const gateway = {
  isRunning: defineProcedure("gateway_is_running").output(z.boolean()).build(),

  start: defineProcedure("gateway_start").build(),

  stop: defineProcedure("gateway_stop").build(),

  getStatus: defineProcedure("gateway_status")
    .output(schemas.gateway.GatewayStatusSchema)
    .build(),
} as const;
