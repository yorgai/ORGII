/**
 * Image upload / delete handlers for useBackgroundSettings.
 * Extracted to keep the main hook under the line limit.
 */
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import type { BackgroundConfig } from "@src/store/ui/backgroundConfigAtom";
import { getStorageInfo } from "@src/util/core/storage/backgroundImage";
import {
  formatBytes,
  optimizeImage,
} from "@src/util/optimization/imageOptimizer";

import type { StorageInfo } from "../types";

// ============================================================================
// StorageInfo refresh helper
// ============================================================================

export async function refreshStorageInfo(
  setStorageInfo: React.Dispatch<React.SetStateAction<StorageInfo>>
): Promise<void> {
  const info = await getStorageInfo();
  setStorageInfo({ path: info.path, used: info.used, limit: info.quota });
}

// ============================================================================
// Hook
// ============================================================================

export interface UseBackgroundImageHandlersOptions {
  config: BackgroundConfig;
  setConfig: (next: BackgroundConfig) => void;
  saveImage: (dataUrl: string) => Promise<string | null>;
  removeImage: (imageId: string) => Promise<boolean>;
  setStorageInfo: React.Dispatch<React.SetStateAction<StorageInfo>>;
}

export interface UseBackgroundImageHandlersReturn {
  isOptimizing: boolean;
  handleUpload: (file: File) => Promise<boolean>;
  handleDeleteCustomImage: (
    event: React.MouseEvent,
    imageId: string
  ) => Promise<void>;
}

export function useBackgroundImageHandlers({
  config,
  setConfig,
  saveImage,
  removeImage,
  setStorageInfo,
}: UseBackgroundImageHandlersOptions): UseBackgroundImageHandlersReturn {
  const { t } = useTranslation("settings");
  const [isOptimizing, setIsOptimizing] = useState(false);

  const handleUpload = useCallback(
    async (file: File): Promise<boolean> => {
      setIsOptimizing(true);
      try {
        const result = await optimizeImage(file, {
          maxWidth: 1920,
          maxHeight: 1080,
          quality: 0.85,
          maxFileSizeBytes: 500 * 1024,
        });
        const { dataUrl, wasOptimized, originalSize, optimizedSize } = result;
        if (wasOptimized) {
          const savings = Math.round(
            ((originalSize - optimizedSize) / originalSize) * 100
          );
          Message.success({
            content: t("background.imageOptimized", {
              from: formatBytes(originalSize),
              to: formatBytes(optimizedSize),
              savings,
            }),
            duration: 3000,
          });
        }
        const imageId = await saveImage(dataUrl);
        if (!imageId) throw new Error("Failed to save image to storage");

        const newCustomImages = config.customImages
          ? [...config.customImages]
          : [];
        if (!newCustomImages.includes(imageId)) newCustomImages.push(imageId);

        setConfig({
          ...config,
          imageUrl: "",
          customImages: newCustomImages,
          selectedImageId: imageId,
        });
        await refreshStorageInfo(setStorageInfo);
        Message.success({
          content: t("background.imageUploaded"),
          duration: 2000,
        });
      } catch (error) {
        console.error("Image processing error:", error);
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        Message.error({
          content: t("background.failedToProcess", { detail: errorMsg }),
          duration: 4000,
        });
      } finally {
        setIsOptimizing(false);
      }
      return false;
    },
    [config, saveImage, setConfig, setStorageInfo, t]
  );

  const handleDeleteCustomImage = useCallback(
    async (event: React.MouseEvent, imageId: string): Promise<void> => {
      event.stopPropagation();
      try {
        const success = await removeImage(imageId);
        if (success) {
          setConfig({
            ...config,
            customImages: (config.customImages ?? []).filter(
              (id: string) => id !== imageId
            ),
            imageUrl: config.selectedImageId === imageId ? "" : config.imageUrl,
            selectedImageId:
              config.selectedImageId === imageId
                ? undefined
                : config.selectedImageId,
          });
          await refreshStorageInfo(setStorageInfo);
          Message.success({
            content: t("background.imageDeleted"),
            duration: 2000,
          });
        }
      } catch (error) {
        Message.error({
          content: t("background.failedToDelete"),
          duration: 2000,
        });
        console.error("Error deleting image:", error);
      }
    },
    [config, removeImage, setConfig, setStorageInfo, t]
  );

  return { isOptimizing, handleUpload, handleDeleteCustomImage };
}
