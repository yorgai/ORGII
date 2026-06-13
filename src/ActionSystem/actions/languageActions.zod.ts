import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import i18n from "@src/i18n";
import {
  LANGUAGE_NAMES,
  LANGUAGE_PREFERENCE,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
  getFollowSystemLanguageLabel,
  resolveLanguagePreference,
} from "@src/i18n";
import { languageAtom } from "@src/store/ui/languageAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const LanguagePreferenceSchema = z.enum(LANGUAGE_PREFERENCES);

const settingsSetLanguageAction = defineZodAction(
  {
    id: ACTION_ID.SETTINGS_SET_LANGUAGE,
    category: "settings",
    description: "Set the ORGII app language/locale",
    params: z.object({
      language: LanguagePreferenceSchema.describe(
        "Language preference: system, or a supported language code such as fr"
      ),
    }),
    layer: "gui",
    tags: ["settings", "language", "locale", "i18n"],
    examples: ["change language to French", "set locale to fr"],
  },
  async ({ language }) => {
    const languagePreference = language as LanguagePreference;
    const resolvedLanguage = resolveLanguagePreference(languagePreference);
    const store = getInstrumentedStore();
    store.set(languageAtom, languagePreference);
    await i18n.changeLanguage(resolvedLanguage);

    const languageLabel =
      languagePreference === LANGUAGE_PREFERENCE.SYSTEM
        ? getFollowSystemLanguageLabel()
        : LANGUAGE_NAMES[languagePreference];

    return {
      success: true,
      message: `Language changed to ${languageLabel}`,
    };
  }
);

export const settingsZodActions = [settingsSetLanguageAction];

export const languageActionRegistration =
  defineAppActionRegistration(settingsZodActions);
