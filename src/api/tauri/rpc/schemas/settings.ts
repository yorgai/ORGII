/**
 * Zod schemas for settings Tauri commands.
 *
 * Mirrors Rust types in src-tauri/src/settings/commands.rs.
 */
import { z } from "zod/v4";

// ============================================================================
// Procedure inputs
// ============================================================================

export const SettingsWriteInput = z.object({
  content: z.string(),
});

export const SettingsWritePartialInput = z.object({
  partial: z.record(z.string(), z.unknown()),
});

export const SettingsWriteSchemaInput = z.object({
  schemaContent: z.string(),
});

// ============================================================================
// Procedure outputs
// ============================================================================

/** settings_read returns the full settings JSON object */
export const SettingsReadOutput = z.record(z.string(), z.unknown());

/** settings_get_path returns the absolute path to settings file */
export const SettingsGetPathOutput = z.string();
