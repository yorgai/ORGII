/**
 * useBackgroundImage Hook
 *
 * Description: Loads and caches the currently selected background image
 *
 * Features:
 * - Automatically loads image when selectedImageId changes
 * - Returns URL for rendering (blob URL for custom images, asset URL for presets)
 * - Handles both preset images and stored custom images
 * - HMR-persistent cache via window storage (prevents flashing during dev)
 * - Uses shared cache with backgroundInit for instant startup display
 * - Synchronous initialization for preset images (no async delay)
 */
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches Glass → useBackgroundImage and creates a circular dependency.
import { backgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import {
  addToBackgroundCache,
  backgroundImageCache,
} from "@src/util/core/init/backgroundInit";
import { loadBackgroundImageAsBlob } from "@src/util/core/storage/backgroundImage";

/**
 * Get the best available URL for the current config, synchronously.
 * Checks cache first, then falls back to preset imageUrl.
 * Only custom images (selectedImageId) require async loading.
 */
function getInitialImageUrl(
  selectedImageId: string | undefined,
  imageUrl: string
): string {
  const cacheKey = selectedImageId || imageUrl || "";

  // Check HMR-persistent cache first (instant)
  const cached = backgroundImageCache.get(cacheKey);
  if (cached) return cached;

  // For preset images (no selectedImageId), the imageUrl is a webpack asset
  // that the browser can load directly — no async conversion needed
  if (!selectedImageId && imageUrl) {
    return imageUrl;
  }

  // Custom image not in cache — will be loaded async in the effect
  // Return preset fallback so something shows immediately
  return imageUrl || "";
}

/**
 * Hook to load the currently selected background image
 */
export function useBackgroundImage(): string {
  const config = useAtomValue(backgroundConfigAtom);

  // Synchronous initialization — no blank frame for preset images
  const [loadedImageUrl, setLoadedImageUrl] = useState<string>(() =>
    getInitialImageUrl(config.selectedImageId, config.imageUrl)
  );

  useEffect(() => {
    let cancelled = false;

    const loadImage = async () => {
      const cacheKey = config.selectedImageId || config.imageUrl || "";

      // Check cache first (survives HMR via window storage)
      const cached = backgroundImageCache.get(cacheKey);
      if (cached) {
        setLoadedImageUrl(cached);
        return;
      }

      // If there's a selectedImageId, load from filesystem as blob URL
      if (config.selectedImageId) {
        try {
          const blobUrl = await loadBackgroundImageAsBlob(
            config.selectedImageId
          );
          if (cancelled) return;
          if (blobUrl) {
            addToBackgroundCache(cacheKey, blobUrl);
            setLoadedImageUrl(blobUrl);
            return;
          }
        } catch (error) {
          if (cancelled) return;
          console.error("Error loading background image:", error);
        }
      }

      // Fall back to imageUrl (for preset images or direct URLs)
      if (!cancelled) {
        const fallbackUrl = config.imageUrl;
        addToBackgroundCache(cacheKey, fallbackUrl);
        setLoadedImageUrl(fallbackUrl);
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [config.selectedImageId, config.imageUrl]);

  return loadedImageUrl;
}

export default useBackgroundImage;
