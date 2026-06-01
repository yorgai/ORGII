import { SETTINGS_REGISTRY, getSettingsKeys } from "@src/config/settingsSchema";
import {
  getManifestCoveredKeys,
  getUnknownManifestKeys,
} from "@src/config/settingsUiManifest";

export function assertSettingsUiParity(): void {
  const registryKeys = new Set(getSettingsKeys());
  const coveredKeys = new Set(getManifestCoveredKeys());
  const unknownManifestKeys = getUnknownManifestKeys();

  if (unknownManifestKeys.length > 0) {
    throw new Error(
      `[SettingsParity] Manifest references unknown keys: ${unknownManifestKeys.join(", ")}`
    );
  }

  const uncoveredKeys = [...registryKeys].filter(
    (key) => !coveredKeys.has(key)
  );
  if (uncoveredKeys.length > 0) {
    throw new Error(
      `[SettingsParity] Schema keys are not covered by UI manifest: ${uncoveredKeys.join(", ")}`
    );
  }

  const orphanedCoveredKeys = [...coveredKeys].filter(
    (key) => !registryKeys.has(key)
  );
  if (orphanedCoveredKeys.length > 0) {
    throw new Error(
      `[SettingsParity] Manifest covered keys missing from schema: ${orphanedCoveredKeys.join(", ")}`
    );
  }

  if (Object.keys(SETTINGS_REGISTRY).length === 0) {
    throw new Error("[SettingsParity] SETTINGS_REGISTRY must not be empty.");
  }
}
