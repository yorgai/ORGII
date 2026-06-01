import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const searchSymbol = {
  search: defineProcedure("search_symbols")
    .input(schemas.searchSymbol.SearchSymbolsInput)
    .output(z.array(schemas.searchSymbol.SymbolSearchResultSchema))
    .build(),

  getFileSymbols: defineProcedure("get_file_symbols")
    .input(schemas.searchSymbol.GetFileSymbolsInput)
    .output(z.array(schemas.searchSymbol.SymbolInfoSchema))
    .build(),

  gotoDefinition: defineProcedure("goto_definition")
    .input(schemas.searchSymbol.GotoDefinitionInput)
    .output(z.array(schemas.searchSymbol.LocationSchema))
    .build(),

  findReferences: defineProcedure("find_references")
    .input(schemas.searchSymbol.FindReferencesInput)
    .output(z.array(schemas.searchSymbol.LocationSchema))
    .build(),

  getSupportedLanguages: defineProcedure("get_supported_languages")
    .output(z.array(z.record(z.string(), z.array(z.string()))))
    .build(),
} as const;
