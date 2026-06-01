/**
 * Pregenerated primary ramps for each background color-pair preset.
 *
 * Keys mirror `BACKGROUND_COLOR_PAIRS[].id`. Values reference the same objects
 * as `PRIMARY_COLOR_PALETTES` (shared memory). Use for "accent follows
 * background" without sampling hex or images at runtime.
 */
import { BACKGROUND_COLOR_PAIRS } from "./backgroundColorPairs";
import {
  PRIMARY_COLOR_PALETTES,
  type PrimaryColorSchema,
} from "./primaryColors";

type ColorPairId = (typeof BACKGROUND_COLOR_PAIRS)[number]["id"];

type NonBluePreset = keyof typeof PRIMARY_COLOR_PALETTES;

/** Curated preset per pair (semantic match to the pair name / hue). */
const BACKGROUND_PAIR_TO_PRESET: Record<ColorPairId, NonBluePreset> = {
  classic: "mono",
  graphite: "mono",
  slate: "teal",
  midnight: "violet",
  ocean: "teal",
  sky: "teal",
  indigo: "violet",
  teal: "teal",
  forest: "green",
  mint: "green",
  sage: "green",
  lavender: "violet",
  plum: "violet",
  rose: "rose",
  crimson: "red",
  peach: "orange",
  amber: "gold",
  sand: "gold",
  coffee: "orange",
};

function buildPairSchemas(): Record<ColorPairId, PrimaryColorSchema> {
  const out = {} as Record<ColorPairId, PrimaryColorSchema>;
  for (const key of Object.keys(BACKGROUND_PAIR_TO_PRESET) as ColorPairId[]) {
    const preset = BACKGROUND_PAIR_TO_PRESET[key];
    out[key] = PRIMARY_COLOR_PALETTES[preset];
  }
  return out;
}

/** Full `--primary-*` schema for every bundled background color pair id. */
export const PRIMARY_SCHEMA_BY_BACKGROUND_PAIR_ID: Record<
  ColorPairId,
  PrimaryColorSchema
> = buildPairSchemas();

export function getPrimarySchemaForBackgroundPairId(
  pairId: string | undefined
): PrimaryColorSchema | null {
  if (!pairId || !(pairId in PRIMARY_SCHEMA_BY_BACKGROUND_PAIR_ID)) {
    return null;
  }
  return PRIMARY_SCHEMA_BY_BACKGROUND_PAIR_ID[pairId as ColorPairId];
}
