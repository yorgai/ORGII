/**
 * Preload background image at startup
 *
 * PERFORMANCE: This runs early during app initialization to eliminate the
 * delay when the background image loads. By preloading before React mounts,
 * the background appears instantly when the Orgii component renders.
 *
 * Strategy:
 * 1. Read background config from localStorage (sync)
 * 2. If there's a selectedImageId, load from ~/.orgii/backgrounds/ (via Tauri fs)
 * 3. Cache in the same imageCache that useBackgroundImage uses
 * 4. WAIT for browser to decode the image (critical for instant display)
 * 5. When React mounts, useBackgroundImage finds the cached image instantly
 * 6. For first-time users (no config), preload the default preset background image
 *
 * HMR Optimization:
 * - Cache is stored on `window` so it survives module hot replacement
 * - Custom images use Blob URLs (O(1) creation) instead of data URLs (slow base64)
 * - Preset images are preloaded immediately (no async conversion needed)
 */
import { DEFAULT_BUNDLED_BACKGROUND_IMAGE } from "@src/config/appearance/backgroundConfig";

import { loadBackgroundImageAsBlob } from "../storage/backgroundImage";

const BACKGROUND_CONFIG_KEY = "orgii_background_config";

// Timeout for loading custom background (don't block app start for too long)
const CUSTOM_BG_TIMEOUT_MS = 1500;

interface BackgroundConfig {
  selectedImageId?: string;
  imageUrl?: string;
  blurAmount?: number;
  customImages?: string[];
  adaptiveColors?: boolean;
  /** Preset color ID (matches `BackgroundConfig` in uiAtom). */
  backgroundColorId?: string;
  backgroundColor?: string;
  animation?: string;
}

// Extend Window type for our HMR-persistent cache
declare global {
  interface Window {
    __orgiiBackgroundImageCache?: Map<string, string>;
  }
}

/**
 * Shared image cache - imported by useBackgroundImage and BackgroundLayer
 *
 * CRITICAL: Stored on `window` so it survives HMR module replacement.
 * Module-level Maps get wiped on every HMR update, which caused the
 * background to flash/disappear for 1-3 seconds during development.
 *
 * Capped to prevent unbounded memory growth.
 */
const MAX_BACKGROUND_CACHE_SIZE = 5;

function getOrCreateCache(): Map<string, string> {
  if (!window.__orgiiBackgroundImageCache) {
    window.__orgiiBackgroundImageCache = new Map<string, string>();
  }
  return window.__orgiiBackgroundImageCache;
}

export const backgroundImageCache: Map<string, string> = getOrCreateCache();

export function addToBackgroundCache(key: string, value: string): void {
  const cache = getOrCreateCache();
  if (cache.size >= MAX_BACKGROUND_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      // Revoke blob URLs to free memory
      const oldValue = cache.get(firstKey);
      if (oldValue?.startsWith("blob:")) {
        URL.revokeObjectURL(oldValue);
      }
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

/**
 * Preload an image and wait for browser to decode it
 * Uses decode() API for non-blocking decode, falls back to onload
 */
async function preloadImage(src: string): Promise<void> {
  const img = new Image();
  img.src = src;

  try {
    // Use decode() API if available - decodes without blocking main thread
    if (typeof img.decode === "function") {
      await img.decode();
    } else {
      // Fallback: wait for load event
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Don't block on error
      });
    }
  } catch {
    // decode() can throw if image is invalid - don't block startup
  }
}

/**
 * Load default background image (bundled asset - always available)
 */
async function loadDefaultBackground(): Promise<void> {
  const cache = getOrCreateCache();
  if (!cache.has(DEFAULT_BUNDLED_BACKGROUND_IMAGE)) {
    addToBackgroundCache(
      DEFAULT_BUNDLED_BACKGROUND_IMAGE,
      DEFAULT_BUNDLED_BACKGROUND_IMAGE
    );
    await preloadImage(DEFAULT_BUNDLED_BACKGROUND_IMAGE);
  }
}

/**
 * Initialize background image preloading
 * Call this early in index.tsx, and AWAIT it before mounting React
 */
export const initBackgroundImage = async (): Promise<void> => {
  try {
    // Read config from localStorage (sync, fast)
    const storedConfig = localStorage.getItem(BACKGROUND_CONFIG_KEY);

    // First-time users get a solid graphite color background by default —
    // no image preload needed. The color is painted directly from the
    // resolved config; preloading a wallpaper here would just waste
    // the first paint on an asset that never renders.
    if (!storedConfig) {
      return;
    }

    const config: BackgroundConfig = JSON.parse(storedConfig);

    // If the user is on a solid color (preset or custom hex), there is
    // no image to preload — the color paints synchronously from the atom.
    if (config.backgroundColorId || config.backgroundColor) {
      return;
    }

    const cacheKey = config.selectedImageId || config.imageUrl || "";

    if (!cacheKey) {
      // No custom image selected - preload default
      await loadDefaultBackground();
      return;
    }

    // Check if already cached (survives HMR via window storage)
    const cache = getOrCreateCache();
    if (cache.has(cacheKey)) {
      return;
    }

    // Load custom background from ~/.orgii/backgrounds/
    if (config.selectedImageId) {
      // Wrap in timeout to avoid blocking app start if filesystem is slow
      const loadPromise = loadBackgroundImageAsBlob(config.selectedImageId);
      const timeoutPromise = new Promise<string | null>((resolve) => {
        setTimeout(() => resolve(null), CUSTOM_BG_TIMEOUT_MS);
      });

      const blobUrl = await Promise.race([loadPromise, timeoutPromise]);

      if (blobUrl) {
        addToBackgroundCache(cacheKey, blobUrl);
        await preloadImage(blobUrl);
        return;
      } else {
        console.warn(
          "[BackgroundInit] Custom background load timeout or failed, using default"
        );
      }
    }

    // Fallback to imageUrl (preset images from assets)
    if (config.imageUrl) {
      addToBackgroundCache(cacheKey, config.imageUrl);
      await preloadImage(config.imageUrl);
      return;
    }

    // Final fallback: default background
    await loadDefaultBackground();
  } catch (error) {
    // Non-critical error - load default background
    console.warn("[BackgroundInit] Error loading background:", error);
    await loadDefaultBackground();
  }
};
