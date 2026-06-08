/**
 * Background Page Utility Functions
 *
 * normalizeHexColor and sanitizeCustomColorsArray are canonical in
 * @src/config/appearance/backgroundConfig and re-exported here so
 * BackgroundPage components can keep their existing import path.
 */
export {
  normalizeHexColor,
  sanitizeCustomColorsArray,
} from "@src/config/appearance/backgroundConfig";

/**
 * Filter presets by theme mode
 */
export function filterByTheme<
  T extends { themeMode: "dark" | "light" | "both" },
>(items: T[], isDarkTheme: boolean): T[] {
  return items.filter((item) => {
    if (item.themeMode === "both") return true;
    if (isDarkTheme && item.themeMode === "dark") return true;
    if (!isDarkTheme && item.themeMode === "light") return true;
    return false;
  });
}
