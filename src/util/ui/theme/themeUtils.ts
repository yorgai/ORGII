import { useAtomValue } from "jotai";

import { globalThemeIdAtom, isDarkThemeAtom } from "@src/store/ui/uiAtom";

interface ThemeInfo {
  theme: string;
  isDark: boolean;
}

export const useCurrentTheme = (): ThemeInfo => {
  const theme = useAtomValue(globalThemeIdAtom);
  const isDark = useAtomValue(isDarkThemeAtom);
  return { theme, isDark };
};
