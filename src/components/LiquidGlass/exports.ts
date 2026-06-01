/**
 * LiquidGlass Component Exports
 *
 * Central export file for LiquidGlass component and related types
 */

export { LiquidGlass, LiquidGlass as default } from "./index";
export type { LiquidGlassProps } from "./index";

export {
  LIGHT_MATERIALS,
  DARK_MATERIALS,
  DEFAULT_MATERIAL,
  MATERIAL_USAGE,
  getMaterialConfig,
  getShadowClass,
} from "./config";
export type { MaterialThickness, MaterialConfig } from "./config";

export {
  LIQUID_GLASS_HOVER,
  LIQUID_GLASS_HOVER_VARIANTS,
  getLiquidGlassHover,
  getLiquidGlassHoverVariant,
} from "./hoverConfig";
