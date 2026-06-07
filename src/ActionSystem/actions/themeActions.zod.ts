import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import {
  type GlobalThemeId,
  getGlobalTheme,
} from "@src/config/appearance/globalThemes";
import { globalThemeIdAtom, primaryColorPresetAtom } from "@src/store";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { swapThemeCss } from "@src/util/ui/theme/swapThemeCss";
import { showThemeTransitionCover } from "@src/util/ui/theme/themeTransitionCover";

const emptyParams = z.object({});

async function applyTheme(themeId: GlobalThemeId): Promise<string> {
  const store = getInstrumentedStore();
  const selectedTheme = getGlobalTheme(themeId);
  const cover = showThemeTransitionCover();
  try {
    await swapThemeCss(selectedTheme.baseCssPath);
    store.set(globalThemeIdAtom, themeId);
    store.set(primaryColorPresetAtom, selectedTheme.defaultPrimaryColor);
    localStorage.setItem("theme", themeId);
    return selectedTheme.id;
  } finally {
    await cover.hide();
  }
}

function defineThemeAction(
  id: string,
  themeId: GlobalThemeId,
  description: string,
  message: string,
  examples: string[]
) {
  return defineZodAction(
    {
      id,
      category: "theme",
      description,
      params: emptyParams,
      layer: "gui",
      examples,
    },
    async () => {
      await applyTheme(themeId);
      return { success: true, message };
    }
  );
}

const themeSetLight = defineThemeAction(
  ACTION_ID.THEME_SET_LIGHT,
  "github-light",
  "Switch ORGII to the light theme",
  "Light theme enabled",
  ["use light theme", "switch to light mode", "turn off dark mode"]
);

const themeSetDark = defineThemeAction(
  ACTION_ID.THEME_SET_DARK,
  "github-dark",
  "Switch ORGII to the dark theme",
  "Dark theme enabled",
  ["use dark theme", "switch to dark mode", "turn on dark mode"]
);

const themeSetHighContrast = defineThemeAction(
  ACTION_ID.THEME_SET_HIGH_CONTRAST,
  "orgii-high-contrast",
  "Switch ORGII to the high contrast theme",
  "High contrast theme enabled",
  ["use high contrast", "switch to high contrast theme", "enable high contrast"]
);

export const themeZodActions = [
  themeSetLight,
  themeSetDark,
  themeSetHighContrast,
];

export const themeActionRegistration =
  defineAppActionRegistration(themeZodActions);
