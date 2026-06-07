import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import i18n from "@src/i18n";
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@src/i18n";
import { languageAtom } from "@src/store/ui/languageAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const SupportedLanguageSchema = z.enum(SUPPORTED_LANGUAGES);

const settingsSetLanguageAction = defineZodAction(
  {
    id: ACTION_ID.SETTINGS_SET_LANGUAGE,
    category: "settings",
    description: "Set the ORGII app language/locale",
    params: z.object({
      language: SupportedLanguageSchema.describe(
        "Supported language code, for example fr for French"
      ),
    }),
    layer: "gui",
    tags: ["settings", "language", "locale", "i18n"],
    examples: ["change language to French", "set locale to fr"],
  },
  async ({ language }) => {
    const supportedLanguage = language as SupportedLanguage;
    const store = getInstrumentedStore();
    store.set(languageAtom, supportedLanguage);
    await i18n.changeLanguage(supportedLanguage);

    return {
      success: true,
      message: `Language changed to ${LANGUAGE_NAMES[supportedLanguage]}`,
    };
  }
);

export const settingsZodActions = [settingsSetLanguageAction];

export const languageActionRegistration =
  defineAppActionRegistration(settingsZodActions);
