/**
 * Image Luminance API — Rust-accelerated region luminance calculation.
 * 5-10x faster than Canvas API via parallel rayon processing.
 */
import { invoke } from "@tauri-apps/api/core";

import type { LuminanceAnalysis, SampleRegion } from "./types";

export async function calculateImageLuminance(
  imagePath: string,
  regions: SampleRegion[]
): Promise<LuminanceAnalysis> {
  return invoke<LuminanceAnalysis>("calculate_image_luminance", {
    imagePath,
    regions,
  });
}

export async function calculateSingleRegionLuminance(
  imagePath: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<number> {
  return invoke<number>("calculate_single_region_luminance", {
    imagePath,
    x,
    y,
    width,
    height,
  });
}

export async function calculateLuminanceFromBase64(
  base64Data: string,
  regions: SampleRegion[]
): Promise<LuminanceAnalysis> {
  return invoke<LuminanceAnalysis>("calculate_luminance_from_base64", {
    base64Data,
    regions,
  });
}
