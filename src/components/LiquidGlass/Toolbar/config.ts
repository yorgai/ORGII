/**
 * LiquidGlassToolbar Configuration
 *
 * WebGL-based liquid glass effect settings for toolbars.
 * Based on Apple's Liquid Glass design language.
 */

// ============================================
// Glass Effect Presets
// ============================================

export interface GlassPreset {
  // Refraction settings (matching liquid-glass-studio naming)
  refThickness: number; // "Thickness" in original
  refFactor: number; // "Refraction Factor" in original
  refDispersion: number; // "Dispersion Gain" in original
  refFresnelSize: number; // "Fresnel Size" in original (was refFresnelRange)
  refFresnelHardness: number; // "Fresnel Hardness" in original
  refFresnelIntensity: number; // "Fresnel Intensity" in original (was refFresnelFactor)
  // Glare settings (matching liquid-glass-studio naming)
  glareSize: number; // "Glare Size" in original (was glareRange)
  glareHardness: number; // "Glare Hardness" in original
  glareIntensity: number; // "Glare Intensity" in original (was glareFactor)
  glareConvergence: number; // "Glare Convergence" in original
  glareOpposite: number; // "Glare Opposite Side" in original (was glareOppositeFactor)
  glareAngle: number; // "Glare Angle" in original
  // Blur settings (matching liquid-glass-studio naming)
  blurRadius: number; // "Blur Radius" in original
  blurEdge: boolean; // "Blur Edge" in original
  // Tint (RGBA 0-255, alpha 0-1)
  tint: { r: number; g: number; b: number; a: number };
  // Shadow
  shadowExpand: number;
  shadowFactor: number;
  shadowPosition: { x: number; y: number };
  // Shape - superellipse exponent (n)
  // 2.0 = perfect circle/ellipse
  // 4-5+ = squircle (Apple-style rounded corners)
  // This value is passed directly to the shader - no auto-adjustment
  shapeRoundness: number;
}

/**
 * Default toolbar glass preset
 * Tuned for pill-shaped toolbars with subtle glass effect
 */
export const TOOLBAR_GLASS_PRESET: GlassPreset = {
  // Refraction
  refThickness: 20,
  refFactor: 1.6,
  refDispersion: 5, // Reduced from 20 - high dispersion causes rainbow artifacts on small elements
  refFresnelSize: 0,
  refFresnelHardness: 20,
  refFresnelIntensity: 3,
  // Glare
  glareSize: 20,
  glareHardness: 20,
  glareIntensity: 30,
  glareConvergence: 80,
  glareOpposite: 100,
  glareAngle: -45,
  // Blur
  blurRadius: 50,
  blurEdge: true,
  // Tint - transparent
  tint: { r: 255, g: 255, b: 255, a: 0 },
  // Shadow
  shadowExpand: 2,
  shadowFactor: 3.13,
  shadowPosition: { x: 0, y: -10 },
  // Shape - ellipse (n=2 for 100% pill-shaped toolbars)
  shapeRoundness: 2,
};

/**
 * Thick glass preset - more prominent effect
 */
export const THICK_GLASS_PRESET: GlassPreset = {
  refThickness: 15,
  refFactor: 1.4,
  refDispersion: 10,
  refFresnelSize: 20,
  refFresnelHardness: 20,
  refFresnelIntensity: 25,
  glareSize: 35,
  glareHardness: 20,
  glareIntensity: 100,
  glareConvergence: 50,
  glareOpposite: 80,
  glareAngle: -45,
  blurRadius: 25,
  blurEdge: true,
  tint: { r: 255, g: 255, b: 255, a: 0.0 },
  shadowExpand: 30,
  shadowFactor: 20,
  shadowPosition: { x: 0, y: -12 },
  // Shape - ellipse (n=2 for 100% pill-shaped toolbars)
  shapeRoundness: 2,
};

/**
 * Subtle glass preset - minimal effect for secondary elements
 */
export const SUBTLE_GLASS_PRESET: GlassPreset = {
  refThickness: 5,
  refFactor: 1.1,
  refDispersion: 4,
  refFresnelSize: 10,
  refFresnelHardness: 15,
  refFresnelIntensity: 10,
  glareSize: 15,
  glareHardness: 25,
  glareIntensity: 50,
  glareConvergence: 40,
  glareOpposite: 70,
  glareAngle: -45,
  blurRadius: 15,
  blurEdge: true,
  tint: { r: 255, g: 255, b: 255, a: 0.0 },
  shadowExpand: 15,
  shadowFactor: 10,
  shadowPosition: { x: 0, y: -5 },
  // Shape - ellipse (n=2 for 100% pill-shaped toolbars)
  shapeRoundness: 2,
};

// ============================================
// Utility Functions
// ============================================

/**
 * Compute Gaussian blur kernel weights
 */
export function computeGaussianKernelByRadius(radius: number): number[] {
  const sigma = radius / 3;
  const weights: number[] = [];
  let sum = 0;

  for (let index = 0; index <= radius; index++) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    weights.push(weight);
    sum += index === 0 ? weight : 2 * weight;
  }

  return weights.map((weight) => weight / sum);
}
