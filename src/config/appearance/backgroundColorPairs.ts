/**
 * Background Color Pairs
 *
 * Curated set of paired background colors. Each pair has a stable `id` and a
 * pair of hex values: `light` for light appearance mode, `dark` for dark
 * appearance mode. When the user switches modes, the active background color
 * swaps to the partner value of the same pair so the semantic name (e.g.
 * "Classic", "Ocean") stays consistent across themes.
 *
 * Source of truth for both the Background settings UI (preset grid + diagonal
 * split tile) and the resolved-color atom in the UI store.
 */

export interface ColorPair {
  id: string;
  label: string;
  description: string;
  light: string;
  dark: string;
}

export const BACKGROUND_COLOR_PAIRS: ColorPair[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm paper & ink",
    light: "#F7F4EE",
    dark: "#0B0B0F",
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Neutral grays",
    light: "#E8E8E8",
    dark: "#2D2D2D",
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue gray",
    light: "#D4DBE2",
    dark: "#3D4F5F",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy",
    light: "#E2E4EE",
    dark: "#1A1A2E",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue",
    light: "#C8D8E8",
    dark: "#1E3A5F",
  },
  {
    id: "sky",
    label: "Sky",
    description: "Open sky",
    light: "#DCE8F4",
    dark: "#0F3460",
  },
  {
    id: "indigo",
    label: "Indigo",
    description: "Twilight indigo",
    light: "#DDD7EE",
    dark: "#22264B",
  },
  {
    id: "teal",
    label: "Teal",
    description: "Deep teal",
    light: "#CCE2DF",
    dark: "#0F4C5C",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Pine green",
    light: "#D4E4DC",
    dark: "#1A3C34",
  },
  {
    id: "mint",
    label: "Mint",
    description: "Fresh mint",
    light: "#C8DCC9",
    dark: "#1F3A2E",
  },
  {
    id: "sage",
    label: "Sage",
    description: "Muted sage",
    light: "#D8DFCB",
    dark: "#2E382A",
  },
  {
    id: "lavender",
    label: "Lavender",
    description: "Soft purple",
    light: "#DBC8DC",
    dark: "#3D1F3D",
  },
  {
    id: "plum",
    label: "Plum",
    description: "Rich plum",
    light: "#E0CFDC",
    dark: "#3A1B33",
  },
  {
    id: "rose",
    label: "Rose",
    description: "Warm rose",
    light: "#E5CFCC",
    dark: "#4A1C2E",
  },
  {
    id: "crimson",
    label: "Crimson",
    description: "Deep crimson",
    light: "#EBD0CF",
    dark: "#4A1518",
  },
  {
    id: "peach",
    label: "Peach",
    description: "Soft peach",
    light: "#E8C9A8",
    dark: "#3A2418",
  },
  {
    id: "amber",
    label: "Amber",
    description: "Warm amber",
    light: "#EFD8B5",
    dark: "#3A2A12",
  },
  {
    id: "sand",
    label: "Sand",
    description: "Warm paper",
    light: "#E2DED3",
    dark: "#2C2618",
  },
  {
    id: "coffee",
    label: "Coffee",
    description: "Roasted coffee",
    light: "#E0D5C7",
    dark: "#2A1F18",
  },
];

export function getColorPairById(id: string | undefined): ColorPair | null {
  if (!id) return null;
  return BACKGROUND_COLOR_PAIRS.find((pair) => pair.id === id) ?? null;
}

export function resolveColorPair(
  pair: ColorPair,
  isDarkTheme: boolean
): string {
  return isDarkTheme ? pair.dark : pair.light;
}
