import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const flow = {
  recordActivity: defineProcedure("flow_record_activity")
    .input(schemas.flow.ActivityInputSchema)
    .build(),

  recordActivities: defineProcedure("flow_record_activities")
    .input(schemas.flow.FlowRecordActivitiesInput)
    .output(z.number().int().nonnegative())
    .build(),

  getContext: defineProcedure("flow_get_context")
    .input(schemas.flow.FlowGetContextInput.default({}))
    .output(z.string())
    .build(),

  getSummary: defineProcedure("flow_get_summary")
    .input(schemas.flow.FlowGetSummaryInput.default({}))
    .output(schemas.flow.FlowSummaryOutputSchema)
    .build(),

  clearSession: defineProcedure("flow_clear_session")
    .input(schemas.flow.FlowClearSessionInput)
    .build(),
} as const;
