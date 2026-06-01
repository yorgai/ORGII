import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const lineage = {
  getSessionImpact: defineProcedure("get_session_impact")
    .input(schemas.lineage.GetSessionImpactInput)
    .output(schemas.lineage.SessionImpactSchema)
    .build(),

  getProvenanceSessionIds: defineProcedure("get_provenance_session_ids")
    .output(z.array(z.string()))
    .build(),
} as const;
