/**
 * useBackgroundImageStorage Hook
 *
 * Description: Manages persistent storage of custom background images
 *
 * Features:
 * - Load stored images on mount
 * - Save new images to persistent storage
 * - Delete images from storage
 * - Automatic migration of old base64 images
 * - Works seamlessly in both browser and Tauri desktop
 */
import { useCallback, useEffect, useState } from "react";

import {
  deleteBackgroundImage,
  listBackgroundImages,
  loadBackgroundImage,
  migrateImagesToStorage,
  saveBackgroundImage,
} from "@src/util/core/storage/backgroundImage";

// Hook return value type
export interface UseBackgroundImageStorageReturn {
  /** Map of image ID to data URL */
  images: Map<string, string>;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Save a new image and return its ID */
  saveImage: (dataUrl: string) => Promise<string | null>;
  /** Load an image by ID */
  getImage: (imageId: string) => Promise<string | null>;
  /** Delete an image by ID */
  removeImage: (imageId: string) => Promise<boolean>;
  /** Refresh the image list */
  refresh: () => Promise<void>;
  /** Migrate old base64 images to storage */
  migrateImages: (dataUrls: string[]) => Promise<string[]>;
}

/**
 * Hook for managing persistent background image storage
 */
export function useBackgroundImageStorage(): UseBackgroundImageStorageReturn {
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load all stored images
   */
  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const imageIds = await listBackgroundImages();
      const imageMap = new Map<string, string>();

      // Load each image
      for (const imageId of imageIds) {
        try {
          const dataUrl = await loadBackgroundImage(imageId);
          if (dataUrl) {
            imageMap.set(imageId, dataUrl);
          }
        } catch (err) {
          console.error(`Error loading image ${imageId}:`, err);
        }
      }

      setImages(imageMap);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load images";
      setError(errorMessage);
      console.error("Error loading background images:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Save a new image
   */
  const saveImage = useCallback(
    async (dataUrl: string): Promise<string | null> => {
      try {
        const imageId = await saveBackgroundImage(dataUrl);
        if (imageId) {
          // Update local state
          setImages((prev) => new Map(prev).set(imageId, dataUrl));
        }

        return imageId;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to save image";
        setError(errorMessage);
        console.error("[useBackgroundImageStorage] Error saving:", err);
        // Re-throw the error so it can be caught by the component
        throw err;
      }
    },
    []
  );

  /**
   * Get an image by ID
   */
  const getImage = useCallback(
    async (imageId: string): Promise<string | null> => {
      // Check if already loaded
      if (images.has(imageId)) {
        return images.get(imageId) || null;
      }

      // Load from storage
      try {
        const dataUrl = await loadBackgroundImage(imageId);

        if (dataUrl) {
          // Update local state
          setImages((prev) => new Map(prev).set(imageId, dataUrl));
        }

        return dataUrl;
      } catch (err) {
        console.error(`Error loading image ${imageId}:`, err);
        return null;
      }
    },
    [images]
  );

  /**
   * Delete an image
   */
  const removeImage = useCallback(async (imageId: string): Promise<boolean> => {
    try {
      const success = await deleteBackgroundImage(imageId);

      if (success) {
        // Update local state
        setImages((prev) => {
          const newMap = new Map(prev);
          newMap.delete(imageId);
          return newMap;
        });
      }

      return success;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete image";
      setError(errorMessage);
      console.error("Error deleting background image:", err);
      return false;
    }
  }, []);

  /**
   * Migrate old base64 images to storage
   */
  const migrateImages = useCallback(
    async (dataUrls: string[]): Promise<string[]> => {
      try {
        const imageIds = await migrateImagesToStorage(dataUrls);

        // Update local state
        for (let index = 0; index < imageIds.length; index++) {
          const imageId = imageIds[index];
          const dataUrl = dataUrls[index];
          setImages((prev) => new Map(prev).set(imageId, dataUrl));
        }

        return imageIds;
      } catch (err) {
        console.error("Error migrating images:", err);
        return [];
      }
    },
    []
  );

  /**
   * Refresh image list
   */
  const refresh = useCallback(async () => {
    await loadImages();
  }, [loadImages]);

  // Load images on mount
  useEffect(() => {
    loadImages();
  }, [loadImages]);

  return {
    images,
    loading,
    error,
    saveImage,
    getImage,
    removeImage,
    refresh,
    migrateImages,
  };
}

export default useBackgroundImageStorage;
