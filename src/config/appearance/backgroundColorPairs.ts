/**
 * Background Color Slots
 *
 * Preset background colors are semantic slots. The actual color value for each
 * slot lives in the active public theme CSS file (`--bg-1` ... `--bg-N`) so
 * switching Light / Dark / High Contrast preserves the chosen slot while the
 * rendered color adapts to that theme.
 */

export interface ColorPair {
  id: string;
  label: string;
  description: string;
  cssVar: `--bg-${number}`;
}

export const BACKGROUND_COLOR_PAIRS: ColorPair[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm paper & ink",
    cssVar: "--bg-1",
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Neutral grays",
    cssVar: "--bg-2",
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue gray",
    cssVar: "--bg-3",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy",
    cssVar: "--bg-4",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue",
    cssVar: "--bg-5",
  },
  {
    id: "sky",
    label: "Sky",
    description: "Open sky",
    cssVar: "--bg-6",
  },
  {
    id: "indigo",
    label: "Indigo",
    description: "Twilight indigo",
    cssVar: "--bg-7",
  },
  {
    id: "teal",
    label: "Teal",
    description: "Deep teal",
    cssVar: "--bg-8",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Pine green",
    cssVar: "--bg-9",
  },
  {
    id: "mint",
    label: "Mint",
    description: "Fresh mint",
    cssVar: "--bg-10",
  },
  {
    id: "sage",
    label: "Sage",
    description: "Muted sage",
    cssVar: "--bg-11",
  },
  {
    id: "lavender",
    label: "Lavender",
    description: "Soft purple",
    cssVar: "--bg-12",
  },
  {
    id: "plum",
    label: "Plum",
    description: "Rich plum",
    cssVar: "--bg-13",
  },
  {
    id: "rose",
    label: "Rose",
    description: "Warm rose",
    cssVar: "--bg-14",
  },
  {
    id: "crimson",
    label: "Crimson",
    description: "Deep crimson",
    cssVar: "--bg-15",
  },
  {
    id: "peach",
    label: "Peach",
    description: "Soft peach",
    cssVar: "--bg-16",
  },
  {
    id: "amber",
    label: "Amber",
    description: "Warm amber",
    cssVar: "--bg-17",
  },
  {
    id: "sand",
    label: "Sand",
    description: "Warm paper",
    cssVar: "--bg-18",
  },
  {
    id: "coffee",
    label: "Coffee",
    description: "Roasted coffee",
    cssVar: "--bg-19",
  },
];

export function getColorPairById(id: string | undefined): ColorPair | null {
  if (!id) return null;
  return BACKGROUND_COLOR_PAIRS.find((pair) => pair.id === id) ?? null;
}

export function resolveColorPair(pair: ColorPair): string {
  return `var(${pair.cssVar})`;
}
