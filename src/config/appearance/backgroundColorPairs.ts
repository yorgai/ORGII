/**
 * Background Color Slots
 *
 * Preset desktop background colors are semantic slots. The actual color value
 * for each slot lives in the active public theme CSS file
 * (`--desktop-bg-1` ... `--desktop-bg-N`) so switching Light / Dark / High
 * Contrast preserves the chosen slot while the rendered color adapts to that
 * theme.
 */

export interface ColorPair {
  id: string;
  label: string;
  description: string;
  cssVar: `--desktop-bg-${number}`;
}

export const BACKGROUND_COLOR_PAIRS: ColorPair[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm paper & ink",
    cssVar: "--desktop-bg-1",
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Neutral grays",
    cssVar: "--desktop-bg-2",
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue gray",
    cssVar: "--desktop-bg-3",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy",
    cssVar: "--desktop-bg-4",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue",
    cssVar: "--desktop-bg-5",
  },
  {
    id: "sky",
    label: "Sky",
    description: "Open sky",
    cssVar: "--desktop-bg-6",
  },
  {
    id: "indigo",
    label: "Indigo",
    description: "Twilight indigo",
    cssVar: "--desktop-bg-7",
  },
  {
    id: "teal",
    label: "Teal",
    description: "Deep teal",
    cssVar: "--desktop-bg-8",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Pine green",
    cssVar: "--desktop-bg-9",
  },
  {
    id: "mint",
    label: "Mint",
    description: "Fresh mint",
    cssVar: "--desktop-bg-10",
  },
  {
    id: "sage",
    label: "Sage",
    description: "Muted sage",
    cssVar: "--desktop-bg-11",
  },
  {
    id: "lavender",
    label: "Lavender",
    description: "Soft purple",
    cssVar: "--desktop-bg-12",
  },
  {
    id: "plum",
    label: "Plum",
    description: "Rich plum",
    cssVar: "--desktop-bg-13",
  },
  {
    id: "rose",
    label: "Rose",
    description: "Warm rose",
    cssVar: "--desktop-bg-14",
  },
  {
    id: "crimson",
    label: "Crimson",
    description: "Deep crimson",
    cssVar: "--desktop-bg-15",
  },
  {
    id: "peach",
    label: "Peach",
    description: "Soft peach",
    cssVar: "--desktop-bg-16",
  },
  {
    id: "amber",
    label: "Amber",
    description: "Warm amber",
    cssVar: "--desktop-bg-17",
  },
  {
    id: "sand",
    label: "Sand",
    description: "Warm paper",
    cssVar: "--desktop-bg-18",
  },
  {
    id: "coffee",
    label: "Coffee",
    description: "Roasted coffee",
    cssVar: "--desktop-bg-19",
  },
];

export function getColorPairById(id: string | undefined): ColorPair | null {
  if (!id) return null;
  return BACKGROUND_COLOR_PAIRS.find((pair) => pair.id === id) ?? null;
}

export function resolveColorPair(pair: ColorPair): string {
  return `var(${pair.cssVar})`;
}
