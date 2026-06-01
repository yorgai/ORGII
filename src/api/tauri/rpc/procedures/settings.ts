import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const settings = {
  read: defineProcedure("settings_read")
    .output(schemas.settings.SettingsReadOutput)
    .build(),

  write: defineProcedure("settings_write")
    .input(schemas.settings.SettingsWriteInput)
    .build(),

  writePartial: defineProcedure("settings_write_partial")
    .input(schemas.settings.SettingsWritePartialInput)
    .build(),

  reset: defineProcedure("settings_reset").build(),

  getPath: defineProcedure("settings_get_path")
    .output(schemas.settings.SettingsGetPathOutput)
    .build(),

  writeSchema: defineProcedure("settings_write_schema")
    .input(schemas.settings.SettingsWriteSchemaInput)
    .build(),
} as const;
