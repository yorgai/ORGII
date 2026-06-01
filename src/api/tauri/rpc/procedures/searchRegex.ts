import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const searchRegex = {
  search: defineProcedure("search_code_regex")
    .input(schemas.searchRegex.SearchCodeRegexInput)
    .output(z.array(schemas.searchRegex.CodeSearchResultSchema))
    .build(),

  startStreaming: defineProcedure("search_code_streaming")
    .input(schemas.searchRegex.SearchCodeStreamingInput)
    .build(),

  startFast: defineProcedure("search_code_fast")
    .input(schemas.searchRegex.SearchCodeFastInput)
    .build(),

  cancel: defineProcedure("cancel_search")
    .input(schemas.searchRegex.CancelSearchInput)
    .output(z.boolean())
    .build(),

  clearCache: defineProcedure("clear_search_cache").build(),
} as const;
