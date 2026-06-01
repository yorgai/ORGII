/* eslint-disable no-console */
/**
 * Background Storage Diagnostic Utility
 *
 * Helps diagnose and fix issues with background image storage persistence.
 * Run this in browser console to check storage status.
 */
import { getStorageInfo, listBackgroundImages } from "./backgroundImage";

interface StorageDiagnostics {
  storagePath: string;
  imageCount: number;
  imageIds: string[];
  localStorageConfig: unknown;
  localStorageMetadata: Record<string, unknown> | null;
  recommendations: string[];
}

/**
 * Diagnose background image storage
 * Usage: Open browser console and run:
 *   window.diagnoseBackgroundStorage()
 */
export const diagnoseBackgroundStorage =
  async (): Promise<StorageDiagnostics> => {
    const diagnostics: StorageDiagnostics = {
      storagePath: "",
      imageCount: 0,
      imageIds: [],
      localStorageConfig: null,
      localStorageMetadata: null,
      recommendations: [],
    };

    // Check filesystem storage
    try {
      const storageInfo = await getStorageInfo();
      diagnostics.storagePath = storageInfo.path;
      diagnostics.imageCount = storageInfo.imageCount;

      const imageIds = await listBackgroundImages();
      diagnostics.imageIds = imageIds;

      if (imageIds.length === 0) {
        diagnostics.recommendations.push(
          "ℹ️ No custom backgrounds found - upload one to test"
        );
      } else {
        diagnostics.recommendations.push(
          `✅ Found ${imageIds.length} custom background(s) in ${storageInfo.path}`
        );
      }
    } catch (error) {
      diagnostics.recommendations.push(
        `❌ Failed to check filesystem storage: ${error}`
      );
    }

    // Check localStorage config
    try {
      const configStr = localStorage.getItem("orgii_background_config");
      if (configStr) {
        diagnostics.localStorageConfig = JSON.parse(configStr);
        diagnostics.recommendations.push(
          "✅ Background config found in localStorage"
        );
      } else {
        diagnostics.recommendations.push(
          "ℹ️ No background config in localStorage (using default)"
        );
      }
    } catch (error) {
      diagnostics.recommendations.push(
        `❌ Failed to read background config: ${error}`
      );
    }

    // Check localStorage metadata
    try {
      const metadataStr = localStorage.getItem("orgii_background_metadata");
      if (metadataStr) {
        const metadata = JSON.parse(metadataStr) as Record<string, unknown>;
        diagnostics.localStorageMetadata = metadata;
        const metadataCount = Object.keys(metadata).length;

        if (metadataCount !== diagnostics.imageCount) {
          diagnostics.recommendations.push(
            `⚠️ Metadata mismatch: ${metadataCount} in localStorage, ${diagnostics.imageCount} on disk`
          );
        } else {
          diagnostics.recommendations.push(
            `✅ Metadata in sync: ${metadataCount} entries`
          );
        }
      } else {
        diagnostics.recommendations.push(
          "ℹ️ No image metadata in localStorage"
        );
      }
    } catch (error) {
      diagnostics.recommendations.push(
        `❌ Failed to read image metadata: ${error}`
      );
    }

    return diagnostics;
  };

/**
 * Display diagnostics in a formatted way
 * Usage in console: window.displayBackgroundDiagnostics()
 */
export const displayDiagnostics = async (): Promise<void> => {
  console.group("🔍 Background Storage Diagnostics");
  await diagnoseBackgroundStorage();
  console.groupEnd();
};

/**
 * Global window export for easy console access
 */
if (typeof window !== "undefined") {
  const win = window as unknown as {
    diagnoseBackgroundStorage: typeof diagnoseBackgroundStorage;
    displayBackgroundDiagnostics: typeof displayDiagnostics;
  };
  win.diagnoseBackgroundStorage = diagnoseBackgroundStorage;
  win.displayBackgroundDiagnostics = displayDiagnostics;
}

export default {
  diagnoseBackgroundStorage,
  displayDiagnostics,
};
