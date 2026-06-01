/**
 * JSON Schema Generator
 *
 * Generates a JSON Schema from the settings registry.
 * Written to `~/.orgii/settings-schema.json` so external editors
 * (VS Code, agents) get autocomplete and validation.
 *
 * Uses the `zod-to-json-schema` package (already a project dependency).
 */
import { z } from "zod";

import { SETTINGS_REGISTRY, type SettingsKey } from "./index";

/**
 * Generate the complete JSON Schema for all settings.
 * This schema enables autocomplete in VS Code and other editors.
 */
export function generateSettingsJsonSchema(): string {
  // Build a Zod object schema from all registry entries
  const shape: Record<string, z.ZodType> = {};
  const defaults: Record<string, unknown> = {};
  const descriptions: Record<string, string> = {};

  for (const key of Object.keys(SETTINGS_REGISTRY) as SettingsKey[]) {
    const definition = SETTINGS_REGISTRY[key];
    shape[key] = definition.schema.describe(definition.description);
    defaults[key] = definition.default;
    descriptions[key] = definition.description;
  }

  // Convert to JSON Schema using zod-to-json-schema
  const settingsSchema = z.object(shape);
  const jsonSchema = z.toJSONSchema(settingsSchema, {
    target: "draft-7",
  });

  // Add defaults to each property (zod-to-json-schema doesn't include them)
  const properties = (jsonSchema as Record<string, unknown>)
    .properties as Record<string, Record<string, unknown>>;
  if (properties) {
    for (const key of Object.keys(properties)) {
      if (key in defaults) {
        properties[key].default = defaults[key];
      }
    }
  }

  // Override top-level metadata
  const result = {
    ...jsonSchema,
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "ORGII Settings",
    description:
      "User settings for the ORGII application. Edit this file or use the Settings GUI.",
  };

  return JSON.stringify(result, null, 2);
}
