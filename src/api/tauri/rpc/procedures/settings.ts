import { defineProcedure } from "../invoke";
import * as settingsSchemas from "../schemas/settings";

export const settings = {
  read: defineProcedure("settings_read")
    .output(settingsSchemas.SettingsReadOutput)
    .build(),

  write: defineProcedure("settings_write")
    .input(settingsSchemas.SettingsWriteInput)
    .build(),

  writePartial: defineProcedure("settings_write_partial")
    .input(settingsSchemas.SettingsWritePartialInput)
    .build(),

  reset: defineProcedure("settings_reset").build(),

  getPath: defineProcedure("settings_get_path")
    .output(settingsSchemas.SettingsGetPathOutput)
    .build(),

  writeSchema: defineProcedure("settings_write_schema")
    .input(settingsSchemas.SettingsWriteSchemaInput)
    .build(),
} as const;
