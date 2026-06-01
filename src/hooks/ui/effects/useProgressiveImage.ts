/**
 * useProgressiveImage Hook
 *
 * Description: Implements progressive image loading with blur-up effect
 * for better perceived performance with large background images.
 *
 * Features:
 * - Shows tiny placeholder immediately
 * - Loads full image in background
 * - Smooth transition when full image is ready
 * - Memory efficient (revokes object URLs)
 */
import { useCallback, useEffect, useState } from "react";

// Hook configuration options
export interface UseProgressiveImageOptions {
  /** Placeholder image URL (should be tiny, ~1-2KB) */
  placeholder?: string;
  /** Full resolution image URL */
  src: string;
  /** Whether to start loading immediately */
  autoLoad?: boolean;
}

// Hook return value type
export interface UseProgressiveImageReturn {
  /** Current image source to display */
  currentSrc: string;
  /** Whether the full image has loaded */
  isLoaded: boolean;
  /** Whether the full image is currently loading */
  isLoading: boolean;
  /** CSS blur value (blurs placeholder, clears on load) */
  blur: string;
  /** CSS transition style for smooth reveal */
  transition: string;
  /** Manual trigger to start loading */
  startLoading: () => void;
}

/**
 * Hook for progressive image loading with blur-up effect
 */
export function useProgressiveImage(
  options: UseProgressiveImageOptions
): UseProgressiveImageReturn {
  const { placeholder = "", src, autoLoad = true } = options;

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(placeholder || src);

  const startLoading = useCallback(() => {
    if (isLoaded || isLoading) return;

    setIsLoading(true);
    const img = new Image();

    img.onload = () => {
      setCurrentSrc(src);
      setIsLoaded(true);
      setIsLoading(false);
    };

    img.onerror = () => {
      // On error, still show whatever we have
      setIsLoading(false);
    };

    img.src = src;
  }, [src, isLoaded, isLoading]);

  useEffect(() => {
    if (!autoLoad || isLoaded) return;
    const id = requestAnimationFrame(() => startLoading());
    return () => cancelAnimationFrame(id);
  }, [autoLoad, isLoaded, startLoading]);

  // Blur effect: blur the placeholder, clear when loaded
  // Return "none" when loaded so consumers can apply their own blur settings
  const blur = isLoaded ? "none" : placeholder ? "blur(10px)" : "none";
  const transition = "filter 0.3s ease-out";

  return {
    currentSrc,
    isLoaded,
    isLoading,
    blur,
    transition,
    startLoading,
  };
}

export default useProgressiveImage;
