/**
 * translateAction — i18n helpers for ActionDefinition / ActionInput.
 *
 * Workflow actions are declared in `data/actions.ts` with both an
 * English fallback (`title`, `description`, `label`, `placeholder`,
 * `unit`, option `label`) AND an i18next key (`*Key`). The pure-data
 * module can't call hooks, so we resolve translations at render time
 * via these helpers. When the key is missing or the locale is English
 * the fallback string is returned unchanged.
 */
import type { TFunction } from "i18next";

import type {
  ActionDefinition,
  ActionInput,
  ActionInputOption,
} from "../data/types";

function translate(t: TFunction, key: string | undefined, fallback: string) {
  if (!key) return fallback;
  // Use the explicit fallback so a missing key in the locale file still
  // shows the English string (instead of the raw key).
  return t(key, { defaultValue: fallback });
}

export function translateActionTitle(
  t: TFunction,
  action: ActionDefinition
): string {
  return translate(t, action.titleKey, action.title);
}

export function translateActionDescription(
  t: TFunction,
  action: ActionDefinition
): string | undefined {
  if (!action.description && !action.descriptionKey) return undefined;
  return translate(t, action.descriptionKey, action.description ?? "");
}

export function translateActionCategory(
  t: TFunction,
  action: ActionDefinition
): string {
  return translate(t, action.categoryKey, action.category);
}

export function translateInputLabel(
  t: TFunction,
  input: ActionInput
): string | undefined {
  if (!input.label && !input.labelKey) return undefined;
  return translate(t, input.labelKey, input.label ?? "");
}

export function translateInputPlaceholder(
  t: TFunction,
  input: ActionInput
): string | undefined {
  if (!input.placeholder && !input.placeholderKey) return undefined;
  return translate(t, input.placeholderKey, input.placeholder ?? "");
}

export function translateInputUnit(
  t: TFunction,
  input: ActionInput
): string | undefined {
  if (!input.unit && !input.unitKey) return undefined;
  return translate(t, input.unitKey, input.unit ?? "");
}

export function translateOptionLabel(
  t: TFunction,
  option: ActionInputOption
): string {
  return translate(t, option.labelKey, option.label);
}
