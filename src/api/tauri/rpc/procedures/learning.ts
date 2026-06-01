import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const learning = {
  triggerReflection: defineProcedure("session_trigger_reflection")
    .input(schemas.learning.TriggerReflectionInput)
    .output(schemas.learning.ReflectionResultSchema)
    .build(),

  list: defineProcedure("session_list_learnings")
    .input(schemas.learning.ListLearningsInput)
    .output(z.array(schemas.learning.LearningRecordSchema))
    .build(),

  deprecate: defineProcedure("session_deprecate_learning")
    .input(schemas.learning.DeprecateLearningInput)
    .build(),

  browseList: defineProcedure("learnings_list")
    .input(schemas.learning.LearningsListInput)
    .output(z.array(schemas.learning.LearningRecordSchema))
    .build(),

  updateBody: defineProcedure("learnings_update_body")
    .input(schemas.learning.LearningsUpdateBodyInput)
    .build(),

  setStatus: defineProcedure("learnings_set_status")
    .input(schemas.learning.LearningsSetStatusInput)
    .build(),

  remove: defineProcedure("learnings_delete")
    .input(schemas.learning.LearningsDeleteInput)
    .build(),

  getStatus: defineProcedure("learnings_get_status")
    .input(schemas.learning.LearningsGetStatusInput)
    .output(schemas.learning.LearningsStatusReportSchema)
    .build(),
} as const;
