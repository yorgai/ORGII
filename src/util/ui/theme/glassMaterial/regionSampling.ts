/**
 * Region Sampling
 *
 * Samples specific areas of the background image to extract
 * semantic color properties per UI region.
 */
import { createLogger } from "@src/hooks/logger";

import {
  DEFAULT_COLOR_FIELD,
  getColorTemperature,
  rgbToHsl,
} from "./colorAnalysis";
import type { GlassRegion, WallpaperColorField } from "./types";

const log = createLogger("GlassMaterialResolver");

// ============================================
// Region Sampling Coordinates
// ============================================

/**
 * Defines sampling regions as normalized coordinates (0-1)
 * Each region samples from a specific area of the background
 */
const REGION_SAMPLE_AREAS: Record<
  GlassRegion,
  {
    x: number; // Normalized X (0-1)
    y: number; // Normalized Y (0-1)
    width: number; // Sample width as fraction
    height: number; // Sample height as fraction
  }
> = {
  menubar: { x: 0.5, y: 0.02, width: 0.8, height: 0.05 }, // Top center strip
  tabbar: { x: 0.5, y: 0.08, width: 0.7, height: 0.06 }, // Below menubar
  toolbar: { x: 0.5, y: 0.15, width: 0.6, height: 0.08 }, // Below tabbar
  sidebar: { x: 0.1, y: 0.5, width: 0.15, height: 0.6 }, // Left strip
  content: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, // Center
  modal: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, // Center (modal)
  global: { x: 0.5, y: 0.3, width: 0.8, height: 0.4 }, // Large center area
};

// ============================================
// Core Sampling Function
// ============================================

/**
 * Sample a region of the background image and extract color field
 */
export async function sampleRegion(
  imageUrl: string,
  region: GlassRegion
): Promise<WallpaperColorField> {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve(DEFAULT_COLOR_FIELD);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_COLOR_FIELD);
          return;
        }

        // Small canvas for performance
        const sampleWidth = 50;
        const sampleHeight = 50;
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;

        // Get region sampling area
        const area = REGION_SAMPLE_AREAS[region];

        // Calculate source coordinates on the actual image
        const srcX = Math.max(0, (area.x - area.width / 2) * img.width);
        const srcY = Math.max(0, (area.y - area.height / 2) * img.height);
        const srcW = Math.min(area.width * img.width, img.width - srcX);
        const srcH = Math.min(area.height * img.height, img.height - srcY);

        // Draw the sampled region
        ctx.drawImage(
          img,
          srcX,
          srcY,
          srcW,
          srcH,
          0,
          0,
          sampleWidth,
          sampleHeight
        );

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
        const data = imageData.data;

        // Midtone thresholds - ignore highlights and shadows
        const MIDTONE_MIN_LUMINANCE = 0.15;
        const MIDTONE_MAX_LUMINANCE = 0.85;

        // Analyze colors - ONLY MIDTONES (Safari-style)
        let totalR = 0,
          totalG = 0,
          totalB = 0;
        let totalH = 0,
          totalS = 0,
          totalL = 0;
        let count = 0;

        // Track most vibrant MIDTONE color
        let mostVibrant = DEFAULT_COLOR_FIELD.dominantRGB;
        let maxVibrancy = 0;

        for (let index = 0; index < data.length; index += 4) {
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          const alpha = data[index + 3];

          if (alpha > 128) {
            const hsl = rgbToHsl(red, green, blue);

            if (
              hsl.l < MIDTONE_MIN_LUMINANCE ||
              hsl.l > MIDTONE_MAX_LUMINANCE
            ) {
              continue;
            }

            totalR += red;
            totalG += green;
            totalB += blue;

            totalH += hsl.h;
            totalS += hsl.s;
            totalL += hsl.l;
            count++;

            const vibrancy =
              Math.max(red, green, blue) - Math.min(red, green, blue);
            if (vibrancy > maxVibrancy && vibrancy > 30) {
              maxVibrancy = vibrancy;
              mostVibrant = { r: red, g: green, b: blue };
            }
          }
        }

        if (count === 0) {
          resolve(DEFAULT_COLOR_FIELD);
          return;
        }

        const avgHue = totalH / count;
        const avgSat = totalS / count;
        const avgLum = totalL / count;
        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);

        const dominantRGB =
          maxVibrancy > 30 ? mostVibrant : { r: avgR, g: avgG, b: avgB };

        const colorField: WallpaperColorField = {
          dominantHue: avgHue,
          saturation: avgSat,
          luminance: avgLum,
          temperature: getColorTemperature(avgHue),
          dominantRGB,
        };

        resolve(colorField);
      } catch (error) {
        log.error("[GlassMaterialResolver] Sampling failed:", error);
        resolve(DEFAULT_COLOR_FIELD);
      }
    };

    img.onerror = () => {
      resolve(DEFAULT_COLOR_FIELD);
    };

    img.src = imageUrl;
  });
}
